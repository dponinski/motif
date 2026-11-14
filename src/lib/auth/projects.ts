import type { Db } from "./db";
import { isDuplicate } from "./store";
import type { Role } from "./teams";
import { MAX_PROJECTS, type ProjectPayload } from "../sync/payload";

// The design systems a person can reach on the server: their own, and those of the teams they are in. The server keeps
// what a device sends and a version number, nothing more: it doesn't read the tokens or the documentation, and a change is
// taken only from a device that had the latest version. A design system a team shares is changed by any of its members and
// deleted only by an owner.

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
// What one team can hold, as one person can hold MAX_PROJECTS of their own.
export const MAX_TEAM_PROJECTS = 100;

export interface ProjectSummary {
  id: string; version: number; updatedAt: number; deleted: boolean;
  // The team that shares it, or null for a person's own.
  teamId: string | null;
  // Who last changed it, by name (a team's design systems only).
  updatedBy: string | null;
}
export interface StoredProject extends ProjectSummary { name: string; data: ProjectPayload | null }

interface Row {
  id: string; name: string; data: string; version: number; updated_at: number | string; deleted_at: number | string | null;
  team_id?: string | null; role?: Role | null; updated_by?: string | null;
}

const toStored = (r: Row): StoredProject => ({
  id: r.id,
  name: r.name,
  version: r.version,
  updatedAt: Number(r.updated_at),
  deleted: r.deleted_at !== null,
  teamId: r.team_id ?? null,
  updatedBy: r.updated_by ?? null,
  data: r.deleted_at !== null || !r.data ? null : (JSON.parse(r.data) as ProjectPayload),
});

// What is asked of a project's row, kept to values this file chooses (never text from a request).
interface Where { table: "projects" | "team_projects"; keyCol: "user_id" | "team_id"; keyVal: string }
interface Located { where: Where; row: Row; role: Role | null }

// Where a project is for a person: their own, or a team's they are in. A deleted one counts, so a device finds out; when
// the same id has been moved from one to the other, the one that is alive is the project.
async function locate(db: Db, userId: string, id: string, lock = false): Promise<Located | null> {
  const lockMine = lock ? " FOR UPDATE" : "";
  const personal = (await db.query<Row>(`SELECT id, name, data, version, updated_at, deleted_at FROM projects WHERE user_id = ? AND id = ?${lockMine}`, [userId, id]))[0];
  const team = (await db.query<Row>(
    `SELECT tp.id, tp.name, tp.data, tp.version, tp.updated_at, tp.deleted_at, tp.team_id, m.role, COALESCE(u.name, u.email) AS updated_by
     FROM team_projects tp JOIN team_members m ON m.team_id = tp.team_id AND m.user_id = ? LEFT JOIN users u ON u.id = tp.updated_by
     WHERE tp.id = ? ORDER BY (tp.deleted_at IS NULL) DESC, tp.updated_at DESC LIMIT 1${lock ? " FOR UPDATE OF tp" : ""}`, [userId, id]))[0];
  const mine = personal && { where: { table: "projects", keyCol: "user_id", keyVal: userId } as Where, row: personal, role: null };
  const theirs = team && { where: { table: "team_projects", keyCol: "team_id", keyVal: team.team_id as string } as Where, row: team, role: team.role ?? null };
  if (mine && theirs) return personal.deleted_at === null || theirs.row.deleted_at !== null ? mine : theirs;
  return mine ?? theirs ?? null;
}

export async function listProjects(db: Db, userId: string): Promise<ProjectSummary[]> {
  const own = await db.query<Row>("SELECT id, name, '' AS data, version, updated_at, deleted_at FROM projects WHERE user_id = ? ORDER BY created_at, id", [userId]);
  const shared = await db.query<Row>(
    `SELECT tp.id, tp.name, '' AS data, tp.version, tp.updated_at, tp.deleted_at, tp.team_id, COALESCE(u.name, u.email) AS updated_by
     FROM team_projects tp JOIN team_members m ON m.team_id = tp.team_id AND m.user_id = ? LEFT JOIN users u ON u.id = tp.updated_by ORDER BY tp.created_at, tp.id`, [userId]);
  return [...own, ...shared].map((r) => { const { name: _name, data: _data, ...summary } = toStored(r); return summary; });
}

export async function getProject(db: Db, userId: string, id: string): Promise<StoredProject | null> {
  const found = await locate(db, userId, id);
  return found ? toStored(found.row) : null;
}

type Gone = { id: string; version: number; updatedAt: number; deleted: true; name: ""; data: null; teamId: null; updatedBy: null };
const gone = (id: string, now: number): Gone => ({ id, version: 0, updatedAt: now, deleted: true, name: "", data: null, teamId: null, updatedBy: null });

