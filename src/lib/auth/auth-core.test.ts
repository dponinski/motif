import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { allowedEmail, isAllowed, normalizeEmail } from "./allowlist";
import { parseAllowed, providersOf, readAuthConfig } from "./config";
import { MIGRATIONS, closeAll, createPool, migrate, poolConfig, wrap, type Db } from "./db";
import { completeSignIn } from "./signin";
import { MAX_TEAM_PROJECTS, getProject, listProjects, moveProject, removeProject, saveProject } from "./projects";
import { MAX_MEMBERS, acceptInviteById, acceptInviteByToken, createInvite, createTeam, deleteTeam, invitesFor, listTeams, mayEnter, renameTeam, revokeInvite, roleIn, setRole, teamAccess } from "./teams";
import type { ProjectPayload } from "../sync/payload";
import {
  LOGIN_LINK_MINUTES, SESSION_DAYS, consumeLoginToken, createLoginToken, createSession, createUser, deleteSession, deleteUserSessions, findIdentity,
  findUserByEmail, getSession, getUser, hashToken, hit, identitiesOf, linkIdentity, newToken, pruneExpired,
} from "./store";

// The tests that need a database run when TEST_DATABASE_URL points at an empty PostgreSQL one, for example
// postgresql://user:password@127.0.0.1:5432/motif_test. Without it they are skipped.
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
    const base = { DATABASE_URL: "postgresql://u:p@h/d" };
    const none = readAuthConfig(base)!;
    expect(none.allowed).toEqual([]);
    expect(providersOf(none, false)).toEqual({ github: false, google: false, apple: false, email: false });
    const some = readAuthConfig({ ...base, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", APPLE_CLIENT_ID: "a", APPLE_TEAM_ID: "t", SMTP_URL: "smtp://h" })!;
    expect(providersOf(some, true)).toEqual({ github: true, google: true, apple: false, email: true });
    expect(some.email).toEqual({ smtpUrl: "smtp://h", from: "Motif <no-reply@localhost>" });
  });

  it("reads Apple's key with its line breaks, the issuers, the site's address and the chat limit", () => {
    const c = readAuthConfig({
      DATABASE_URL: "postgresql://u:p@h/d", APP_URL: "https://motif.example/", APPLE_CLIENT_ID: "com.example.web", APPLE_TEAM_ID: "TEAM", APPLE_KEY_ID: "KEY", APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
      GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", GOOGLE_ISSUER: "http://localhost:9/", CHAT_PER_HOUR: "5", ALLOWED_EMAILS: "ada@example.com",
    })!;
    expect(c.appUrl).toBe("https://motif.example");
    expect(c.apple?.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    expect(c.apple?.issuer).toBe("https://appleid.apple.com");
    expect(c.google?.issuer).toBe("http://localhost:9");
    expect(c.chatPerHour).toBe(5);
    expect(readAuthConfig({ DATABASE_URL: "postgresql://u:p@h/d", CHAT_PER_HOUR: "0" })!.chatPerHour).toBe(60);
  });
});

