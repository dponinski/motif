import { nanoid } from "nanoid";
import { isAllowed, normalizeEmail } from "./allowlist";
import type { Db } from "./db";
import { hashToken, newToken, type User } from "./store";

// Teams: groups of people who share design systems. Every function takes the database it works on, as in store.ts.
//
// A person belongs to a team as an owner (who invites, removes, renames and deletes) or a member (who edits what the team
// shares, and can leave). An invitation is to an email address; it is taken up by someone who has signed in with that
// address, from the link in the mail or from their dashboard.

export type Role = "owner" | "member";

export const INVITE_DAYS = 14;
export const MAX_MEMBERS = 50;
export const MAX_TEAMS_OWNED = 10;
const DAY = 86_400_000;

export interface Member { userId: string; name: string | null; email: string; avatar: string | null; role: Role }
export interface InviteView { id: string; email: string; invitedBy: string | null; createdAt: number; expiresAt: number }
export interface TeamView { id: string; name: string; role: Role; members: Member[]; invites: InviteView[] }
export interface InviteForMe { id: string; teamId: string; teamName: string; invitedBy: string | null; expiresAt: number }

const cleanName = (name: unknown): string | null => {
  if (typeof name !== "string") return null;
  const n = name.trim().replace(/\s+/g, " ");
  return n.length >= 1 && n.length <= 80 ? n : null;
};
export { cleanName as teamName };

// ── Who may enter ─────────────────────────────────────────────────────────────

// Whether an address belongs to someone in a team or has an invitation waiting: the people a team brings in even though
// they aren't on the server's list.
export async function teamAccess(db: Db, email: string | null | undefined, now = Date.now()): Promise<boolean> {
  const e = normalizeEmail(email);
  if (!e) return false;
  const rows = await db.query(
    `SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id WHERE u.email = ?
     UNION ALL SELECT 1 FROM team_invites WHERE email = ? AND expires_at > ? LIMIT 1`,
    [e, e, now]
  );
  return rows.length > 0;
}

// Whether someone may sign in and use their account: the server's list, or a team.
export async function mayEnter(db: Db, email: string | null | undefined, allowed: string[], now = Date.now()): Promise<boolean> {
  return isAllowed(email, allowed) || (await teamAccess(db, email, now));
}

// The first of a person's verified addresses that lets them in.
export async function enterEmail(db: Db, emails: { email: string; verified: boolean }[], allowed: string[], now = Date.now()): Promise<string | null> {
  for (const { email, verified } of emails) {
    const e = normalizeEmail(email);
    if (verified && e && (await mayEnter(db, e, allowed, now))) return e;
  }
  return null;
}

// ── Teams and their members ───────────────────────────────────────────────────

