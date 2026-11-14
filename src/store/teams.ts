import { create } from "zustand";
import type { InviteForMe, Member, Role, TeamView } from "../lib/auth/teams";
import { SignedOut, Unreachable, api } from "../lib/sync/api";

// The teams the signed-in person is in, and the invitations waiting for them. Held in memory: the server is the source,
// and it is asked again with every sync.

export type { InviteForMe, Member, Role, TeamView };

interface TeamsState {
  teams: TeamView[];
  invites: InviteForMe[];
  loaded: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
  roleIn: (teamId: string | null | undefined) => Role | null;
  nameOf: (teamId: string | null | undefined) => string | null;
  // These say what went wrong, or null when it worked.
  create: (name: string) => Promise<{ id?: string; error?: string }>;
  rename: (teamId: string, name: string) => Promise<string | null>;
  remove: (teamId: string) => Promise<string | null>;
  invite: (teamId: string, email: string) => Promise<{ link?: string; mailed?: boolean; error?: string }>;
  revoke: (teamId: string, inviteId: string) => Promise<string | null>;
  setRole: (teamId: string, userId: string, role: Role) => Promise<string | null>;
  removeMember: (teamId: string, userId: string) => Promise<string | null>;
  accept: (input: { inviteId: string } | { token: string }) => Promise<{ teamName?: string; error?: string }>;
}

const enc = encodeURIComponent;

export const useTeams = create<TeamsState>()((set, get) => {
  // Does something to a team, and shows the result.
  const act = async (method: string, path: string, body?: unknown): Promise<string | null> => {
    try {
      const r = await api(method, path, body);
      await get().refresh();
      return r.status >= 200 && r.status < 300 ? null : (r.body.error ?? "That didn't work");
    } catch (err) {
      if (err instanceof SignedOut) return "Sign in again to do that";
      if (err instanceof Unreachable) return "The server can't be reached. Try again in a moment.";
      throw err;
    }
  };

  return {
    teams: [],
    invites: [],
    loaded: false,

    refresh: async () => {
      try {
        const r = await api<{ teams: TeamView[]; invites: InviteForMe[] }>("GET", "/api/teams");
        if (r.status === 200) set({ teams: r.body.teams ?? [], invites: r.body.invites ?? [], loaded: true });
      } catch (err) {
        if (!(err instanceof SignedOut) && !(err instanceof Unreachable)) throw err;
      }
    },

    clear: () => set({ teams: [], invites: [], loaded: false }),
    roleIn: (teamId) => (teamId ? get().teams.find((t) => t.id === teamId)?.role ?? null : null),
    nameOf: (teamId) => (teamId ? get().teams.find((t) => t.id === teamId)?.name ?? null : null),

    create: async (name) => {
      try {
        const r = await api<{ id: string }>("POST", "/api/teams", { name });
        if (r.status !== 201) return { error: r.body.error ?? "That didn't work" };
        await get().refresh();
        return { id: r.body.id };
      } catch (err) {
        if (err instanceof SignedOut || err instanceof Unreachable) return { error: "The server can't be reached. Try again in a moment." };
        throw err;
      }
    },
    rename: (teamId, name) => act("PATCH", `/api/teams/${enc(teamId)}`, { name }),
    remove: (teamId) => act("DELETE", `/api/teams/${enc(teamId)}`),
    invite: async (teamId, email) => {
      try {
        const r = await api<{ link: string; mailed: boolean }>("POST", `/api/teams/${enc(teamId)}/invites`, { email });
        await get().refresh();
        if (r.status !== 201) return { error: r.body.error ?? "That didn't work" };
        return { link: r.body.link, mailed: r.body.mailed };
      } catch (err) {
        if (err instanceof SignedOut || err instanceof Unreachable) return { error: "The server can't be reached. Try again in a moment." };
        throw err;
      }
    },
    revoke: (teamId, inviteId) => act("DELETE", `/api/teams/${enc(teamId)}/invites/${enc(inviteId)}`),
    setRole: (teamId, userId, role) => act("PATCH", `/api/teams/${enc(teamId)}/members/${enc(userId)}`, { role }),
    removeMember: (teamId, userId) => act("DELETE", `/api/teams/${enc(teamId)}/members/${enc(userId)}`),
    accept: async (input) => {
      try {
        const r = await api<{ teamName: string }>("POST", "/api/teams/invites/accept", input);
        if (r.status !== 200) return { error: r.body.error ?? "That didn't work" };
        await get().refresh();
        return { teamName: r.body.teamName };
      } catch (err) {
        if (err instanceof SignedOut) return { error: "Sign in to take up the invitation" };
        if (err instanceof Unreachable) return { error: "The server can't be reached. Try again in a moment." };
        throw err;
      }
    },
  };
});
