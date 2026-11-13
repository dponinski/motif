import { create } from "zustand";
import { useAccount } from "./account";
import { useSync } from "./sync";
export { AUTH_NOTICES } from "./auth-notices";

// Who is signed in to Motif itself (as opposed to to GitHub, for repositories: store/account.ts). Nothing here is
// kept: the sign-in is a cookie the page can't read, and the page asks the server who it belongs to.

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
}

export interface Providers { github: boolean; google: boolean; apple: boolean; email: boolean }

interface Auth {
  // "unavailable": the server has no accounts (or there is no server, as in a desktop build), and nothing is offered.
  status: "unknown" | "unavailable" | "ready";
  providers: Providers;
  nobodyAllowed: boolean;
  user: AuthUser | null;
  // The sign-in dialog is open. Anything that needs a person to be signed in can open it.
  dialog: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  load: () => Promise<void>;
  signOut: () => Promise<void>;
}

const NONE: Providers = { github: false, google: false, apple: false, email: false };
const HEADERS = { "x-requested-with": "motif" };

let pending: Promise<void> | null = null;

export const useAuth = create<Auth>()((set) => ({
  status: "unknown",
  providers: NONE,
  nobodyAllowed: false,
  user: null,
  dialog: false,
  openDialog: () => set({ dialog: true }),
  closeDialog: () => set({ dialog: false }),

  load: () => {
    if (pending) return pending;
    const run = (async () => {
      try {
        const res = await fetch("/api/auth/session", { headers: HEADERS, cache: "no-store", credentials: "same-origin" });
        const body = (await res.json().catch(() => null)) as { configured?: boolean; providers?: Providers; nobodyAllowed?: boolean; user?: AuthUser | null } | null;
        if (!res.ok || !body?.configured) { set({ status: "unavailable", providers: NONE, user: null }); return; }
        set({ status: "ready", providers: body.providers ?? NONE, nobodyAllowed: !!body.nobodyAllowed, user: body.user ?? null });
      } catch {
        // No server to ask: there are no accounts.
        set({ status: "unavailable", providers: NONE, user: null });
      }
    })().finally(() => { pending = null; });
    pending = run;
    return run;
  },

  signOut: async () => {
    // What is saved to the account goes off this browser (after anything not yet sent is sent), so it isn't there for
    // the next person who uses it.
    await useSync.getState().stop({ clear: true });
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: HEADERS, credentials: "same-origin" });
    } catch { /* the page is signed out either way; the cookie goes with the next successful call */ }
    set({ user: null });
    // The GitHub sign-in goes with it (the server has cleared it and revoked its token).
    useAccount.setState({ status: "signed-out", accessToken: null, expiresAt: null, login: null, avatar: null, ended: null });
  },
}));

export const signInUrl = (provider: "github" | "google" | "apple", returnTo: string) =>
  provider === "github"
    ? `/api/github/login?purpose=login&returnTo=${encodeURIComponent(returnTo)}`
    : `/api/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;

export const hereWithoutNotices = () => (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`);
