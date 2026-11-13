import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "./db";

// What is kept about accounts. Every function takes the database it works on, so it is the same code in a request
// and in a test.

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
}

interface UserRow { id: string; email: string; name: string | null; avatar_url: string | null }
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, avatar: r.avatar_url });

export const SESSION_DAYS = 30;
export const LOGIN_LINK_MINUTES = 15;
const DAY = 86_400_000;

// A token is 256 random bits; only its hash is kept, so a copy of the database can't sign anyone in.
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUser(db: Db, id: string): Promise<User | null> {
  const rows = await db.query<UserRow>("SELECT id, email, name, avatar_url FROM users WHERE id = ?", [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const rows = await db.query<UserRow>("SELECT id, email, name, avatar_url FROM users WHERE email = ?", [email]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findIdentity(db: Db, provider: string, subject: string): Promise<User | null> {
  const rows = await db.query<UserRow>(
    "SELECT u.id, u.email, u.name, u.avatar_url FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?",
    [provider, subject]
  );
  return rows[0] ? toUser(rows[0]) : null;
}

// Whether an error is the database saying a row with that key is already there.
export const isDuplicate = (err: unknown) => (err as { code?: string; errno?: number } | null)?.code === "ER_DUP_ENTRY" || (err as { errno?: number } | null)?.errno === 1062;

export async function createUser(db: Db, input: { email: string; name?: string | null; avatar?: string | null }, now = Date.now()): Promise<User> {
  const id = nanoid(22);
  await db.exec("INSERT INTO users (id, email, name, avatar_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id, input.email, input.name?.slice(0, 200) ?? null, input.avatar?.slice(0, 500) ?? null, now, now,
  ]);
  return { id, email: input.email, name: input.name?.slice(0, 200) ?? null, avatar: input.avatar?.slice(0, 500) ?? null };
}

// Notes that someone signed in, and fills in a name or picture they didn't have before.
export async function touchUser(db: Db, id: string, input: { name?: string | null; avatar?: string | null }, now = Date.now()) {
  await db.exec(
    "UPDATE users SET last_login_at = ?, name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?) WHERE id = ?",
    [now, input.name?.slice(0, 200) ?? null, input.avatar?.slice(0, 500) ?? null, id]
  );
}

export async function linkIdentity(db: Db, userId: string, provider: string, subject: string, email: string | null, now = Date.now()) {
  // Linking twice is not an error: the same person signing in again.
  await db.exec("INSERT IGNORE INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)", [provider, subject, userId, email, now]);
}

export async function identitiesOf(db: Db, userId: string): Promise<{ provider: string; subject: string; email: string | null }[]> {
  return db.query("SELECT provider, subject, email FROM identities WHERE user_id = ? ORDER BY created_at", [userId]);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(db: Db, userId: string, userAgent: string | null, now = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const token = newToken();
  const expiresAt = now + SESSION_DAYS * DAY;
  await db.exec("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)", [
    hashToken(token), userId, now, expiresAt, now, userAgent?.slice(0, 200) ?? null,
  ]);
  return { token, expiresAt };
}

// Who a session token belongs to, while it is good. Using a session keeps it going: its end moves on, at most once an
// hour, so a person who keeps coming back isn't signed out and the database isn't written to on every request.
export async function getSession(db: Db, token: string, now = Date.now()): Promise<{ user: User; expiresAt: number } | null> {
  const rows = await db.query<UserRow & { expires_at: number; last_seen_at: number }>(
    "SELECT u.id, u.email, u.name, u.avatar_url, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?",
    [hashToken(token), now]
  );
  const row = rows[0];
  if (!row) return null;
  let expiresAt = Number(row.expires_at);
  if (now - Number(row.last_seen_at) > 3_600_000) {
    expiresAt = now + SESSION_DAYS * DAY;
    await db.exec("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", [now, expiresAt, hashToken(token)]);
  }
  return { user: toUser(row), expiresAt };
}

export async function deleteSession(db: Db, token: string) {
  await db.exec("DELETE FROM sessions WHERE id = ?", [hashToken(token)]);
}

export async function deleteUserSessions(db: Db, userId: string) {
  await db.exec("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

// ── Emailed links ─────────────────────────────────────────────────────────────

export async function createLoginToken(db: Db, email: string, now = Date.now()): Promise<string> {
  const token = newToken();
  await db.exec("INSERT INTO login_tokens (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)", [hashToken(token), email, now, now + LOGIN_LINK_MINUTES * 60_000]);
  return token;
}

// Spends a link: the address it was sent to, or null when it is unknown, used or out of date. Two people (or one
// person and a mail scanner) who use it at the same moment can't both have it.
export async function consumeLoginToken(db: Db, token: string, now = Date.now()): Promise<string | null> {
  const id = hashToken(token);
  const rows = await db.query<{ email: string }>("SELECT email FROM login_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?", [id, now]);
  if (!rows[0]) return null;
  const won = await db.exec("UPDATE login_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL", [now, id]);
  return won.affectedRows === 1 ? rows[0].email : null;
}

// Links that were asked for and not used, for an address, since a time: what an address may be sent is limited.
export async function pruneExpired(db: Db, now = Date.now()) {
  await db.exec("DELETE FROM sessions WHERE expires_at <= ?", [now]);
  await db.exec("DELETE FROM login_tokens WHERE expires_at <= ?", [now - DAY]);
  await db.exec("DELETE FROM rate_buckets WHERE expires_at <= ?", [now]);
}

// ── Limits ────────────────────────────────────────────────────────────────────

// Counts one use of `bucket`, which lasts `windowMs` from its first use. Says whether it is still within `limit`. The
// count and the answer are one transaction, so each of many uses at once is given its own number.
export async function hit(db: Db, bucket: string, limit: number, windowMs: number, now = Date.now()): Promise<{ ok: boolean; hits: number; resetsAt: number }> {
  const key = bucket.slice(0, 190);
  return db.tx(async (tx) => {
    // An old bucket is started again; one in its window counts up.
    await tx.exec(
      "INSERT INTO rate_buckets (bucket, hits, expires_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE hits = IF(expires_at <= ?, 1, hits + 1), expires_at = IF(expires_at <= ?, ?, expires_at)",
      [key, now + windowMs, now, now, now + windowMs]
    );
    const rows = await tx.query<{ hits: number; expires_at: number }>("SELECT hits, expires_at FROM rate_buckets WHERE bucket = ?", [key]);
    const hits = Number(rows[0]?.hits ?? 1);
    return { ok: hits <= limit, hits, resetsAt: Number(rows[0]?.expires_at ?? now + windowMs) };
  });
}