export type SaveResult =
  | { ok: true; version: number; updatedAt: number; teamId: string | null }
  // Someone else (another device, or a teammate) changed it since: this is what the server has now.
  | { ok: false; reason: "conflict"; current: StoredProject | Gone }
  | { ok: false; reason: "limit"; team: boolean }
  // A new project asked to go into a team the person isn't in.
  | { ok: false; reason: "forbidden" };

async function liveCount(db: Db, where: Where): Promise<number> {
  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${where.table} WHERE ${where.keyCol} = ? AND deleted_at IS NULL`, [where.keyVal]);
  return Number(n);
}

// Saves a project, if the device had its latest version (0 for a new one, which goes into a team when `teamId` says).
export async function saveProject(db: Db, userId: string, id: string, baseVersion: number, payload: ProjectPayload, now = Date.now(), options: { teamId?: string | null } = {}): Promise<SaveResult> {
  const text = JSON.stringify(payload);
  try {
    return await withRetry(() => db.tx(async (tx) => {
      const found = await locate(tx, userId, id, true);
      if (!found) {
        // Unknown here, but the device thought it had a version: it was deleted and forgotten, or never was ours.
        if (baseVersion !== 0) return { ok: false, reason: "conflict", current: gone(id, now) } as const;
        const teamId = options.teamId ?? null;
        if (teamId) {
          const member = await tx.query("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]);
          if (member.length === 0) return { ok: false, reason: "forbidden" } as const;
          const where: Where = { table: "team_projects", keyCol: "team_id", keyVal: teamId };
          if ((await liveCount(tx, where)) >= MAX_TEAM_PROJECTS) return { ok: false, reason: "limit", team: true } as const;
          await tx.exec("INSERT INTO team_projects (team_id, id, name, data, version, created_at, updated_at, deleted_at, created_by, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)", [teamId, id, payload.name, text, now, now, userId, userId]);
          return { ok: true, version: 1, updatedAt: now, teamId } as const;
        }
        if ((await liveCount(tx, { table: "projects", keyCol: "user_id", keyVal: userId })) >= MAX_PROJECTS) return { ok: false, reason: "limit", team: false } as const;
        await tx.exec("INSERT INTO projects (user_id, id, name, data, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 1, ?, ?, NULL)", [userId, id, payload.name, text, now, now]);
        return { ok: true, version: 1, updatedAt: now, teamId: null } as const;
      }
      const { where, row } = found;
      if (row.version !== baseVersion) return { ok: false, reason: "conflict", current: toStored(row) } as const;
      // A deleted project is brought back by a device that has seen it was deleted and keeps its own copy.
      if (row.deleted_at !== null && (await liveCount(tx, where)) >= (where.table === "projects" ? MAX_PROJECTS : MAX_TEAM_PROJECTS)) return { ok: false, reason: "limit", team: where.table === "team_projects" } as const;
      if (where.table === "projects") {
        await tx.exec("UPDATE projects SET name = ?, data = ?, version = version + 1, updated_at = ?, deleted_at = NULL WHERE user_id = ? AND id = ?", [payload.name, text, now, userId, id]);
      } else {
        await tx.exec("UPDATE team_projects SET name = ?, data = ?, version = version + 1, updated_at = ?, updated_by = ?, deleted_at = NULL WHERE team_id = ? AND id = ?", [payload.name, text, now, userId, where.keyVal, id]);
      }
      return { ok: true, version: row.version + 1, updatedAt: now, teamId: where.table === "team_projects" ? where.keyVal : null } as const;
    }));
  } catch (err) {
    // Two devices creating the same project at once: the other got there first.
    if (!isDuplicate(err)) throw err;
    const current = await getProject(db, userId, id);
    if (!current) throw err;
    return { ok: false, reason: "conflict", current };
  }
}

export type RemoveResult = { ok: true } | { ok: false; reason: "conflict"; current: StoredProject } | { ok: false; reason: "forbidden" };

// Deletes a project, if the device had its latest version. Deleting what is gone already is fine. A team's design system
// is deleted for everyone, which only an owner of the team may do.
export async function removeProject(db: Db, userId: string, id: string, baseVersion: number, now = Date.now()): Promise<RemoveResult> {
  return withRetry(() => db.tx(async (tx) => {
    const found = await locate(tx, userId, id, true);
    if (!found || found.row.deleted_at !== null) return { ok: true } as const;
    if (found.where.table === "team_projects" && found.role !== "owner") return { ok: false, reason: "forbidden" } as const;
    if (found.row.version !== baseVersion) return { ok: false, reason: "conflict", current: toStored(found.row) } as const;
    const { where } = found;
    // The content goes at once; the row stays for a while so other devices learn that it was deleted.
    if (where.table === "projects") {
      await tx.exec("UPDATE projects SET name = '', data = '', version = version + 1, updated_at = ?, deleted_at = ? WHERE user_id = ? AND id = ?", [now, now, userId, id]);
    } else {
      await tx.exec("UPDATE team_projects SET name = '', data = '', version = version + 1, updated_at = ?, updated_by = ?, deleted_at = ? WHERE team_id = ? AND id = ?", [now, userId, now, where.keyVal, id]);
    }
    await tx.exec(`DELETE FROM ${where.table} WHERE ${where.keyCol} = ? AND deleted_at IS NOT NULL AND deleted_at < ?`, [where.keyVal, now - TOMBSTONE_DAYS * 86_400_000]);
    return { ok: true } as const;
  }));
}

export type MoveResult =
  | { ok: true; version: number; teamId: string | null }
  | { ok: false; reason: "not-found" | "forbidden" | "limit" | "exists" };

// Moves a design system between a person's own and a team's (to a team the person is in; out of a team only by an owner,
// to the person's own). It is one change: the project appears in its new place and a deleted marker is left in the old,
// so every device learns that it moved rather than that it was lost.
export async function moveProject(db: Db, userId: string, id: string, to: { teamId: string | null }, now = Date.now()): Promise<MoveResult> {
  return withRetry(() => db.tx(async (tx) => {
    const found = await locate(tx, userId, id, true);
    if (!found || found.row.deleted_at !== null) return { ok: false, reason: "not-found" } as const;
    const from = found.where;
    const toTeam = to.teamId;
    if (from.table === "projects" && !toTeam) return { ok: false, reason: "exists" } as const;
    if (from.table === "team_projects" && toTeam === from.keyVal) return { ok: false, reason: "exists" } as const;
    // Out of a team: owners only.
    if (from.table === "team_projects" && found.role !== "owner") return { ok: false, reason: "forbidden" } as const;
    if (toTeam) {
      const member = await tx.query("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?", [toTeam, userId]);
      if (member.length === 0) return { ok: false, reason: "forbidden" } as const;
      if ((await liveCount(tx, { table: "team_projects", keyCol: "team_id", keyVal: toTeam })) >= MAX_TEAM_PROJECTS) return { ok: false, reason: "limit" } as const;
      // A deleted marker for this id in the team is replaced; a live project with it is not.
      const taken = await tx.exec(
        `INSERT INTO team_projects (team_id, id, name, data, version, created_at, updated_at, deleted_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (team_id, id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, version = team_projects.version + 1, updated_at = EXCLUDED.updated_at, deleted_at = NULL, updated_by = EXCLUDED.updated_by
         WHERE team_projects.deleted_at IS NOT NULL`,
        [toTeam, id, found.row.name, found.row.data, found.row.version + 1, now, now, userId, userId]);
      if (taken.affectedRows === 0) return { ok: false, reason: "exists" } as const;
    } else {
      if ((await liveCount(tx, { table: "projects", keyCol: "user_id", keyVal: userId })) >= MAX_PROJECTS) return { ok: false, reason: "limit" } as const;
      const taken = await tx.exec(
        `INSERT INTO projects (user_id, id, name, data, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (user_id, id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, version = projects.version + 1, updated_at = EXCLUDED.updated_at, deleted_at = NULL
         WHERE projects.deleted_at IS NOT NULL`,
        [userId, id, found.row.name, found.row.data, found.row.version + 1, now, now]);
      if (taken.affectedRows === 0) return { ok: false, reason: "exists" } as const;
    }
    if (from.table === "projects") {
      await tx.exec("UPDATE projects SET name = '', data = '', version = version + 1, updated_at = ?, deleted_at = ? WHERE user_id = ? AND id = ?", [now, now, userId, id]);
    } else {
      await tx.exec("UPDATE team_projects SET name = '', data = '', version = version + 1, updated_at = ?, updated_by = ?, deleted_at = ? WHERE team_id = ? AND id = ?", [now, userId, now, from.keyVal, id]);
    }
    const [{ version }] = await tx.query<{ version: number }>(
      toTeam ? "SELECT version FROM team_projects WHERE team_id = ? AND id = ?" : "SELECT version FROM projects WHERE user_id = ? AND id = ?", [toTeam ?? userId, id]);
    return { ok: true, version, teamId: toTeam } as const;
  }));
}
