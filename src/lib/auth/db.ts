import { Pool, types, type PoolClient, type PoolConfig } from "pg";

// The database accounts and projects are kept in: PostgreSQL (Supabase, or any other), through a small pool. The schema is
// made and brought up to date by the server when it first needs it, so setting up is giving it an empty database.

// BIGINT (timestamps in milliseconds, counts) comes back as numbers, not strings: none of them is near 2^53.
types.setTypeParser(20, (v) => Number(v));

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<{ affectedRows: number }>;
  // Runs several statements as one: on one connection, all or nothing, with the rows they touch held until the end.
  tx<T>(work: (tx: Db) => Promise<T>): Promise<T>;
}

// Everything that is made here is closed to Supabase's public API (the one the publishable key opens): row level
// security is on with no policies, and the API roles have no rights. The server reaches the tables with its own
// connection, which is the table owner and so isn't held back by either.
export const lockdown = (tables: string[]) => `DO $lock$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[${tables.map((t) => `'${t}'`).join(", ")}] LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM anon', current_schema(), t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM authenticated', current_schema(), t);
    END IF;
  END LOOP;
END
$lock$`;

// Each step runs once, in order, and is never changed after it has shipped: a change is a new step.
export const MIGRATIONS: { version: number; sql: string[] }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE users (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        email VARCHAR(254) NOT NULL,
        name VARCHAR(200) NULL,
        avatar_url VARCHAR(500) NULL,
        created_at BIGINT NOT NULL,
        last_login_at BIGINT NOT NULL,
        CONSTRAINT users_email UNIQUE (email)
      )`,
      // One row per way a person has signed in: the provider and what it calls them. Several can belong to one user.
      `CREATE TABLE identities (
        provider VARCHAR(16) NOT NULL,
        subject VARCHAR(190) NOT NULL,
        user_id VARCHAR(32) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        email VARCHAR(254) NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (provider, subject)
      )`,
      `CREATE INDEX identities_user ON identities (user_id)`,
      // The session token itself is only ever in the person's cookie; what is kept here is its hash.
      `CREATE TABLE sessions (
        id CHAR(64) NOT NULL PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        user_agent VARCHAR(200) NULL
      )`,
      `CREATE INDEX sessions_user ON sessions (user_id)`,
      `CREATE INDEX sessions_expires ON sessions (expires_at)`,
      // The links that are emailed: again only the hash, used once.
      `CREATE TABLE login_tokens (
        id CHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(254) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        used_at BIGINT NULL
      )`,
      `CREATE INDEX login_tokens_expires ON login_tokens (expires_at)`,
      // Counters for limits: emails sent, sign-in attempts, chat messages.
      `CREATE TABLE rate_buckets (
        bucket VARCHAR(190) NOT NULL PRIMARY KEY,
        hits INT NOT NULL,
        expires_at BIGINT NOT NULL
      )`,
      `CREATE INDEX rate_buckets_expires ON rate_buckets (expires_at)`,
      lockdown(["users", "identities", "sessions", "login_tokens", "rate_buckets"]),
    ],
  },
  {
    version: 2,
    sql: [
      // A person's projects. What is kept is the JSON of what they made (see lib/sync/payload.ts); the version goes
      // up with every change, so a device that was behind finds out instead of overwriting. A deleted project stays
      // as a row without its content for a while, so devices that still have it find out it was deleted.
      `CREATE TABLE projects (
        user_id VARCHAR(32) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        id VARCHAR(32) NOT NULL,
        name VARCHAR(200) NOT NULL,
        data TEXT NOT NULL,
        version INT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        deleted_at BIGINT NULL,
        PRIMARY KEY (user_id, id)
      )`,
      `CREATE INDEX projects_deleted ON projects (deleted_at)`,
      lockdown(["projects"]),
    ],
  },
];

type Runner = Pick<Pool, "query">;

// SQL is written with `?` for values (there are none in any text); Postgres wants $1, $2, ...
const numbered = (sql: string) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

function runner(target: Runner, pool: Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await target.query(numbered(sql), params as unknown[]);
      return result.rows as T[];
    },
    async exec(sql: string, params: unknown[] = []) {
      const result = await target.query(numbered(sql), params as unknown[]);
      return { affectedRows: result.rowCount ?? 0 };
    },
    async tx<T>(work: (tx: Db) => Promise<T>) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(runner(client, pool));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export const wrap = (pool: Pool): Db => runner(pool, pool);

// Brings the schema up to date, all in one transaction (Postgres can roll back a schema change). Servers that start
// together take turns on a lock that lasts until the transaction ends, which works through Supabase's connection
// pooler as well, so a step isn't run twice.
export async function migrate(pool: Pool, steps = MIGRATIONS): Promise<number[]> {
  const client = await pool.connect();
  const applied: number[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727274)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INT NOT NULL PRIMARY KEY, applied_at BIGINT NOT NULL)");
    await client.query(lockdown(["schema_migrations"]));
    const done = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
    const have = new Set(done.rows.map((r) => r.version));
    for (const step of steps) {
      if (have.has(step.version)) continue;
      for (const statement of step.sql) await client.query(statement);
      await client.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [step.version, Date.now()]);
      applied.push(step.version);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return applied;
}

interface Cached { pool: Pool; db: Db; ready: Promise<void> }
const cache = (globalThis as unknown as { __motifDb?: Map<string, Cached> }).__motifDb ?? new Map<string, Cached>();
(globalThis as unknown as { __motifDb?: Map<string, Cached> }).__motifDb = cache;

// The pool's settings from a connection string (postgresql://user:password@host:5432/database). The string is read here,
// not by the driver, so that `sslmode=` in it can't quietly decide how the connection is secured.
//
// Anything but this machine is connected to over TLS. The server's certificate is checked against DATABASE_CA when that is
// set (Supabase: Project settings, Database, SSL configuration, "Download certificate"); without it the connection is
// encrypted but the server isn't verified.
export function poolConfig(url: string, env: Record<string, string | undefined> = process.env): PoolConfig {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("DATABASE_URL isn't a connection string (expected postgresql://user:password@host:5432/database)");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string (postgresql://user:password@host:5432/database)");
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  const off = u.searchParams.get("sslmode") === "disable";
  const ca = env.DATABASE_CA?.trim().replace(/\\n/g, "\n");
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    ssl: local || off ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: 6,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: "motif",
  };
}

export function createPool(url: string): Pool {
  const pool = new Pool(poolConfig(url));
  // A connection that drops while idle (the database restarted) is replaced by the pool; it isn't an error to crash on.
  pool.on("error", (err) => console.error("A database connection failed:", err.message));
  return pool;
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