describe("connecting to the database", () => {
  it("reads a connection string into the pool's settings, with the user and password decoded", () => {
    expect(poolConfig("postgresql://postgres.abcd:p%40ss%2Fword@aws-0-us-west-2.pooler.supabase.com:5432/postgres", {})).toMatchObject({
      host: "aws-0-us-west-2.pooler.supabase.com", port: 5432, user: "postgres.abcd", password: "p@ss/word", database: "postgres",
    });
    expect(poolConfig("postgres://u:p@db.example.com/motif", {})).toMatchObject({ port: 5432, database: "motif" });
  });

  it("uses TLS for any machine but this one, and checks the server only when it has its certificate", () => {
    expect(poolConfig("postgresql://u:p@db.example.com/d", {}).ssl).toEqual({ rejectUnauthorized: false });
    expect(poolConfig("postgresql://u:p@db.example.com/d", { DATABASE_CA: "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----" }).ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----", rejectUnauthorized: true });
    expect(poolConfig("postgresql://u:p@localhost/d", {}).ssl).toBe(false);
    expect(poolConfig("postgresql://u:p@127.0.0.1/d", {}).ssl).toBe(false);
    // `sslmode` in the string doesn't switch encryption off for a real host, unless it says disable on purpose.
    expect(poolConfig("postgresql://u:p@db.example.com/d?sslmode=require", {}).ssl).toEqual({ rejectUnauthorized: false });
    expect(poolConfig("postgresql://u:p@db.example.com/d?sslmode=disable", {}).ssl).toBe(false);
  });

  it("says what is wrong with a setting that isn't a PostgreSQL connection string", () => {
    expect(() => poolConfig("mysql://u:p@h/d", {})).toThrow(/PostgreSQL connection string/);
    expect(() => poolConfig("not a url", {})).toThrow(/isn't a connection string/);
  });
});

describe.skipIf(!URL)("accounts in a database", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    pool = createPool(URL!);
    for (const t of ["team_projects", "team_invites", "team_members", "teams", "projects", "sessions", "identities", "login_tokens", "rate_buckets", "users", "schema_migrations"]) await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    await migrate(pool);
    db = wrap(pool);
  });
  afterAll(async () => { await pool.end(); await closeAll(); });
  beforeEach(async () => {
    await pool.query("TRUNCATE team_projects, team_invites, team_members, teams, projects, sessions, identities, login_tokens, rate_buckets, users CASCADE");
  });

  describe("the schema", () => {
    it("has row level security on for every table, so Supabase's public API can't read any of them", async () => {
      const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
        "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = current_schema()");
      expect(tables.map((t) => t.relname).sort()).toEqual(["identities", "login_tokens", "projects", "rate_buckets", "schema_migrations", "sessions", "team_invites", "team_members", "team_projects", "teams", "users"]);
      expect(tables.filter((t) => !t.relrowsecurity)).toEqual([]);
      expect(await db.query("SELECT 1 FROM pg_policies WHERE schemaname = current_schema()")).toEqual([]);
    });

    it("is changed all or not at all: a step that fails leaves nothing of it behind", async () => {
      const bad = [{ version: 200, sql: ["CREATE TABLE migration_half (id INT)", "SELECT nope FROM nowhere"] }];
      await expect(migrate(pool, [...MIGRATIONS, ...bad])).rejects.toThrow();
      expect(await db.query("SELECT 1 FROM pg_tables WHERE tablename = 'migration_half'")).toEqual([]);
      expect(await db.query("SELECT 1 FROM schema_migrations WHERE version = 200")).toEqual([]);
    });

    it("is made once and brought up to date without being made again", async () => {
      expect(await migrate(pool)).toEqual([]);
      const rows = await db.query<{ version: number }>("SELECT version FROM schema_migrations");
      expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
    });

    it("applies a new step on top, and only that one", async () => {
      const extra = [...MIGRATIONS, { version: 99, sql: ["CREATE TABLE IF NOT EXISTS migration_probe (id INT)"] }];
      expect(await migrate(pool, extra)).toEqual([99]);
      expect(await migrate(pool, extra)).toEqual([]);
      await pool.query("DROP TABLE migration_probe");
      await pool.query("DELETE FROM schema_migrations WHERE version = 99");
    });

    it("lets servers that start together take turns", async () => {
      const probe = [{ version: 100, sql: ["CREATE TABLE migration_race (id INT)"] }];
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

    it("lets in someone a team has invited, but only while the invitation or the membership holds", async () => {
      const owner = (await createUser(db, { email: "ada@example.com" })).id;
      const made = await createTeam(db, owner, "Team", 1000);
      if (!made.ok) throw new Error("no team");
      const claim = { provider: "google" as const, subject: "g-9", emails: [{ email: "linus@guests.test", verified: true }], name: "Linus" };
      // Nothing yet: not on the list, and nobody has asked them.
      expect(await completeSignIn(db, list, claim, 1500)).toMatchObject({ ok: false, reason: "not-allowed" });
      const invite = await createInvite(db, made.id, owner, "linus@guests.test", 2000);
      if (!invite.ok) throw new Error("no invite");
      const first = await completeSignIn(db, list, claim, 3000);
      expect(first).toMatchObject({ ok: true, created: true, user: { email: "linus@guests.test" } });
      if (!first.ok) return;
      await acceptInviteByToken(db, first.user, invite.token, 3500);
      // As a member they can come back the same way, and by another way with the same address.
      expect(await completeSignIn(db, list, claim, 4000)).toMatchObject({ ok: true, created: false });
      expect(await completeSignIn(db, list, { ...claim, provider: "github", subject: "77" }, 4000)).toMatchObject({ ok: true, linked: true });
      // Taken out of the team, they can't any more, by either way.
      await setRole(db, made.id, owner, first.user.id, "remove");
      expect(await completeSignIn(db, list, claim, 5000)).toMatchObject({ ok: false, reason: "not-allowed" });
      expect(await completeSignIn(db, list, { ...claim, provider: "github", subject: "77" }, 5000)).toMatchObject({ ok: false, reason: "not-allowed" });
    });

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
  describe("projects", () => {
    const payload = (over: Partial<ProjectPayload> = {}): ProjectPayload => ({ name: "Acme", connection: { owner: "acme", repo: "ds", defaultBranch: "main" }, tokenLink: null, tokens: { colors: [] }, docs: [], ...over });
    let ada: string, grace: string;
    beforeEach(async () => {
      ada = (await createUser(db, { email: "ada@example.com" })).id;
      grace = (await createUser(db, { email: "grace@example.com" })).id;
    });

    it("keeps a new project at version 1 and returns exactly what was saved", async () => {
      expect(await saveProject(db, ada, "p1", 0, payload(), 1000)).toEqual({ ok: true, version: 1, updatedAt: 1000, teamId: null });
      const got = await getProject(db, ada, "p1");
      expect(got).toMatchObject({ id: "p1", name: "Acme", version: 1, deleted: false, updatedAt: 1000, data: payload() });
      expect(await listProjects(db, ada)).toEqual([{ id: "p1", version: 1, updatedAt: 1000, deleted: false, teamId: null, updatedBy: null }]);
    });

    it("keeps unicode and large content intact", async () => {
      const big = payload({ name: "Design 🎨 系統", docs: [{ text: "日本語 ".repeat(50_000) }] });
      expect((await saveProject(db, ada, "p1", 0, big)).ok).toBe(true);
      expect((await getProject(db, ada, "p1"))!.data).toEqual(big);
    });

    it("raises the version with each change, from a device that had the latest", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      expect(await saveProject(db, ada, "p1", 1, payload({ name: "Two" }), 2000)).toEqual({ ok: true, version: 2, updatedAt: 2000, teamId: null });
      expect((await getProject(db, ada, "p1"))!.name).toBe("Two");
    });

    it("refuses a change from a device that is behind, and says what the server has", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      await saveProject(db, ada, "p1", 1, payload({ name: "Two" }));
      const r = await saveProject(db, ada, "p1", 1, payload({ name: "Stale" }));
      expect(r).toMatchObject({ ok: false, reason: "conflict", current: { version: 2, name: "Two", deleted: false } });
      expect((await getProject(db, ada, "p1"))!.name).toBe("Two");
    });

    it("refuses a new project whose id is taken, and a version for a project it doesn't have", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      expect(await saveProject(db, ada, "p1", 0, payload({ name: "Again" }))).toMatchObject({ ok: false, reason: "conflict", current: { version: 1 } });
      expect(await saveProject(db, ada, "nope", 3, payload())).toMatchObject({ ok: false, reason: "conflict", current: { deleted: true } });
    });

    it("keeps people's projects apart", async () => {
      await saveProject(db, ada, "p1", 0, payload({ name: "Ada's" }));
      expect(await getProject(db, grace, "p1")).toBeNull();
      expect(await listProjects(db, grace)).toEqual([]);
      expect((await saveProject(db, grace, "p1", 0, payload({ name: "Grace's" }))).ok).toBe(true);
      expect((await getProject(db, ada, "p1"))!.name).toBe("Ada's");
      expect(await removeProject(db, grace, "p1", 1)).toEqual({ ok: true });
      expect((await getProject(db, ada, "p1"))!.deleted).toBe(false);
    });

    it("lets only one of several devices creating the same project win", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => saveProject(db, ada, "race", 0, payload({ name: `D${i}` }))));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.reason === "conflict")).toHaveLength(5);
      expect(await db.query("SELECT 1 FROM projects WHERE id = 'race'")).toHaveLength(1);
    });

    it("lets only one of several devices changing the same version win", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => saveProject(db, ada, "p1", 1, payload({ name: `D${i}` }))));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect((await getProject(db, ada, "p1"))!.version).toBe(2);
    });

    it("deletes a project but keeps a note of it, without the content", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      expect(await removeProject(db, ada, "p1", 1, 5000)).toEqual({ ok: true });
      expect(await getProject(db, ada, "p1")).toMatchObject({ deleted: true, version: 2, data: null, name: "" });
      expect(await db.query<{ data: string }>("SELECT data FROM projects WHERE id = 'p1'")).toEqual([{ data: "" }]);
      expect(await listProjects(db, ada)).toEqual([{ id: "p1", version: 2, updatedAt: 5000, deleted: true, teamId: null, updatedBy: null }]);
      // Deleting it again, or one that isn't there, is fine.
      expect(await removeProject(db, ada, "p1", 1)).toEqual({ ok: true });
      expect(await removeProject(db, ada, "never", 4)).toEqual({ ok: true });
    });

    it("won't delete a project that was changed since the device saw it", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      await saveProject(db, ada, "p1", 1, payload({ name: "Two" }));
      expect(await removeProject(db, ada, "p1", 1)).toMatchObject({ ok: false, reason: "conflict", current: { version: 2, name: "Two" } });
      expect((await getProject(db, ada, "p1"))!.deleted).toBe(false);
    });

    it("refuses changes to a deleted project from a device that hasn't seen it deleted, and revives it for one that has", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      await removeProject(db, ada, "p1", 1);
      expect(await saveProject(db, ada, "p1", 1, payload({ name: "Late" }))).toMatchObject({ ok: false, reason: "conflict", current: { deleted: true, version: 2 } });
      expect(await saveProject(db, ada, "p1", 2, payload({ name: "Back" }), 9000)).toEqual({ ok: true, version: 3, updatedAt: 9000, teamId: null });
      expect(await getProject(db, ada, "p1")).toMatchObject({ deleted: false, name: "Back", version: 3, data: payload({ name: "Back" }) });
    });

    it("forgets old deletions", async () => {
      await saveProject(db, ada, "old", 0, payload(), 1000);
      await removeProject(db, ada, "old", 1, 1000);
      await saveProject(db, ada, "p2", 0, payload(), 1000);
      await removeProject(db, ada, "p2", 1, 1000 + 91 * 86_400_000);
      expect((await listProjects(db, ada)).map((p) => p.id)).toEqual(["p2"]);
    });

    it("stops at 100 projects, counting only those not deleted", async () => {
      await db.exec("INSERT INTO projects (user_id, id, name, data, version, created_at, updated_at) SELECT ?::text, 'b' || seq, 'x', '{}', 1, 1, 1 FROM (" +
        Array.from({ length: 100 }, (_, i) => `SELECT ${i} AS seq`).join(" UNION ALL ") + ") t", [ada]);
      expect(await saveProject(db, ada, "extra", 0, payload())).toEqual({ ok: false, reason: "limit", team: false });
      await removeProject(db, ada, "b1", 1);
      expect((await saveProject(db, ada, "extra", 0, payload())).ok).toBe(true);
      // Grace has her own allowance
      expect((await saveProject(db, grace, "extra", 0, payload())).ok).toBe(true);
    });

    it("goes when the person does", async () => {
      await saveProject(db, ada, "p1", 0, payload());
      await db.exec("DELETE FROM users WHERE id = ?", [ada]);
      expect(await db.query("SELECT 1 FROM projects")).toHaveLength(0);
    });
  });

  describe("teams", () => {
    const payload = (over: Partial<ProjectPayload> = {}): ProjectPayload => ({ name: "Acme", connection: { owner: "acme", repo: "ds", defaultBranch: "main" }, tokenLink: null, tokens: { colors: [] }, docs: [], ...over });
    let ada: string, grace: string, linus: string, team: string;
    const allowed = ["ada@example.com", "grace@example.com"];
    beforeEach(async () => {
      ada = (await createUser(db, { email: "ada@example.com", name: "Ada" })).id;
      grace = (await createUser(db, { email: "grace@example.com", name: "Grace" })).id;
      linus = (await createUser(db, { email: "linus@guests.test", name: "Linus" })).id;
      const made = await createTeam(db, ada, "  Design   team ", 1000);
      if (!made.ok) throw new Error("no team");
      team = made.id;
    });
    const invite = async (email: string, by = ada) => {
      const r = await createInvite(db, team, by, email, 2000);
      if (!r.ok) throw new Error(`invite refused: ${r.reason}`);
      return r;
    };
    const join = async (userId: string, email: string) => { const r = await invite(email); return acceptInviteByToken(db, { id: userId, email }, r.token, 2500); };

    describe("making and listing them", () => {
      it("makes the creator its owner, with a tidied name", async () => {
        expect(await roleIn(db, team, ada)).toBe("owner");
        const teams = await listTeams(db, ada);
        expect(teams).toHaveLength(1);
        expect(teams[0]).toMatchObject({ name: "Design team", role: "owner" });
        expect(teams[0].members).toEqual([{ userId: ada, name: "Ada", email: "ada@example.com", avatar: null, role: "owner" }]);
        expect(await listTeams(db, grace)).toEqual([]);
      });
      it("refuses an empty or long name, and ten teams owned by one person", async () => {
        expect(await createTeam(db, ada, "   ")).toEqual({ ok: false, reason: "name" });
        expect(await createTeam(db, ada, "x".repeat(81))).toEqual({ ok: false, reason: "name" });
        for (let i = 0; i < 9; i++) expect((await createTeam(db, ada, `T${i}`)).ok).toBe(true);
        expect(await createTeam(db, ada, "one more")).toEqual({ ok: false, reason: "limit" });
      });
      it("shows owners the invitations that are out, and members only the people", async () => {
        await join(grace, "grace@example.com");
        await invite("new@example.com");
        const asOwner = (await listTeams(db, ada, 3000))[0];
        const asMember = (await listTeams(db, grace, 3000))[0];
        expect(asOwner.invites.map((i) => i.email)).toEqual(["new@example.com"]);
        expect(asMember.invites).toEqual([]);
        expect(asMember.members.map((m) => m.name)).toEqual(["Ada", "Grace"]);
      });
      it("only an owner renames it", async () => {
        await join(grace, "grace@example.com");
        expect(await renameTeam(db, team, grace, "Mine")).toEqual({ ok: false, reason: "forbidden" });
        expect(await renameTeam(db, team, linus, "Mine")).toEqual({ ok: false, reason: "not-found" });
        expect(await renameTeam(db, team, ada, "Renamed")).toEqual({ ok: true });
        expect((await listTeams(db, ada))[0].name).toBe("Renamed");
      });
    });

    describe("invitations", () => {
      it("are taken up from the emailed link by the address that was invited, once", async () => {
        const r = await invite("linus@guests.test");
        expect(await acceptInviteByToken(db, { id: grace, email: "grace@example.com" }, r.token, 3000)).toEqual({ ok: false, reason: "wrong-email" });
        expect(await acceptInviteByToken(db, { id: linus, email: "linus@guests.test" }, "nonsense", 3000)).toEqual({ ok: false, reason: "not-found" });
        expect(await acceptInviteByToken(db, { id: linus, email: "linus@guests.test" }, r.token, 3000)).toMatchObject({ ok: true, teamId: team });
        expect(await roleIn(db, team, linus)).toBe("member");
        expect(await acceptInviteByToken(db, { id: linus, email: "linus@guests.test" }, r.token, 3001)).toEqual({ ok: false, reason: "not-found" });
      });
      it("only keep the hash of the token", async () => {
        const r = await invite("linus@guests.test");
        const rows = await db.query<{ token_hash: string }>("SELECT token_hash FROM team_invites");
        expect(rows[0].token_hash).toHaveLength(64);
        expect(rows[0].token_hash).not.toContain(r.token);
      });
      it("are taken up from the dashboard by the same address, and listed for it", async () => {
        const r = await invite("Linus@Guests.test");
        expect((await invitesFor(db, "linus@guests.test", 3000)).map((i) => [i.teamName, i.invitedBy])).toEqual([["Design team", "Ada"]]);
        expect(await invitesFor(db, "grace@example.com", 3000)).toEqual([]);
        expect(await acceptInviteById(db, { id: grace, email: "grace@example.com" }, r.id, 3000)).toEqual({ ok: false, reason: "wrong-email" });
        expect((await acceptInviteById(db, { id: linus, email: "linus@guests.test" }, r.id, 3000)).ok).toBe(true);
        expect(await invitesFor(db, "linus@guests.test", 3000)).toEqual([]);
      });
      it("expire after two weeks", async () => {
        const r = await invite("linus@guests.test");
        expect(await acceptInviteByToken(db, { id: linus, email: "linus@guests.test" }, r.token, 2000 + 15 * 86_400_000)).toEqual({ ok: false, reason: "expired" });
        expect(await invitesFor(db, "linus@guests.test", 2000 + 15 * 86_400_000)).toEqual([]);
      });
      it("inviting again replaces the earlier link, and revoking ends it", async () => {
        const first = await invite("linus@guests.test");
        const second = await invite("linus@guests.test");
        expect(await acceptInviteByToken(db, { id: linus, email: "linus@guests.test" }, first.token, 3000)).toEqual({ ok: false, reason: "not-found" });
        expect(await db.query("SELECT 1 FROM team_invites")).toHaveLength(1);
        expect(await revokeInvite(db, team, grace, second.id)).toEqual({ ok: false, reason: "not-found" });
        expect(await revokeInvite(db, team, ada, second.id)).toEqual({ ok: true });
        expect(await acceptInviteByToken(db, { id: linus, email: "linus@guests.test" }, second.token, 3000)).toEqual({ ok: false, reason: "not-found" });
      });
      it("are for owners to send, to addresses that aren't in the team, up to fifty people", async () => {
        await join(grace, "grace@example.com");
        expect(await createInvite(db, team, grace, "x@example.com", 2000)).toEqual({ ok: false, reason: "forbidden" });
        expect(await createInvite(db, team, linus, "x@example.com", 2000)).toEqual({ ok: false, reason: "not-found" });
        expect(await createInvite(db, team, ada, "not an address", 2000)).toEqual({ ok: false, reason: "email" });
        expect(await createInvite(db, team, ada, "grace@example.com", 2000)).toEqual({ ok: false, reason: "member" });
        for (let i = 0; i < MAX_MEMBERS - 2; i++) await invite(`p${i}@example.com`);
        expect(await createInvite(db, team, ada, "straw@example.com", 2000)).toEqual({ ok: false, reason: "limit" });
      });
    });

    describe("who may sign in", () => {
      it("is the server's list, or a team that has someone or has asked them", async () => {
        expect(await mayEnter(db, "ada@example.com", allowed)).toBe(true);
        expect(await mayEnter(db, "linus@guests.test", allowed, 2000)).toBe(false);
        const r = await invite("linus@guests.test");
        expect(await teamAccess(db, "linus@guests.test", 3000)).toBe(true);
        expect(await mayEnter(db, "linus@guests.test", allowed, 3000)).toBe(true);
        expect(await mayEnter(db, "linus@guests.test", allowed, 2000 + 15 * 86_400_000)).toBe(false);
        await acceptInviteByToken(db, { id: linus, email: "linus@guests.test" }, r.token, 3000);
        expect(await mayEnter(db, "linus@guests.test", allowed, 2000 + 30 * 86_400_000)).toBe(true);
        // Out of the team, and no way in.
        await setRole(db, team, ada, linus, "remove");
        expect(await mayEnter(db, "linus@guests.test", allowed, 4000)).toBe(false);
      });
    });

    describe("members and owners", () => {
      beforeEach(async () => { await join(grace, "grace@example.com"); });
      it("owners change roles and remove people; members don't", async () => {
        expect(await setRole(db, team, grace, ada, "member")).toEqual({ ok: false, reason: "forbidden" });
        expect(await setRole(db, team, ada, grace, "owner")).toEqual({ ok: true });
        expect(await roleIn(db, team, grace)).toBe("owner");
        expect(await setRole(db, team, ada, grace, "member")).toEqual({ ok: true });
        expect(await setRole(db, team, ada, grace, "remove")).toEqual({ ok: true });
        expect(await roleIn(db, team, grace)).toBeNull();
        expect(await setRole(db, team, ada, grace, "remove")).toEqual({ ok: false, reason: "not-found" });
      });
      it("a member can leave, and there is always an owner", async () => {
        expect(await setRole(db, team, grace, grace, "remove")).toEqual({ ok: true });
        expect(await setRole(db, team, ada, ada, "remove")).toEqual({ ok: false, reason: "last-owner" });
        expect(await setRole(db, team, ada, ada, "member")).toEqual({ ok: false, reason: "last-owner" });
        await join(grace, "grace@example.com");
        await setRole(db, team, ada, grace, "owner");
        expect(await setRole(db, team, ada, ada, "remove")).toEqual({ ok: true });
      });
      it("two owners leaving at once can't both go", async () => {
        await setRole(db, team, ada, grace, "owner");
        const results = await Promise.all([setRole(db, team, ada, ada, "remove"), setRole(db, team, grace, grace, "remove")]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect((await db.query("SELECT 1 FROM team_members WHERE team_id = ? AND role = 'owner'", [team])).length).toBe(1);
      });
      it("a team goes only when it has no design systems", async () => {
        await saveProject(db, grace, "t1", 0, payload(), 3000, { teamId: team });
        expect(await deleteTeam(db, team, grace)).toEqual({ ok: false, reason: "forbidden" });
        expect(await deleteTeam(db, team, ada)).toEqual({ ok: false, reason: "has-projects" });
        await removeProject(db, ada, "t1", 1, 4000);
        expect(await deleteTeam(db, team, ada)).toEqual({ ok: true });
        expect(await listTeams(db, ada)).toEqual([]);
      });
    });

    describe("the team's design systems", () => {
      beforeEach(async () => { await join(grace, "grace@example.com"); });
      it("are made in a team by its members, and seen by all of them, with who last changed them", async () => {
        expect(await saveProject(db, ada, "t1", 0, payload({ name: "Shared" }), 3000, { teamId: team })).toEqual({ ok: true, version: 1, updatedAt: 3000, teamId: team });
        expect(await listProjects(db, ada)).toEqual([{ id: "t1", version: 1, updatedAt: 3000, deleted: false, teamId: team, updatedBy: "Ada" }]);
        // Grace changes it, from the version she has.
        expect(await saveProject(db, grace, "t1", 1, payload({ name: "Shared 2" }), 4000)).toEqual({ ok: true, version: 2, updatedAt: 4000, teamId: team });
        expect(await getProject(db, ada, "t1")).toMatchObject({ name: "Shared 2", version: 2, teamId: team, updatedBy: "Grace", data: payload({ name: "Shared 2" }) });
        expect((await listProjects(db, grace)).map((p) => [p.id, p.updatedBy])).toEqual([["t1", "Grace"]]);
      });
      it("are unseen and unreachable by anyone outside the team, and say nothing about whether an id exists", async () => {
        await saveProject(db, ada, "t1", 0, payload(), 3000, { teamId: team });
        expect(await listProjects(db, linus)).toEqual([]);
        expect(await getProject(db, linus, "t1")).toBeNull();
        // Linus saving a project with that id makes his own: nothing of the team's is touched.
        expect((await saveProject(db, linus, "t1", 0, payload({ name: "His" }), 3500)).ok).toBe(true);
        expect((await getProject(db, ada, "t1"))!.name).toBe("Acme");
        // And a version he can't know about is the same answer as for something that was never there.
        expect(await saveProject(db, linus, "t2", 5, payload())).toMatchObject({ ok: false, reason: "conflict", current: { deleted: true, version: 0 } });
        expect(await saveProject(db, linus, "t3", 0, payload(), 3600, { teamId: team })).toEqual({ ok: false, reason: "forbidden" });
        expect(await removeProject(db, linus, "t1", 1, 4000)).toEqual({ ok: true });
        expect((await getProject(db, ada, "t1"))!.deleted).toBe(false);
      });
      it("are refused a stale version, so two people can't overwrite each other", async () => {
        await saveProject(db, ada, "t1", 0, payload(), 3000, { teamId: team });
        await saveProject(db, grace, "t1", 1, payload({ name: "Grace's" }), 4000);
        expect(await saveProject(db, ada, "t1", 1, payload({ name: "Ada's" }), 5000)).toMatchObject({ ok: false, reason: "conflict", current: { name: "Grace's", version: 2 } });
      });
      it("take six writers at once with exactly one winner per version", async () => {
        await saveProject(db, ada, "t1", 0, payload(), 3000, { teamId: team });
        const results = await Promise.all([ada, grace, ada, grace, ada, grace].map((u, i) => saveProject(db, u, "t1", 1, payload({ name: `W${i}` }), 4000 + i)));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.reason === "conflict")).toHaveLength(5);
        expect((await getProject(db, ada, "t1"))!.version).toBe(2);
      });
      it("are deleted for everyone only by an owner, and members learn of it", async () => {
        await saveProject(db, ada, "t1", 0, payload(), 3000, { teamId: team });
        expect(await removeProject(db, grace, "t1", 1, 4000)).toEqual({ ok: false, reason: "forbidden" });
        expect(await removeProject(db, ada, "t1", 1, 4000)).toEqual({ ok: true });
        expect(await listProjects(db, grace)).toEqual([{ id: "t1", version: 2, updatedAt: 4000, deleted: true, teamId: team, updatedBy: "Ada" }]);
      });
      it("stop at a hundred a team, counting only those not deleted", async () => {
        await db.exec("INSERT INTO team_projects (team_id, id, name, data, version, created_at, updated_at) SELECT ?::text, 'b' || seq, 'x', '{}', 1, 1, 1 FROM (" +
          Array.from({ length: MAX_TEAM_PROJECTS }, (_, i) => `SELECT ${i} AS seq`).join(" UNION ALL ") + ") t", [team]);
        expect(await saveProject(db, ada, "extra", 0, payload(), 3000, { teamId: team })).toEqual({ ok: false, reason: "limit", team: true });
        await removeProject(db, ada, "b1", 1);
        expect((await saveProject(db, ada, "extra", 0, payload(), 3000, { teamId: team })).ok).toBe(true);
      });
      it("are lost to a person who is taken out of the team, not to the team", async () => {
        await saveProject(db, grace, "t1", 0, payload(), 3000, { teamId: team });
        await setRole(db, team, ada, grace, "remove");
        expect(await listProjects(db, grace)).toEqual([]);
        expect(await getProject(db, grace, "t1")).toBeNull();
        expect((await listProjects(db, ada)).map((p) => p.id)).toEqual(["t1"]);
      });
      it("outlive the person who made them", async () => {
        await saveProject(db, grace, "t1", 0, payload(), 3000, { teamId: team });
        await db.exec("DELETE FROM users WHERE id = ?", [grace]);
        const got = await getProject(db, ada, "t1");
        expect(got).toMatchObject({ id: "t1", deleted: false });
        expect(got!.updatedBy).toBeNull();
      });
    });

    describe("moving a design system", () => {
      beforeEach(async () => { await join(grace, "grace@example.com"); });
      it("into a team leaves a note in the old place, so devices learn it moved", async () => {
        await saveProject(db, grace, "p1", 0, payload({ name: "Mine" }), 3000);
        expect(await moveProject(db, grace, "p1", { teamId: team }, 4000)).toEqual({ ok: true, version: 2, teamId: team });
        const list = await listProjects(db, grace);
        expect(list.map((p) => [p.id, p.teamId, p.deleted]).sort()).toEqual([["p1", null, true], ["p1", team, false]]);
        // It is the team's project now, found by its id, for every member.
        expect(await getProject(db, grace, "p1")).toMatchObject({ teamId: team, name: "Mine", deleted: false, data: payload({ name: "Mine" }) });
        expect(await getProject(db, ada, "p1")).toMatchObject({ teamId: team, name: "Mine" });
      });
      it("into a team the person isn't in, or one that doesn't exist, is refused", async () => {
        await saveProject(db, linus, "p1", 0, payload(), 3000);
        expect(await moveProject(db, linus, "p1", { teamId: team }, 4000)).toEqual({ ok: false, reason: "forbidden" });
        expect(await moveProject(db, linus, "nope", { teamId: team }, 4000)).toEqual({ ok: false, reason: "not-found" });
      });
      it("out of a team to the owner's own is for owners, and can go back in", async () => {
        await saveProject(db, grace, "t1", 0, payload(), 3000, { teamId: team });
        expect(await moveProject(db, grace, "t1", { teamId: null }, 4000)).toEqual({ ok: false, reason: "forbidden" });
        expect(await moveProject(db, ada, "t1", { teamId: null }, 4000)).toMatchObject({ ok: true, teamId: null });
        expect((await getProject(db, ada, "t1"))).toMatchObject({ teamId: null, deleted: false });
        expect((await getProject(db, grace, "t1"))).toMatchObject({ deleted: true });
        // And back into the team: the old deleted note is replaced.
        expect(await moveProject(db, ada, "t1", { teamId: team }, 5000)).toMatchObject({ ok: true, teamId: team });
        expect(await getProject(db, grace, "t1")).toMatchObject({ teamId: team, deleted: false });
      });
      it("is refused where it already is", async () => {
        await saveProject(db, ada, "p1", 0, payload(), 3000);
        expect(await moveProject(db, ada, "p1", { teamId: null }, 4000)).toEqual({ ok: false, reason: "exists" });
        await moveProject(db, ada, "p1", { teamId: team }, 4000);
        expect(await moveProject(db, ada, "p1", { teamId: team }, 5000)).toEqual({ ok: false, reason: "exists" });
      });
    });
  });
});