export async function roleIn(db: Db, teamId: string, userId: string): Promise<Role | null> {
  const rows = await db.query<{ role: Role }>("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, userId]);
  return rows[0]?.role ?? null;
}

export type CreateTeamResult = { ok: true; id: string } | { ok: false; reason: "name" | "limit" };

export async function createTeam(db: Db, userId: string, name: unknown, now = Date.now()): Promise<CreateTeamResult> {
  const n = cleanName(name);
  if (!n) return { ok: false, reason: "name" };
  return db.tx(async (tx) => {
    const [{ c }] = await tx.query<{ c: number }>("SELECT COUNT(*) AS c FROM team_members WHERE user_id = ? AND role = 'owner'", [userId]);
    if (Number(c) >= MAX_TEAMS_OWNED) return { ok: false, reason: "limit" } as const;
    const id = nanoid(16);
    await tx.exec("INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)", [id, n, userId, now]);
    await tx.exec("INSERT INTO team_members (team_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", [id, userId, now]);
    return { ok: true, id } as const;
  });
}

// The teams a person is in, with their members; owners also see who has been invited and hasn't joined.
export async function listTeams(db: Db, userId: string, now = Date.now()): Promise<TeamView[]> {
  const mine = await db.query<{ id: string; name: string; role: Role }>(
    "SELECT t.id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.created_at, t.id", [userId]);
  if (mine.length === 0) return [];
  const ids = mine.map((t) => t.id);
  const marks = ids.map(() => "?").join(",");
  const members = await db.query<{ team_id: string; user_id: string; name: string | null; email: string; avatar_url: string | null; role: Role }>(
    `SELECT m.team_id, m.user_id, u.name, u.email, u.avatar_url, m.role FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id IN (${marks}) ORDER BY m.added_at, m.user_id`, ids);
  const ownedIds = mine.filter((t) => t.role === "owner").map((t) => t.id);
  const invites = ownedIds.length
    ? await db.query<{ id: string; team_id: string; email: string; created_at: number; expires_at: number; inviter: string | null }>(
      `SELECT i.id, i.team_id, i.email, i.created_at, i.expires_at, u.name AS inviter FROM team_invites i LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.team_id IN (${ownedIds.map(() => "?").join(",")}) AND i.expires_at > ? ORDER BY i.created_at`, [...ownedIds, now])
    : [];
  return mine.map((t) => ({
    id: t.id, name: t.name, role: t.role,
    members: members.filter((m) => m.team_id === t.id).map((m) => ({ userId: m.user_id, name: m.name, email: m.email, avatar: m.avatar_url, role: m.role })),
    invites: invites.filter((i) => i.team_id === t.id).map((i) => ({ id: i.id, email: i.email, invitedBy: i.inviter, createdAt: Number(i.created_at), expiresAt: Number(i.expires_at) })),
  }));
}

export type TeamResult = { ok: true } | { ok: false; reason: "forbidden" | "not-found" | "name" | "has-projects" | "last-owner" | "limit" | "wrong-email" | "expired" | "exists" };

async function ownerOf(db: Db, teamId: string, userId: string): Promise<"owner" | "member" | null> {
  return roleIn(db, teamId, userId);
}

export async function renameTeam(db: Db, teamId: string, userId: string, name: unknown): Promise<TeamResult> {
  const n = cleanName(name);
  if (!n) return { ok: false, reason: "name" };
  const role = await ownerOf(db, teamId, userId);
  if (!role) return { ok: false, reason: "not-found" };
  if (role !== "owner") return { ok: false, reason: "forbidden" };
  await db.exec("UPDATE teams SET name = ? WHERE id = ?", [n, teamId]);
  return { ok: true };
}

// A team goes only when it has no design systems left, so deleting it can't be how a project is lost.
export async function deleteTeam(db: Db, teamId: string, userId: string): Promise<TeamResult> {
  return db.tx(async (tx) => {
    const role = await ownerOf(tx, teamId, userId);
    if (!role) return { ok: false, reason: "not-found" } as const;
    if (role !== "owner") return { ok: false, reason: "forbidden" } as const;
    const [{ c }] = await tx.query<{ c: number }>("SELECT COUNT(*) AS c FROM team_projects WHERE team_id = ? AND deleted_at IS NULL", [teamId]);
    if (Number(c) > 0) return { ok: false, reason: "has-projects" } as const;
    await tx.exec("DELETE FROM teams WHERE id = ?", [teamId]);
    return { ok: true } as const;
  });
}

// Changes someone's role, or removes them (a person removing themselves is leaving). Owners do it to others; there is
// always an owner left.
export async function setRole(db: Db, teamId: string, actorId: string, targetId: string, role: Role | "remove"): Promise<TeamResult> {
  return db.tx(async (tx) => {
    // The team row is held so that two owners leaving at once can't both succeed.
    const team = await tx.query("SELECT id FROM teams WHERE id = ? FOR UPDATE", [teamId]);
    if (team.length === 0) return { ok: false, reason: "not-found" } as const;
    const actor = await roleIn(tx, teamId, actorId);
    const target = await roleIn(tx, teamId, targetId);
    if (!actor || !target) return { ok: false, reason: "not-found" } as const;
    const leaving = role === "remove" && actorId === targetId;
    if (!leaving && actor !== "owner") return { ok: false, reason: "forbidden" } as const;
    if (target === "owner" && (role === "remove" || role === "member")) {
      const [{ c }] = await tx.query<{ c: number }>("SELECT COUNT(*) AS c FROM team_members WHERE team_id = ? AND role = 'owner'", [teamId]);
      if (Number(c) <= 1) return { ok: false, reason: "last-owner" } as const;
    }
    if (role === "remove") await tx.exec("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, targetId]);
    else await tx.exec("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?", [role, teamId, targetId]);
    return { ok: true } as const;
  });
}

// ── Invitations ───────────────────────────────────────────────────────────────

export type InviteResult = { ok: true; id: string; token: string; email: string } | { ok: false; reason: "forbidden" | "not-found" | "email" | "limit" | "member" };

// Invites an address. Inviting it again replaces the earlier invitation (a new link, a new fortnight).
export async function createInvite(db: Db, teamId: string, actorId: string, emailInput: unknown, now = Date.now()): Promise<InviteResult> {
  const email = normalizeEmail(emailInput);
  if (!email) return { ok: false, reason: "email" };
  return db.tx(async (tx) => {
    await tx.query("SELECT id FROM teams WHERE id = ? FOR UPDATE", [teamId]);
    const role = await roleIn(tx, teamId, actorId);
    if (!role) return { ok: false, reason: "not-found" } as const;
    if (role !== "owner") return { ok: false, reason: "forbidden" } as const;
    const already = await tx.query("SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.email = ?", [teamId, email]);
    if (already.length > 0) return { ok: false, reason: "member" } as const;
    await tx.exec("DELETE FROM team_invites WHERE team_id = ? AND email = ?", [teamId, email]);
    const [{ c }] = await tx.query<{ c: number }>(
      "SELECT (SELECT COUNT(*) FROM team_members WHERE team_id = ?) + (SELECT COUNT(*) FROM team_invites WHERE team_id = ? AND expires_at > ?) AS c", [teamId, teamId, now]);
    if (Number(c) >= MAX_MEMBERS) return { ok: false, reason: "limit" } as const;
    const id = nanoid(16);
    const token = newToken();
    await tx.exec("INSERT INTO team_invites (id, team_id, email, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, teamId, email, hashToken(token), actorId, now, now + INVITE_DAYS * DAY]);
    return { ok: true, id, token, email } as const;
  });
}

export async function revokeInvite(db: Db, teamId: string, actorId: string, inviteId: string): Promise<TeamResult> {
  const role = await roleIn(db, teamId, actorId);
  if (!role) return { ok: false, reason: "not-found" };
  if (role !== "owner") return { ok: false, reason: "forbidden" };
  await db.exec("DELETE FROM team_invites WHERE id = ? AND team_id = ?", [inviteId, teamId]);
  return { ok: true };
}

// Invitations waiting for the address a person has signed in with.
export async function invitesFor(db: Db, email: string, now = Date.now()): Promise<InviteForMe[]> {
  const rows = await db.query<{ id: string; team_id: string; team_name: string; inviter: string | null; expires_at: number }>(
    `SELECT i.id, i.team_id, t.name AS team_name, u.name AS inviter, i.expires_at FROM team_invites i JOIN teams t ON t.id = i.team_id LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.email = ? AND i.expires_at > ? ORDER BY i.created_at`, [normalizeEmail(email) ?? "", now]);
  return rows.map((r) => ({ id: r.id, teamId: r.team_id, teamName: r.team_name, invitedBy: r.inviter, expiresAt: Number(r.expires_at) }));
}

export type AcceptResult = { ok: true; teamId: string; teamName: string } | { ok: false; reason: "not-found" | "expired" | "wrong-email" | "limit" };

async function take(db: Db, where: string, param: string, user: Pick<User, "id" | "email">, now: number): Promise<AcceptResult> {
  return db.tx(async (tx) => {
    const rows = await tx.query<{ id: string; team_id: string; email: string; expires_at: number; name: string }>(
      `SELECT i.id, i.team_id, i.email, i.expires_at, t.name FROM team_invites i JOIN teams t ON t.id = i.team_id WHERE ${where} FOR UPDATE OF i`, [param]);
    const invite = rows[0];
    if (!invite) return { ok: false, reason: "not-found" } as const;
    // The invitation is to an address, and is taken up by someone who has signed in with it.
    if (invite.email !== normalizeEmail(user.email)) return { ok: false, reason: "wrong-email" } as const;
    if (Number(invite.expires_at) <= now) return { ok: false, reason: "expired" } as const;
    const [{ c }] = await tx.query<{ c: number }>("SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?", [invite.team_id]);
    const already = (await roleIn(tx, invite.team_id, user.id)) !== null;
    if (!already && Number(c) >= MAX_MEMBERS) return { ok: false, reason: "limit" } as const;
    await tx.exec("DELETE FROM team_invites WHERE id = ?", [invite.id]);
    if (!already) await tx.exec("INSERT INTO team_members (team_id, user_id, role, added_at) VALUES (?, ?, 'member', ?)", [invite.team_id, user.id, now]);
    return { ok: true, teamId: invite.team_id, teamName: invite.name } as const;
  });
}

export const acceptInviteByToken = (db: Db, user: Pick<User, "id" | "email">, token: string, now = Date.now()) =>
  take(db, "i.token_hash = ?", hashToken(token), user, now);
export const acceptInviteById = (db: Db, user: Pick<User, "id" | "email">, inviteId: string, now = Date.now()) =>
  take(db, "i.id = ?", inviteId, user, now);

