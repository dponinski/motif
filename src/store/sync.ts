import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeStorage } from "../lib/safe-storage";
import { applyTake, decide, metaOf, resolveClash, type Meta } from "../lib/sync/engine";
import type { ItemConflict } from "../lib/sync/items";
import { hashSections, sameHashes, toPayload, type Hashes, type ProjectPayload, type Section } from "../lib/sync/payload";
import { api, SignedOut, Unreachable } from "../lib/sync/api";
import { applyPayload, projectFromPayload, type ServerInfo } from "../lib/sync/project";
import { useProjectsStore, type Project } from "./projects";
import { useTeams } from "./teams";

// Keeping a signed-in person's projects the same on every device they use. The browser keeps working on its own
// copy; this sends what changed to the server, takes in what changed elsewhere, and stops to ask only when the same
// part of a project was changed differently in two places (lib/sync/engine.ts).
//
// Nothing here is sent that isn't in lib/sync/payload.ts: not the access tokens, not the scan, not the library.

export type SyncStatus = "off" | "idle" | "syncing" | "offline" | "error";

// A project that was changed here and somewhere else, differently. What the server has is held until a person picks.
export interface Conflict {
  deleted: boolean;
  version: number;
  data: ProjectPayload | null;
  // Whole parts changed differently, and the items (of the tokens and the documentation) that both sides changed.
  sections: Section[];
  items?: ItemConflict[];
  // The project with everything that doesn't clash merged, and the clashes taken from this device, or from the server.
  withLocal?: ProjectPayload;
  withServer?: ProjectPayload;
  // Who made the version the server has, when it is a teammate.
  updatedBy?: string | null;
}

// The editor open on a project registers itself, so a change that arrives for it can be put into the editor, and
// what has been typed into it is in the project before it is sent.
export interface OpenProject {
  id: string;
  flush: () => void;
  reload: (project: Project) => void;
}

interface SyncState {
  // Whose projects the metadata is about.
  userId: string | null;
  // What the server had, and the project was, when they last agreed.
  meta: Record<string, Meta>;
  status: SyncStatus;
  lastSyncedAt: number | null;
  conflicts: Record<string, Conflict>;
  // Something worth telling the person once.
  notice: string | null;
  // Projects the server refused, by id, and the content it refused (so it isn't sent again until it changes).
  refused: Record<string, { hash: string; reason: string }>;
  start: (userId: string) => void;
  stop: (options?: { clear?: boolean }) => Promise<void>;
  sync: () => Promise<void>;
  resolve: (id: string, take: "server" | "local") => Promise<void>;
  setOpen: (open: OpenProject | null) => void;
  dismissNotice: () => void;
  // Moves a design system into a team (or, for a team's owner, out of it to their own). Says what went wrong, or null.
  move: (id: string, teamId: string | null) => Promise<string | null>;
}

interface ServerProject { id: string; version: number; updatedAt: number; deleted: boolean; data: ProjectPayload | null; teamId?: string | null; updatedBy?: string | null }
type ProjectSummary = Omit<ServerProject, "data">;

const infoOf = (server: { updatedAt: number; teamId?: string | null; updatedBy?: string | null }): ServerInfo => ({ updatedAt: server.updatedAt, teamId: server.teamId ?? null, updatedBy: server.updatedBy ?? null });

let open: OpenProject | null = null;
let running: Promise<void> | null = null;
let again = false;
let applying = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let teardown: (() => void) | null = null;
// The warning about a full account is shown once, not at every sync.
let limitShown = false;

const PUSH_DELAY = 1500;
const POLL_MS = 45_000;

const localProject = (id: string) => useProjectsStore.getState().projects.find((p) => p.id === id);

