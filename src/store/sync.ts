import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeStorage } from "../lib/safe-storage";
import { applyTake, decide, type Meta } from "../lib/sync/engine";
import { hashSections, sameHashes, toPayload, type Hashes, type ProjectPayload, type Section } from "../lib/sync/payload";
import { applyPayload, projectFromPayload } from "../lib/sync/project";
import { useProjectsStore, type Project } from "./projects";

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
  sections: Section[];
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
}

class SignedOut extends Error {}
class Unreachable extends Error {}

interface ServerProject { id: string; version: number; updatedAt: number; deleted: boolean; data: ProjectPayload | null }
type Reply<T> = { status: number; body: T & { error?: string; conflict?: boolean; limit?: boolean; current?: ServerProject } };

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "x-requested-with": "motif", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(30_000) : undefined,
    });
  } catch {
    throw new Unreachable();
  }
  if (res.status === 401) throw new SignedOut();
  // A server that is down or restarting is "offline" too.
  if (res.status >= 500) throw new Unreachable();
  return { status: res.status, body: ((await res.json().catch(() => ({}))) as Reply<T>["body"]) };
}

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
        const r = await api<{ version: number }>("PUT", `/api/projects/${encodeURIComponent(id)}`, { baseVersion: base, data: payload });
        if (r.status === 200) {
          setMeta(id, { version: (r.body as { version: number }).version, hashes });
          if (get().refused[id]) set((s) => { const next = { ...s.refused }; delete next[id]; return { refused: next }; });
          return;
        }
        if (r.status === 409 && r.body.limit) {
          if (!limitShown) set({ notice: "Your account has reached its limit of saved projects, so some projects stay only on this device. Delete projects you don't need." });
          limitShown = true;
          return;
        }
        if (r.status === 409 && r.body.current && depth < 3) {
          await reconcileWith(id, r.body.current, depth + 1);
          return;
        }
        if (r.status === 409 || r.status === 422 || r.status === 413) {
          set((s) => ({ refused: { ...s.refused, [id]: { hash: JSON.stringify(hashes), reason: r.body.error ?? "The server refused this project" } }, status: "error" }));
        }
      };

      // A project the server has, in whatever state, against the one here.
      const reconcileWith = async (id: string, server: ServerProject, depth = 0): Promise<void> => {
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
          adopt(projectFromPayload(id, server.data));
          setMeta(id, { version: server.version, hashes: serverHashes });
          return;
        }
        const local = toPayload(p);
        const localHashes = hashSections(local);
        const d = decide(m ?? null, localHashes, serverHashes);
        switch (d.kind) {
          case "idle":
            setMeta(id, { version: server.version, hashes: localHashes });
            return;
          case "pull":
            adopt(applyPayload(p, server.data));
            setMeta(id, { version: server.version, hashes: serverHashes });
            return;
          case "push":
            await push(id, local, server.version, depth);
            return;
          case "merge": {
            const merged = applyTake(local, server.data, d.take);
            adopt(applyPayload(p, merged));
            // The server's version is the one the merged project is based on.
            setMeta(id, { version: server.version, hashes: serverHashes });
            await push(id, merged, server.version, depth);
            return;
          }
          case "conflict":
            setConflict(id, { deleted: false, version: server.version, data: server.data, sections: d.sections });
            return;
        }
      };

      const reconcile = async (summary: { id: string; version: number; deleted: boolean }): Promise<void> => {
        const id = summary.id;
        if (get().conflicts[id]) return;
        const p = localProject(id);
        const m = get().meta[id];
        if (summary.deleted) return reconcileWith(id, { ...summary, updatedAt: 0, data: null });
        if (p && m && m.version === summary.version) {
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
          }

          const list = await api<{ projects: { id: string; version: number; updatedAt: number; deleted: boolean }[] }>("GET", "/api/projects");
          const known = new Set<string>();
          for (const s of list.body.projects ?? []) {
            known.add(s.id);
            await reconcile(s);
          }

          // Projects the server has never seen, or has forgotten.
          const migrated: string[] = [];
          for (const p of useProjectsStore.getState().projects) {
            if (known.has(p.id) || get().conflicts[p.id]) continue;
            if (get().meta[p.id]) {
              // It was ours and is gone from the server: deleted elsewhere long ago.
              const local = toPayload(p);
              if (sameHashes(hashSections(local), get().meta[p.id].hashes)) { dropLocal(p.id); setMeta(p.id, null); }
              else { setMeta(p.id, null); setConflict(p.id, { deleted: true, version: 0, data: null, sections: [] }); }
              continue;
            }
            await push(p.id, toPayload(p), 0);
            if (get().meta[p.id]) migrated.push(p.name);
          }
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
              else if (p && c.data) { adopt(applyPayload(p, c.data)); setMeta(id, { version: c.version, hashes: hashSections(c.data) }); }
            } else if (p) {
              // Keep this device's version: send it over the server's, based on the version the server has now.
              await push(id, toPayload(p), c.version);
            }
          } catch (err) {
            if (!(err instanceof SignedOut) && !(err instanceof Unreachable)) throw err;
            // Nothing was lost; the question comes back with the next sync.
          }
          void sync();
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
