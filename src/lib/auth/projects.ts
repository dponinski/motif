import type { Db } from "./db";
import { isDuplicate } from "./store";
import { MAX_PROJECTS, type ProjectPayload } from "../sync/payload";

// A person's projects on the server. The server keeps what a device sends and a version number, nothing more: it
// doesn't read the tokens or the documentation, and a change is taken only from a device that had the latest version.

const TOMBSTONE_DAYS = 90;
// Devices saving the same project at the same moment can make the database give up on one of the transactions;
// trying that one again finds what the other did.
const retryable = (err: unknown) => {
  const code = (err as { code?: string } | null)?.code;
  // A deadlock, or a transaction that couldn't be serialised.
  return code === "40P01" || code === "40001";
};
async function withRetry<T>(work: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await work(); } catch (err) {
      if (!retryable(err) || i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 10 * i + Math.random() * 20));
    }
  }
}

export const PROJECT_ID = /^[A-Za-z0-9_-]{1,32}$/;

export interface ProjectSummary { id: string; version: number; updatedAt: number; deleted: boolean }
export interface StoredProject extends ProjectSummary { name: string; data: ProjectPayload | null }

interface Row { id: string; name: string; data: string; version: number; updated_at: number | string; deleted_at: number | string | null }

const toStored = (r: Row): StoredProject => ({
  id: r.id,
  name: r.name,
  version: r.version,
  updatedAt: Number(r.updated_at),
  deleted: r.deleted_at !== null,
  data: r.deleted_at !== null || !r.data ? null : (JSON.parse(r.data) as ProjectPayload),
});

export async function listProjects(db: Db, userId: string): Promise<ProjectSummary[]> {
  const rows = await db.query<Row>("SELECT id, name, '' AS data, version, updated_at, deleted_at FROM projects WHERE user_id = ? ORDER BY created_at, id", [userId]);
  return rows.map((r) => ({ id: r.id, version: r.version, updatedAt: Number(r.updated_at), deleted: r.deleted_at !== null }));
}

export async function getProject(db: Db, userId: string, id: string): Promise<StoredProject | null> {
  const rows = await db.query<Row>("SELECT id, name, data, version, updated_at, deleted_at FROM projects WHERE user_id = ? AND id = ?", [userId, id]);
  return rows[0] ? toStored(rows[0]) : null;
}

export type SaveResult =
  | { ok: true; version: number; updatedAt: number }
  // Someone else (another device) changed it since: this is what the server has now.
  | { ok: false; reason: "conflict"; current: StoredProject | { id: string; version: number; updatedAt: number; deleted: true; name: ""; data: null } }
  | { ok: false; reason: "limit" };

// Saves a project, if the device had its latest version (0 for a new one).
export async function saveProject(db: Db, userId: string, id: string, baseVersion: number, payload: ProjectPayload, now = Date.now()): Promise<SaveResult> {
  const text = JSON.stringify(payload);
  try {
    return await withRetry(() => db.tx(async (tx) => {
      const rows = await tx.query<Row>("SELECT id, name, data, version, updated_at, deleted_at FROM projects WHERE user_id = ? AND id = ? FOR UPDATE", [userId, id]);
      const row = rows[0];
      if (!row) {
        // Unknown here, but the device thought it had a version: it was deleted and forgotten, or never was ours.
        if (baseVersion !== 0) return { ok: false, reason: "conflict", current: { id, version: 0, updatedAt: now, deleted: true, name: "", data: null } } as const;
        const [{ n }] = await tx.query<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL", [userId]);
        if (Number(n) >= MAX_PROJECTS) return { ok: false, reason: "limit" } as const;
        await tx.exec("INSERT INTO projects (user_id, id, name, data, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 1, ?, ?, NULL)", [userId, id, payload.name, text, now, now]);
        return { ok: true, version: 1, updatedAt: now } as const;
      }
      if (row.version !== baseVersion) return { ok: false, reason: "conflict", current: toStored(row) } as const;
      // A deleted project is brought back by a device that has seen it was deleted and keeps its own copy.
      if (row.deleted_at !== null) {
        const [{ n }] = await tx.query<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL", [userId]);
        if (Number(n) >= MAX_PROJECTS) return { ok: false, reason: "limit" } as const;
      }
      await tx.exec("UPDATE projects SET name = ?, data = ?, version = version + 1, updated_at = ?, deleted_at = NULL WHERE user_id = ? AND id = ?", [payload.name, text, now, userId, id]);
      return { ok: true, version: row.version + 1, updatedAt: now } as const;
    }));
  } catch (err) {
    // Two devices creating the same project at once: the other got there first.
    if (!isDuplicate(err)) throw err;
    const current = await getProject(db, userId, id);
    if (!current) throw err;
    return { ok: false, reason: "conflict", current };
  }
}

export type RemoveResult = { ok: true } | { ok: false; reason: "conflict"; current: StoredProject };

// Deletes a project, if the device had its latest version. Deleting what is gone already is fine.
export async function removeProject(db: Db, userId: string, id: string, baseVersion: number, now = Date.now()): Promise<RemoveResult> {
  return withRetry(() => db.tx(async (tx) => {
    const rows = await tx.query<Row>("SELECT id, name, data, version, updated_at, deleted_at FROM projects WHERE user_id = ? AND id = ? FOR UPDATE", [userId, id]);
    const row = rows[0];
    if (!row || row.deleted_at !== null) return { ok: true } as const;
    if (row.version !== baseVersion) return { ok: false, reason: "conflict", current: toStored(row) } as const;
    // The content goes at once; the row stays for a while so other devices learn that it was deleted.
    await tx.exec("UPDATE projects SET name = '', data = '', version = version + 1, updated_at = ?, deleted_at = ? WHERE user_id = ? AND id = ?", [now, now, userId, id]);
    await tx.exec("DELETE FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?", [userId, now - TOMBSTONE_DAYS * 86_400_000]);
    return { ok: true } as const;
  }));
}
