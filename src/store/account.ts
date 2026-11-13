import { create } from "zustand";
import type { TokenSource } from "../lib/github";
import { getViewer } from "../lib/github-app";
import { AUTH_NOTICES } from "./auth-notices";

// Who is signed in with the GitHub App, in this browser. Nothing here is kept: the sign-in itself is a cookie the
// page can't read, and the access token it gives is asked for from the server and held in memory only.

export type AccountStatus =
  | "unknown" // not asked yet
  | "unavailable" // sign-in isn't set up on the server, or there is no server (a desktop build)
  | "signed-out"
  | "signed-in";

interface Account {
  status: AccountStatus;
  login: string | null;
  avatar: string | null;
  // The link to install the app on more repositories, when the server knows the app's name.
  installUrl: string | null;
  accessToken: string | null;
  // When the access token stops working; null when it doesn't.
  expiresAt: number | null;
  // Why the sign-in ended without being asked to: it ran out or was revoked.
  ended: "expired" | null;
  // Something to tell the person about the sign-in that has just been tried.
  notice: string | null;
  // Asks the server who is signed in, and for a token that works; a token GitHub has refused is renewed.
  load: (renew?: boolean) => Promise<void>;
  // `purpose` "login" signs in to Motif with GitHub as well as connecting its repositories.
  signIn: (returnTo?: string, purpose?: "connect" | "login") => void;
  signOut: () => Promise<void>;
  setNotice: (notice: string | null) => void;
}

const HEADERS = { "x-requested-with": "motif" };

export const NOTICES: Record<string, string> = {
  denied: "GitHub sign-in was cancelled.",
  state: "That sign-in wasn't started from this browser, so it wasn't finished. Try again.",
  unavailable: "GitHub couldn't be reached. Try signing in again.",
  failed: "GitHub sign-in didn't complete. Try again.",
};

let pending: Promise<void> | null = null;
let pendingRenewal = false;

export const useAccount = create<Account>()((set, get) => {
  async function ask(renew: boolean) {
    let res: Response;
    try {
      res = await fetch(`/api/github/session${renew ? "?force=1" : ""}`, { headers: HEADERS, cache: "no-store", credentials: "same-origin" });
    } catch {
      // No server to ask (a desktop build): there is no sign-in, and nothing to wait for.
      if (get().status === "unknown") set({ status: "unavailable" });
      return;
    }
    // GitHub being out of reach says nothing about the sign-in: what there is stays.
    if (res.status === 502) return;
    const body = (await res.json().catch(() => null)) as { configured?: boolean; signedIn?: boolean; accessToken?: string; expiresAt?: number | null; installUrl?: string | null; reason?: string } | null;
    if (!res.ok || !body || !body.configured) { set({ status: "unavailable", accessToken: null, login: null, avatar: null }); return; }
    if (!body.signedIn || !body.accessToken) {
      set({ status: "signed-out", accessToken: null, expiresAt: null, login: null, avatar: null, installUrl: body.installUrl ?? null, ended: body.reason === "expired" ? "expired" : null });
      return;
    }
    set({ status: "signed-in", accessToken: body.accessToken, expiresAt: body.expiresAt ?? null, installUrl: body.installUrl ?? null, ended: null });
    if (!get().login) {
      try {
        const viewer = await getViewer(body.accessToken);
        set({ login: viewer.login, avatar: viewer.avatar });
      } catch { /* the name is only for show */ }
    }
  }

  return {
    status: "unknown",
    login: null,
    avatar: null,
    installUrl: null,
    accessToken: null,
    expiresAt: null,
    ended: null,
    notice: null,

    // One request at a time: a page that asks twice gets the same answer, and a renewal asked for while another
    // is on its way is that renewal, not a second one (the server only gives each refresh token one use).
    load: async (renew = false) => {
      if (pending && (pendingRenewal || !renew)) { await pending; return; }
      if (pending) await pending;
      const run = ask(renew).finally(() => { if (pending === run) { pending = null; pendingRenewal = false; } });
      pending = run;
      pendingRenewal = renew;
      await run;
    },

    signIn: (returnTo, purpose = "connect") => {
      const to = returnTo ?? `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/api/github/login?returnTo=${encodeURIComponent(to)}${purpose === "login" ? "&purpose=login" : ""}`);
    },

    signOut: async () => {
      try {
        await fetch("/api/github/logout", { method: "POST", headers: HEADERS, credentials: "same-origin" });
      } catch { /* the cookie goes with the next successful call; the page is signed out either way */ }
      set({ status: "signed-out", accessToken: null, expiresAt: null, login: null, avatar: null, ended: null });
    },

    setNotice: (notice) => set({ notice }),
  };
});

// The token to use for a request: the signed-in account's, renewed when it is about to stop working. A request that
// GitHub has refused the token of says which, and gets a new one, unless the token has already been replaced
// since (several requests are refused at once, and one renewal answers them all). Null when nobody is signed in.
export const appTokenSource: TokenSource = {
  async get(refused) {
    if (useAccount.getState().status === "unknown") await useAccount.getState().load();
    const state = useAccount.getState();
    if (state.status !== "signed-in") return null;
    if (refused !== undefined ? state.accessToken === refused : state.expiresAt !== null && state.expiresAt - Date.now() < 60_000) await state.load(refused !== undefined);
    return useAccount.getState().accessToken;
  },
};

// A sign-in that ended on the way back (cancelled, refused) leaves the reason in the address; it is shown once
// and taken out of the address, so a reload doesn't show it again.
export function takeSignInError() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const github = url.searchParams.get("github_error");
  const account = url.searchParams.get("auth_error");
  if (!github && !account) return;
  url.searchParams.delete("github_error");
  url.searchParams.delete("auth_error");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  useAccount.getState().setNotice(account ? AUTH_NOTICES[account] ?? AUTH_NOTICES.failed : NOTICES[github!] ?? NOTICES.failed);
}
