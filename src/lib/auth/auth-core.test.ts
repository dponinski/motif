import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { allowedEmail, isAllowed, normalizeEmail } from "./allowlist";
import { parseAllowed, providersOf, readAuthConfig } from "./config";
import { MIGRATIONS, closeAll, createPool, migrate, wrap, type Db } from "./db";
import { completeSignIn } from "./signin";
import {
  LOGIN_LINK_MINUTES, SESSION_DAYS, consumeLoginToken, createLoginToken, createSession, createUser, deleteSession, deleteUserSessions, findIdentity,
  findUserByEmail, getSession, getUser, hashToken, hit, identitiesOf, linkIdentity, newToken, pruneExpired,
} from "./store";

// The tests that need a database run when TEST_DATABASE_URL points at an empty MySQL or MariaDB one, for example
// mysql://user:password@127.0.0.1:3306/motif_test. Without it they are skipped.
const URL = process.env.TEST_DATABASE_URL;

describe("who may sign in", () => {
  it("reads the list: addresses and domains, in any case, split by commas, spaces or lines", () => {
    expect(parseAllowed(" Ada@Example.com, @acme.io;\n*@Other.org  ada@example.com ")).toEqual(["ada@example.com", "@acme.io", "@other.org"]);
    expect(parseAllowed(undefined)).toEqual([]);
    expect(parseAllowed("")).toEqual([]);
  });

  it("allows an address on the list and everyone at a domain on it", () => {
    const list = ["ada@example.com", "@acme.io"];
    expect(isAllowed("ada@example.com", list)).toBe(true);
    expect(isAllowed(" ADA@Example.com ", list)).toBe(true);
    expect(isAllowed("grace@acme.io", list)).toBe(true);
    expect(isAllowed("grace@sub.acme.io", list)).toBe(false);
    expect(isAllowed("evil@acme.io.attacker.test", list)).toBe(false);
    expect(isAllowed("ada@example.com.evil.test", list)).toBe(false);
    expect(isAllowed("bob@example.com", list)).toBe(false);
  });

  it("allows nobody when the list is empty, and nothing that isn't an address", () => {
    expect(isAllowed("ada@example.com", [])).toBe(false);
    for (const bad of [null, undefined, "", "ada", "ada@", "@acme.io", "a b@acme.io", "a@b", "a@acme.io, b@acme.io", "<a@acme.io>"]) expect(isAllowed(bad as string, ["@acme.io", "ada@example.com"])).toBe(false);
  });

  it("normalizes addresses, and refuses what isn't one", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("ada+tag@example.com")).toBe("ada+tag@example.com");
    expect(normalizeEmail("ada@exa mple.com")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(65)}@example.com`)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it("takes the first verified address that is on the list", () => {
    const list = ["@acme.io"];
    expect(allowedEmail([{ email: "x@gmail.com", verified: true }, { email: "ada@acme.io", verified: true }], list)).toBe("ada@acme.io");
    expect(allowedEmail([{ email: "ada@acme.io", verified: false }], list)).toBeNull();
    expect(allowedEmail([], list)).toBeNull();
  });
});

describe("what the server is told", () => {
  it("has no accounts without a database", () => {
    expect(readAuthConfig({})).toBeNull();
    expect(readAuthConfig({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" })).toBeNull();
  });

  it("offers only the ways to sign in that it has everything for", () => {
    const base = { DATABASE_URL: "mysql://u:p@h/d" };
    const none = readAuthConfig(base)!;
    expect(none.allowed).toEqual([]);
    expect(providersOf(none, false)).toEqual({ github: false, google: false, apple: false, email: false });
    const some = readAuthConfig({ ...base, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", APPLE_CLIENT_ID: "a", APPLE_TEAM_ID: "t", SMTP_URL: "smtp://h" })!;
    expect(providersOf(some, true)).toEqual({ github: true, google: true, apple: false, email: true });
    expect(some.email).toEqual({ smtpUrl: "smtp://h", from: "Motif <no-reply@localhost>" });
  });

  it("reads Apple's key with its line breaks, the issuers, the site's address and the chat limit", () => {
    const c = readAuthConfig({
      DATABASE_URL: "mysql://u:p@h/d", APP_URL: "https://motif.example/", APPLE_CLIENT_ID: "com.example.web", APPLE_TEAM_ID: "TEAM", APPLE_KEY_ID: "KEY", APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
      GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", GOOGLE_ISSUER: "http://localhost:9/", CHAT_PER_HOUR: "5", ALLOWED_EMAILS: "ada@example.com",
    })!;
    expect(c.appUrl).toBe("https://motif.example");
    expect(c.apple?.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    expect(c.apple?.issuer).toBe("https://appleid.apple.com");
    expect(c.google?.issuer).toBe("http://localhost:9");
    expect(c.chatPerHour).toBe(5);
    expect(readAuthConfig({ DATABASE_URL: "mysql://u:p@h/d", CHAT_PER_HOUR: "0" })!.chatPerHour).toBe(60);
  });
});

describe.skipIf(!URL)("accounts in a database", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    pool = createPool(URL!);
    for (const t of ["sessions", "identities", "login_tokens", "rate_buckets", "users", "schema_migrations"]) await pool.query(`DROP TABLE IF EXISTS ${t}`);
    await migrate(pool);
    db = wrap(pool);
  });
  afterAll(async () => { await pool.end(); await closeAll(); });
  beforeEach(async () => {
    await pool.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["sessions", "identities", "login_tokens", "rate_buckets", "users"]) await pool.query(`TRUNCATE TABLE ${t}`);
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  });

  describe("the schema", () => {
    it("is made once and brought up to date without being made again", async () => {
      expect(await migrate(pool)).toEqual([]);
      const rows = await db.query<{ version: number }>("SELECT version FROM schema_migrations");
      expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
    });

    it("applies a new step on top, and only that one", async () => {
      const extra = [...MIGRATIONS, { version: 99, sql: ["CREATE TABLE IF NOT EXISTS migration_probe (id INT) ENGINE=InnoDB"] }];
      expect(await migrate(pool, extra)).toEqual([99]);
      expect(await migrate(pool, extra)).toEqual([]);
      await pool.query("DROP TABLE migration_probe");
      await pool.query("DELETE FROM schema_migrations WHERE version = 99");
    });

    it("lets servers that start together take turns", async () => {
      const probe = [{ version: 100, sql: ["CREATE TABLE migration_race (id INT) ENGINE=InnoDB"] }];
      const runs = await Promise.all([migrate(pool, [...MIGRATIONS, ...probe]), migrate(pool, [...MIGRATIONS, ...probe]), migrate(pool, [...MIGRATIONS, ...probe])]);
      expect(runs.flat()).toEqual([100]);
      await pool.query("DROP TABLE migration_race");
      await pool.query("DELETE FROM schema_migrations WHERE version = 100");
    });
  });

  describe("users and the ways they sign in", () => {
    it("keeps a user by address, and finds them by it or by how they signed in", async () => {
      const ada = await createUser(db, { email: "ada@example.com", name: "Ada", avatar: "https://a.test/ada.png" });
      expect(await getUser(db, ada.id)).toEqual(ada);
      expect(await findUserByEmail(db, "ada@example.com")).toEqual(ada);
      expect(await findUserByEmail(db, "nobody@example.com")).toBeNull();
      await linkIdentity(db, ada.id, "google", "g-1", "ada@example.com");
      expect(await findIdentity(db, "google", "g-1")).toEqual(ada);
      expect(await findIdentity(db, "google", "g-2")).toBeNull();
      expect(await findIdentity(db, "apple", "g-1")).toBeNull();
    });

    it("has one user for an address", async () => {
      await createUser(db, { email: "ada@example.com" });
      await expect(createUser(db, { email: "ada@example.com" })).rejects.toThrow();
    });

    it("links the same sign-in twice without complaint, and keeps one row", async () => {
      const ada = await createUser(db, { email: "ada@example.com" });
      await linkIdentity(db, ada.id, "google", "g-1", "ada@example.com");
      await linkIdentity(db, ada.id, "google", "g-1", "ada@example.com");
      await linkIdentity(db, ada.id, "github", "42", "ada@example.com");
      expect((await identitiesOf(db, ada.id)).map((i) => i.provider).sort()).toEqual(["github", "google"]);
    });

    it("removes a user's sessions and identities with them", async () => {
      const ada = await createUser(db, { email: "ada@example.com" });
      await linkIdentity(db, ada.id, "google", "g-1", null);
      const { token } = await createSession(db, ada.id, null);
      await db.exec("DELETE FROM users WHERE id = ?", [ada.id]);
      expect(await getSession(db, token)).toBeNull();
      expect(await findIdentity(db, "google", "g-1")).toBeNull();
    });

    it("keeps names and addresses with accents and symbols", async () => {
      const u = await createUser(db, { email: "zoë@example.com".replace("ë", "e"), name: "Zoë 🙂 O'Brien" });
      expect((await getUser(db, u.id))!.name).toBe("Zoë 🙂 O'Brien");
    });
  });

  describe("sessions", () => {
    it("are found by their token, and only their hash is kept", async () => {
      const ada = await createUser(db, { email: "ada@example.com" });
      const { token } = await createSession(db, ada.id, "Mozilla/5.0");
      expect((await getSession(db, token))!.user).toEqual(ada);
      expect(await getSession(db, newToken())).toBeNull();
      const rows = await db.query<{ id: string }>("SELECT id FROM sessions");
      expect(rows[0].id).toBe(hashToken(token));
      expect(rows[0].id).not.toContain(token);
      expect(JSON.stringify(await db.query("SELECT * FROM sessions"))).not.toContain(token);
    });

    it("end when their time is up", async () => {
      const ada = await createUser(db, { email: "ada@example.com" });
      const t0 = 1_800_000_000_000;
      const { token, expiresAt } = await createSession(db, ada.id, null, t0);
      expect(expiresAt).toBe(t0 + SESSION_DAYS * 86_400_000);
      expect(await getSession(db, token, expiresAt + 1)).toBeNull();
      // (A session used just before its end would go on; this one wasn't.)
      const used = await createSession(db, ada.id, null, t0);
      expect(await getSession(db, used.token, used.expiresAt - 1)).not.toBeNull();
    });

    it("go on while they are used, written to at most once an hour", async () => {
      const ada = await createUser(db, { email: "ada@example.com" });
      const t0 = 1_800_000_000_000;
      const { token } = await createSession(db, ada.id, null, t0);
      const soon = await getSession(db, token, t0 + 60_000);
      expect(soon!.expiresAt).toBe(t0 + SESSION_DAYS * 86_400_000);
      const later = await getSession(db, token, t0 + 2 * 3_600_000);
      expect(later!.expiresAt).toBe(t0 + 2 * 3_600_000 + SESSION_DAYS * 86_400_000);
    });

    it("can be ended one at a time or all together", async () => {
      const ada = await createUser(db, { email: "ada@example.com" });
      const a = await createSession(db, ada.id, null);
      const b = await createSession(db, ada.id, null);
      await deleteSession(db, a.token);
      expect(await getSession(db, a.token)).toBeNull();
      expect(await getSession(db, b.token)).not.toBeNull();
      await deleteUserSessions(db, ada.id);
      expect(await getSession(db, b.token)).toBeNull();
    });

    it("are cleaned away when they are old", async () => {
      const ada = await createUser(db, { email: "ada@example.com" });
      const t0 = 1_800_000_000_000;
      await createSession(db, ada.id, null, t0);
      await pruneExpired(db, t0 + (SESSION_DAYS + 1) * 86_400_000);
      expect(await db.query("SELECT 1 FROM sessions")).toHaveLength(0);
    });
  });

  describe("emailed links", () => {
    it("work once", async () => {
      const token = await createLoginToken(db, "ada@example.com");
      expect(await consumeLoginToken(db, token)).toBe("ada@example.com");
      expect(await consumeLoginToken(db, token)).toBeNull();
    });

    it("work for a quarter of an hour", async () => {
      const t0 = 1_800_000_000_000;
      const token = await createLoginToken(db, "ada@example.com", t0);
      expect(await consumeLoginToken(db, token, t0 + LOGIN_LINK_MINUTES * 60_000 + 1)).toBeNull();
      const fresh = await createLoginToken(db, "ada@example.com", t0);
      expect(await consumeLoginToken(db, fresh, t0 + LOGIN_LINK_MINUTES * 60_000 - 1)).toBe("ada@example.com");
    });

    it("are not known by anything but their own token, and kept as a hash", async () => {
      const token = await createLoginToken(db, "ada@example.com");
      expect(await consumeLoginToken(db, "x".repeat(43))).toBeNull();
      expect(await consumeLoginToken(db, "")).toBeNull();
      expect(JSON.stringify(await db.query("SELECT * FROM login_tokens"))).not.toContain(token);
    });

    it("can't both be had by two who use one at the same moment", async () => {
      const token = await createLoginToken(db, "ada@example.com");
      const results = await Promise.all(Array.from({ length: 8 }, () => consumeLoginToken(db, token)));
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("limits", () => {
    it("count up to a limit within a window, then say no, then start again", async () => {
      const t0 = 1_800_000_000_000;
      const results = [];
      for (let i = 0; i < 4; i++) results.push((await hit(db, "mail:ada", 3, 3_600_000, t0 + i)).ok);
      expect(results).toEqual([true, true, true, false]);
      expect((await hit(db, "mail:ada", 3, 3_600_000, t0 + 3_600_001)).ok).toBe(true);
    });

    it("are kept apart by what they are for", async () => {
      const t0 = 1_800_000_000_000;
      await hit(db, "mail:ada", 1, 60_000, t0);
      expect((await hit(db, "mail:ada", 1, 60_000, t0)).ok).toBe(false);
      expect((await hit(db, "mail:grace", 1, 60_000, t0)).ok).toBe(true);
    });

    it("count every one of many at once", async () => {
      const t0 = 1_800_000_000_000;
      const results = await Promise.all(Array.from({ length: 10 }, () => hit(db, "burst", 4, 60_000, t0)));
      expect(results.filter((r) => r.ok)).toHaveLength(4);
    });
  });

  describe("letting someone in", () => {
    const list = ["ada@example.com", "@acme.io"];

    it("makes an account for someone who is on the list, and remembers how they signed in", async () => {
      const r = await completeSignIn(db, list, { provider: "google", subject: "g-1", emails: [{ email: "Ada@Example.com", verified: true }], name: "Ada", avatar: "https://a.test/a.png" });
      expect(r).toMatchObject({ ok: true, created: true, linked: false, user: { email: "ada@example.com", name: "Ada" } });
      expect(await findIdentity(db, "google", "g-1")).toMatchObject({ email: "ada@example.com" });
    });

    it("lets them in again the same way, whatever address the provider reports then", async () => {
      await completeSignIn(db, list, { provider: "apple", subject: "a-1", emails: [{ email: "ada@example.com", verified: true }] });
      const again = await completeSignIn(db, list, { provider: "apple", subject: "a-1", emails: [] });
      expect(again).toMatchObject({ ok: true, created: false, user: { email: "ada@example.com" } });
      expect(await db.query("SELECT 1 FROM users")).toHaveLength(1);
    });

    it("gives one person one account across every way of signing in, by the address they share", async () => {
      const a = await completeSignIn(db, list, { provider: "email", subject: "ada@example.com", emails: [{ email: "ada@example.com", verified: true }] });
      const b = await completeSignIn(db, list, { provider: "google", subject: "g-1", emails: [{ email: "ada@example.com", verified: true }], name: "Ada L" });
      const c = await completeSignIn(db, list, { provider: "github", subject: "42", emails: [{ email: "other@gmail.com", verified: true }, { email: "ada@example.com", verified: true }] });
      expect(b).toMatchObject({ ok: true, created: false, linked: true });
      expect(c).toMatchObject({ ok: true, created: false, linked: true });
      expect(a.ok && b.ok && c.ok && a.user.id === b.user.id && b.user.id === c.user.id).toBe(true);
      expect(await db.query("SELECT 1 FROM users")).toHaveLength(1);
      expect((await identitiesOf(db, (a as { user: { id: string } }).user.id)).map((i) => i.provider).sort()).toEqual(["email", "github", "google"]);
      // A name is filled in when there was none, and not changed after.
      expect((await findUserByEmail(db, "ada@example.com"))!.name).toBe("Ada L");
    });

    it("doesn't take an address the provider hasn't verified", async () => {
      const r = await completeSignIn(db, list, { provider: "google", subject: "g-9", emails: [{ email: "ada@example.com", verified: false }] });
      expect(r).toEqual({ ok: false, reason: "no-verified-email" });
      expect(await db.query("SELECT 1 FROM users")).toHaveLength(0);
    });

    it("turns away someone who isn't on the list, creating nothing", async () => {
      const r = await completeSignIn(db, list, { provider: "google", subject: "g-2", emails: [{ email: "mallory@evil.test", verified: true }] });
      expect(r).toEqual({ ok: false, reason: "not-allowed", email: "mallory@evil.test" });
      expect(await db.query("SELECT 1 FROM users")).toHaveLength(0);
      expect(await db.query("SELECT 1 FROM identities")).toHaveLength(0);
    });

    it("turns everyone away when there is no list", async () => {
      expect(await completeSignIn(db, [], { provider: "google", subject: "g-1", emails: [{ email: "ada@example.com", verified: true }] })).toMatchObject({ ok: false, reason: "not-allowed" });
    });

    it("says so when Apple has hidden the address, which the list can't name", async () => {
      const r = await completeSignIn(db, list, { provider: "apple", subject: "a-2", emails: [{ email: "x1y2@privaterelay.appleid.com", verified: true }] });
      expect(r).toEqual({ ok: false, reason: "private-email" });
    });

    it("turns away someone who has been taken off the list, even though they have signed in before", async () => {
      await completeSignIn(db, list, { provider: "google", subject: "g-1", emails: [{ email: "ada@example.com", verified: true }] });
      const r = await completeSignIn(db, ["@acme.io"], { provider: "google", subject: "g-1", emails: [{ email: "ada@example.com", verified: true }] });
      expect(r).toMatchObject({ ok: false, reason: "not-allowed" });
    });

    it("can't be tricked into someone else's account with an address that only looks like theirs", async () => {
      await completeSignIn(db, ["ada@example.com", "ada@example.com.evil.test"], { provider: "email", subject: "ada@example.com", emails: [{ email: "ada@example.com", verified: true }] });
      const r = await completeSignIn(db, ["ada@example.com", "ada@example.com.evil.test"], { provider: "google", subject: "evil", emails: [{ email: "ada@example.com.evil.test", verified: true }] });
      expect(r).toMatchObject({ ok: true, created: true });
      expect((await db.query("SELECT 1 FROM users"))).toHaveLength(2);
    });

    it("makes one account when the same person signs in twice at once", async () => {
      const claim = { provider: "google" as const, subject: "g-race", emails: [{ email: "ada@example.com", verified: true }] };
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => completeSignIn(db, list, claim)));
      expect(await db.query("SELECT 1 FROM users")).toHaveLength(1);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
      expect(await db.query("SELECT 1 FROM identities")).toHaveLength(1);
    });
  });
});
