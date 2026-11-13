import mysql from "mysql2/promise";

// The database accounts are kept in: MySQL or MariaDB, through a small pool. The schema is made and brought up to
// date by the server when it first needs it, so setting up is giving it an empty database.

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<{ affectedRows: number }>;
  // Runs several statements as one: on one connection, all or nothing, with the rows they touch held until the end.
  tx<T>(work: (tx: Db) => Promise<T>): Promise<T>;
}

const ENGINE = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC";

// Each step runs once, in order, and is never changed after it has shipped: a change is a new step.
export const MIGRATIONS: { version: number; sql: string[] }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE users (
        id CHAR(22) NOT NULL PRIMARY KEY,
        email VARCHAR(254) NOT NULL,
        name VARCHAR(200) NULL,
        avatar_url VARCHAR(500) NULL,
        created_at BIGINT NOT NULL,
        last_login_at BIGINT NOT NULL,
        UNIQUE KEY users_email (email)
      ) ${ENGINE}`,
      // One row per way a person has signed in: the provider and what it calls them. Several can belong to one user.
      `CREATE TABLE identities (
        provider VARCHAR(16) NOT NULL,
        subject VARCHAR(190) NOT NULL,
        user_id CHAR(22) NOT NULL,
        email VARCHAR(254) NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (provider, subject),
        KEY identities_user (user_id),
        CONSTRAINT fk_identities_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${ENGINE}`,
      // The session token itself is only ever in the person's cookie; what is kept here is its hash.
      `CREATE TABLE sessions (
        id CHAR(64) NOT NULL PRIMARY KEY,
        user_id CHAR(22) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        user_agent VARCHAR(200) NULL,
        KEY sessions_user (user_id),
        KEY sessions_expires (expires_at),
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${ENGINE}`,
      // The links that are emailed: again only the hash, used once.
      `CREATE TABLE login_tokens (
        id CHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(254) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        used_at BIGINT NULL,
        KEY login_tokens_expires (expires_at)
      ) ${ENGINE}`,
      // Counters for limits: emails sent, sign-in attempts, chat messages.
      `CREATE TABLE rate_buckets (
        bucket VARCHAR(190) NOT NULL PRIMARY KEY,
        hits INT NOT NULL,
        expires_at BIGINT NOT NULL,
        KEY rate_buckets_expires (expires_at)
      ) ${ENGINE}`,
    ],
  },
];

type Runner = Pick<mysql.Pool, "query">;

function runner(target: Runner, pool: mysql.Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const [rows] = await target.query(sql, params);
      return rows as T[];
    },
    async exec(sql: string, params: unknown[] = []) {
      const [result] = await target.query(sql, params);
      return { affectedRows: (result as mysql.ResultSetHeader).affectedRows };
    },
    async tx<T>(work: (tx: Db) => Promise<T>) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await work(runner(conn as unknown as Runner, pool));
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}

export const wrap = (pool: mysql.Pool): Db => runner(pool, pool);

// Brings the schema up to date. Servers that start together take turns, so a step isn't run twice.
export async function migrate(pool: mysql.Pool, steps = MIGRATIONS): Promise<number[]> {
  const conn = await pool.getConnection();
  const applied: number[] = [];
  try {
    const [lock] = await conn.query("SELECT GET_LOCK('motif_migrations', 30) AS got");
    if ((lock as { got: number }[])[0]?.got !== 1) throw new Error("Another server is changing the database; try again in a moment");
    try {
      await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INT NOT NULL PRIMARY KEY, applied_at BIGINT NOT NULL) ${ENGINE}`);
      const [done] = await conn.query("SELECT version FROM schema_migrations");
      const have = new Set((done as { version: number }[]).map((r) => r.version));
      for (const step of steps) {
        if (have.has(step.version)) continue;
        for (const statement of step.sql) await conn.query(statement);
        await conn.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [step.version, Date.now()]);
        applied.push(step.version);
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK('motif_migrations')");
    }
  } finally {
    conn.release();
  }
  return applied;
}

interface Cached { pool: mysql.Pool; db: Db; ready: Promise<void> }
const cache = (globalThis as unknown as { __motifDb?: Map<string, Cached> }).__motifDb ?? new Map<string, Cached>();
(globalThis as unknown as { __motifDb?: Map<string, Cached> }).__motifDb = cache;

export function createPool(url: string): mysql.Pool {
  return mysql.createPool({ uri: url, waitForConnections: true, connectionLimit: 6, charset: "utf8mb4", timezone: "Z", connectTimeout: 10_000 });
}

// The database for a connection URL, ready to use: made once and shared by every request (and by hot reloads).
export async function getDb(url: string): Promise<Db> {
  let entry = cache.get(url);
  if (!entry) {
    const pool = createPool(url);
    entry = { pool, db: wrap(pool), ready: migrate(pool).then(() => undefined) };
    cache.set(url, entry);
    // A failed first try (the database wasn't up yet) is tried again by the next request.
    entry.ready.catch(() => { if (cache.get(url) === entry) { cache.delete(url); void pool.end().catch(() => {}); } });
  }
  await entry.ready;
  return entry.db;
}

export async function closeAll() {
  for (const entry of cache.values()) await entry.pool.end().catch(() => {});
  cache.clear();
}