export const useSync = create<SyncState>()(
  persist(
    (set, get) => {
      const setMeta = (id: string, meta: Meta | null) =>
        set((s) => {
          const next = { ...s.meta };
          if (meta) next[id] = meta;
          else delete next[id];
          return { meta: next };
        });

      // Puts a project into the browser (as a change that came from the server, not one made here).
      const adopt = (project: Project) => {
        applying = true;
        try {
          useProjectsStore.getState().put(project);
          if (open?.id === project.id) open.reload(project);
        } finally {
          applying = false;
        }
      };
      const dropLocal = (id: string) => {
        applying = true;
        try { useProjectsStore.getState().remove(id); } finally { applying = false; }
      };

      const setConflict = (id: string, conflict: Conflict) => set((s) => ({ conflicts: { ...s.conflicts, [id]: conflict } }));

      // What a team project's local copy says about where it lives, brought in line with the server.
      const setTeam = (id: string, teamId: string | null, updatedBy: string | null) => {
        const p = localProject(id);
        if (!p || ((p.teamId ?? null) === teamId && (p.updatedBy ?? null) === updatedBy)) return;
        applying = true;
        try { useProjectsStore.getState().put({ ...p, teamId, updatedBy }); } finally { applying = false; }
      };

      const fetchOne = async (id: string): Promise<ServerProject | null> => {
        const r = await api<ServerProject>("GET", `/api/projects/${encodeURIComponent(id)}`);
        return r.status === 200 ? r.body : null;
      };

      // Sends a project, knowing which version of it the server last had. A refusal because the server has moved on
      // goes through the same decision again with what the server has.
      const push = async (id: string, payload: ProjectPayload, base: number, depth = 0): Promise<void> => {
        const hashes = hashSections(payload);
        const refused = get().refused[id];
        if (refused && refused.hash === JSON.stringify(hashes)) return;
        // A project that is new to the server goes where it was made: into its team, if it has one.
        const teamId = base === 0 ? localProject(id)?.teamId ?? undefined : undefined;
        const r = await api<{ version: number }>("PUT", `/api/projects/${encodeURIComponent(id)}`, { baseVersion: base, data: payload, ...(teamId ? { teamId } : {}) });
        if (r.status === 200) {
          const saved = r.body as { version: number; teamId?: string | null; updatedBy?: string | null };
          setMeta(id, metaOf(saved.version, payload));
          // Who last changed a team's design system is whoever just did.
          if (saved.teamId) setTeam(id, saved.teamId, saved.updatedBy ?? null);
          if (get().refused[id]) set((s) => { const next = { ...s.refused }; delete next[id]; return { refused: next }; });
          return;
        }
        // Not in that team (any more): it is the person's own, and goes to their account.
        if (r.status === 403 && r.body.forbidden && teamId && depth < 3) {
          setTeam(id, null, null);
          return push(id, payload, 0, depth + 1);
        }
        if (r.status === 409 && r.body.limit) {
          if (!limitShown) set({ notice: teamId ? (r.body.error ?? "This team has reached its limit of design systems.") : "Your account has reached its limit of saved projects, so some projects stay only on this device. Delete projects you don't need." });
          limitShown = true;
          return;
        }
        if (r.status === 409 && r.body.current && depth < 3) {
          await reconcileWith(id, r.body.current as ServerProject, depth + 1);
          return;
        }
        // Several people saving at once can lose a few races in a row; that is not the server refusing the project.
        if (r.status === 409 && r.body.current) { schedule(3000); return; }
        if (r.status === 409 || r.status === 422 || r.status === 413) {
          set((s) => ({ refused: { ...s.refused, [id]: { hash: JSON.stringify(hashes), reason: r.body.error ?? "The server refused this project" } }, status: "error" }));
        }
      };

      // A project the server has, in whatever state, against the one here.
      const reconcileWith = async (id: string, server: ServerProject, depth = 0): Promise<void> => {
        // What has been typed into the open editor is in the project before it is compared with the server's.
        if (open?.id === id) open.flush();
        const p = localProject(id);
        const m = get().meta[id];
        if (server.deleted) {
          if (!p) { setMeta(id, null); return; }
          if (m && sameHashes(hashSections(toPayload(p)), m.hashes)) { dropLocal(id); setMeta(id, null); return; }
          setConflict(id, { deleted: true, version: server.version, data: null, sections: [] });
          return;
        }
        if (!server.data) return;
        const serverHashes = hashSections(server.data);
        if (!p) {
          adopt(projectFromPayload(id, server.data, infoOf(server)));
          setMeta(id, metaOf(server.version, server.data));
          return;
        }
        // Where it lives and who last changed it are the server's to say.
        setTeam(id, server.teamId ?? null, server.updatedBy ?? null);
        const local = toPayload(localProject(id) ?? p);
        const localHashes = hashSections(local);
        const d = decide(m ?? null, localHashes, serverHashes);
        switch (d.kind) {
          case "idle":
            setMeta(id, metaOf(server.version, local));
            return;
          case "pull":
            adopt(applyPayload(localProject(id) ?? p, server.data, infoOf(server)));
            setMeta(id, metaOf(server.version, server.data));
            return;
          case "push":
            await push(id, local, server.version, depth);
            return;
          case "merge": {
            const merged = applyTake(local, server.data, d.take);
            adopt(applyPayload(localProject(id) ?? p, merged, { updatedBy: server.updatedBy ?? null }));
            // The server's version is the one the merged project is based on.
            setMeta(id, metaOf(server.version, server.data));
            await push(id, merged, server.version, depth);
            return;
          }
          case "conflict": {
            // A part changed on both sides is narrowed to the items that both changed, where there is a record of them.
            const clash = resolveClash(m ?? null, local, server.data, d.sections);
            if (clash.kind === "merge") {
              adopt(applyPayload(localProject(id) ?? p, clash.payload, { updatedBy: server.updatedBy ?? null }));
              setMeta(id, metaOf(server.version, server.data));
              await push(id, clash.payload, server.version, depth);
              return;
            }
            setConflict(id, { deleted: false, version: server.version, data: server.data, sections: clash.sections, items: clash.items, withLocal: clash.withLocal, withServer: clash.withServer, updatedBy: server.updatedBy ?? null });
            return;
          }
        }
      };

      const reconcile = async (summary: ProjectSummary): Promise<void> => {
        const id = summary.id;
        if (get().conflicts[id]) return;
        const p = localProject(id);
        const m = get().meta[id];
        if (summary.deleted) return reconcileWith(id, { ...summary, data: null });
        if (p && m && m.version === summary.version) {
          setTeam(id, summary.teamId ?? null, summary.updatedBy ?? null);
          const local = toPayload(p);
          if (sameHashes(hashSections(local), m.hashes)) return;
          return push(id, local, m.version);
        }
        const server = await fetchOne(id);
        if (server) await reconcileWith(id, server);
      };

      const run = async (): Promise<void> => {
        const { userId } = get();
        if (!userId) return;
        open?.flush();
        set({ status: "syncing" });
        try {
          // Projects deleted here.
          const projects = useProjectsStore.getState().projects;
          for (const id of Object.keys(get().meta)) {
            if (projects.some((p) => p.id === id) || get().conflicts[id]) continue;
            const r = await api("DELETE", `/api/projects/${encodeURIComponent(id)}?baseVersion=${get().meta[id].version}`);
            // Changed elsewhere since: that wins over the deletion, and it comes back below.
            if (r.status === 200 || r.status === 409) setMeta(id, null);
            // A team's design system is deleted for everyone, which only an owner of the team may do: it stays, and comes back.
            if (r.status === 403) set({ notice: "Only an owner of the team can delete its design systems." });
          }

          const list = await api<{ projects: ProjectSummary[] }>("GET", "/api/projects");
          // A design system that moved between a person's own and a team's is listed twice: as deleted where it was and as
          // alive where it is now. The live one is the project.
          const byId = new Map<string, ProjectSummary>();
          for (const s of list.body.projects ?? []) {
            const have = byId.get(s.id);
            if (!have || (have.deleted && !s.deleted)) byId.set(s.id, s);
          }
          const known = new Set<string>();
          for (const s of byId.values()) {
            known.add(s.id);
            await reconcile(s);
          }
          // The teams change with the people in them, so they are asked about each time.
          await useTeams.getState().refresh();

          // Projects the server has never seen, or has forgotten.
          const migrated: string[] = [];
          const notices: string[] = [];
          for (const p of useProjectsStore.getState().projects) {
            if (known.has(p.id) || get().conflicts[p.id]) continue;
            if (get().meta[p.id]) {
              const local = toPayload(p);
              const unchanged = sameHashes(hashSections(local), get().meta[p.id].hashes);
              if (p.teamId) {
                // A team's design system that isn't listed any more: this person is out of the team. With nothing of their own in
                // it, it goes; with changes they made, those are theirs and are kept as their own project.
                setMeta(p.id, null);
                if (unchanged) { dropLocal(p.id); notices.push(`You are no longer in the team that shared “${p.name}”, so it was taken off this browser.`); continue; }
                setTeam(p.id, null, null);
                notices.push(`You are no longer in the team that shared “${p.name}”. Your changes are kept as your own project.`);
                await push(p.id, local, 0);
                continue;
              }
              // It was ours and is gone from the server: deleted elsewhere long ago.
              if (unchanged) { dropLocal(p.id); setMeta(p.id, null); }
              else { setMeta(p.id, null); setConflict(p.id, { deleted: true, version: 0, data: null, sections: [] }); }
              continue;
            }
            await push(p.id, toPayload(p), 0);
            if (get().meta[p.id]) migrated.push(p.name);
          }
          if (notices.length) set({ notice: notices.join(" ") });
          if (migrated.length && !get().notice) set({ notice: migrated.length === 1 ? `“${migrated[0]}” is now saved to your account.` : `${migrated.length} projects from this browser are now saved to your account.` });

          set((s) => ({ status: Object.keys(s.refused).length ? "error" : "idle", lastSyncedAt: Date.now() }));
        } catch (err) {
          if (err instanceof SignedOut) {
            set({ status: "off" });
            // The session ended: find out, which also lets the person sign in again.
            void import("./auth").then((m) => m.useAuth.getState().load());
          } else if (err instanceof Unreachable) {
            set({ status: "offline" });
          } else {
            console.error("Syncing projects failed:", err instanceof Error ? err.message : err);
            set({ status: "error" });
          }
        }
      };

      const sync = (): Promise<void> => {
        if (!get().userId) return Promise.resolve();
        if (running) { again = true; return running; }
        running = (async () => {
          do {
            again = false;
            await run();
          } while (again && get().userId);
        })().finally(() => { running = null; });
        return running;
      };

      const schedule = (delay = PUSH_DELAY) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; void sync(); }, delay);
      };

      return {
        userId: null,
        meta: {},
        status: "off",
        lastSyncedAt: null,
        conflicts: {},
        notice: null,
        refused: {},

        start: (userId) => {
          const was = get().userId;
          if (was && was !== userId) {
            // Projects on this browser that belong to someone else's account are theirs, not this person's.
            for (const id of Object.keys(get().meta)) dropLocal(id);
            set({ meta: {}, conflicts: {}, refused: {} });
            useTeams.getState().clear();
          }
          set({ userId, status: "idle" });
          limitShown = false;
          teardown?.();
          const unsubscribe = useProjectsStore.subscribe((s, prev) => {
            if (!applying && s.projects !== prev.projects) schedule();
          });
          const poll = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") void sync(); }, POLL_MS);
          const wake = () => { if (document.visibilityState === "visible") void sync(); };
          window.addEventListener("online", wake);
          window.addEventListener("focus", wake);
          document.addEventListener("visibilitychange", wake);
          teardown = () => {
            unsubscribe();
            clearInterval(poll);
            window.removeEventListener("online", wake);
            window.removeEventListener("focus", wake);
            document.removeEventListener("visibilitychange", wake);
            if (timer) { clearTimeout(timer); timer = null; }
            teardown = null;
          };
          void sync();
        },

        // Syncing ends here. With `clear` (signing out) what is saved to the account is taken off this browser, so the
        // next person to use it doesn't see it; a project with changes that couldn't be sent stays, and is
        // sent when its owner signs in again.
        stop: async ({ clear = false } = {}) => {
          if (clear && get().userId) {
            try { await Promise.race([sync(), new Promise((r) => setTimeout(r, 8000))]); } catch { /* the rest is kept below */ }
          }
          teardown?.();
          if (clear) {
            const keep: Record<string, Meta> = {};
            for (const [id, m] of Object.entries(get().meta)) {
              const p = localProject(id);
              if (p && !sameHashes(hashSections(toPayload(p)), m.hashes)) keep[id] = m;
              else if (p) dropLocal(id);
            }
            set({ meta: keep, conflicts: {}, refused: {}, notice: null, status: "off", lastSyncedAt: null, userId: Object.keys(keep).length ? get().userId : null });
            useTeams.getState().clear();
          } else {
            set({ status: "off" });
          }
        },

        sync,

        resolve: async (id, take) => {
          const c = get().conflicts[id];
          if (!c) return;
          const p = localProject(id);
          set((s) => { const next = { ...s.conflicts }; delete next[id]; return { conflicts: next }; });
          try {
            if (take === "server") {
              if (c.deleted) { if (p) dropLocal(id); setMeta(id, null); }
              else if (p && c.data) { adopt(applyPayload(p, c.withServer ?? c.data, { updatedBy: c.updatedBy ?? null })); setMeta(id, metaOf(c.version, c.data)); }
            } else if (p) {
              // Keep this device's version: send it over the server's, based on the version the server has now.
              // With the other side's changes to everything that didn't clash merged in, which this device has to hold too.
              if (c.withLocal) { adopt(applyPayload(p, c.withLocal, { updatedBy: c.updatedBy ?? null })); setMeta(id, metaOf(c.version, c.data ?? c.withLocal)); }
              await push(id, c.withLocal ?? toPayload(p), c.version);
            }
          } catch (err) {
            if (!(err instanceof SignedOut) && !(err instanceof Unreachable)) throw err;
            // Nothing was lost; the question comes back with the next sync.
          }
          void sync();
        },

        move: async (id, teamId) => {
          const p = localProject(id);
          if (!p || !get().userId) return "Sign in to move it.";
          // It has to be on the server before it can be moved there.
          await sync();
          const m = get().meta[id];
          if (!m) return "It isn't saved to your account yet. Try again in a moment.";
          try {
            const r = await api<{ version: number; teamId: string | null }>("POST", `/api/projects/${encodeURIComponent(id)}/move`, { teamId });
            if (r.status !== 200) return r.body.error ?? "That didn't work.";
            // The same content, in its new place: what was changed here since is sent from there.
            applying = true;
            try { useProjectsStore.getState().put({ ...(localProject(id) ?? p), teamId: r.body.teamId ?? null }); } finally { applying = false; }
            setMeta(id, { version: r.body.version, hashes: m.hashes });
            void sync();
            return null;
          } catch (err) {
            if (err instanceof SignedOut) return "Sign in again to move it.";
            if (err instanceof Unreachable) return "The server can't be reached. Try again in a moment.";
            throw err;
          }
        },

        setOpen: (next) => { open = next; },
        dismissNotice: () => set({ notice: null }),
      };
    },
    {
      name: "motif-sync",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ userId: s.userId, meta: s.meta }),
    }
  )
);

export const hashesOf = (project: Project): Hashes => hashSections(toPayload(project));
