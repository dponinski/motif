"use client";

import { useEffect } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ExternalLink, Github, LogOut, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { takeSignInError, useAccount } from "@/store/account";
import { useAuth } from "@/store/auth";

// Signing in with the GitHub App, where it is offered: a button, who is signed in, and what to tell the person
// when a sign-in ended without being asked to.

// Asks who is signed in, and shows why a sign-in that was just tried didn't finish.
export function useAccountInit() {
  useEffect(() => {
    takeSignInError();
    void useAccount.getState().load();
    void useAuth.getState().load();
  }, []);
}

// Signing in with GitHub. On a server with accounts it signs the person in to Motif too when they aren't yet, and
// otherwise only connects their repositories.
export function SignInButton({ returnTo, label, className }: { returnTo?: string; label?: string; className?: string }) {
  const status = useAccount((s) => s.status);
  const signIn = useAccount((s) => s.signIn);
  const auth = useAuth();
  // Offered only where the server can do it.
  if (status === "unknown" || status === "unavailable") return null;
  const login = auth.status === "ready" && !auth.user;
  const text = label ?? (auth.status === "ready" && auth.user ? "Connect GitHub" : "Sign in with GitHub");
  return (
    <button
      type="button"
      onClick={() => signIn(returnTo, login ? "login" : "connect")}
      className={cn("flex h-7 items-center justify-center gap-1.5 rounded-md bg-text-primary px-3 text-xs font-medium text-surface-base transition-opacity hover:opacity-90", className)}
    >
      <Github size={12} /> {text}
    </button>
  );
}

// In the header: the sign-in button, or who is signed in with what they can do.
export function AccountMenu() {
  const { status, login, avatar, installUrl, signOut } = useAccount();
  if (status === "signed-out") return <SignInButton />;
  if (status !== "signed-in") return null;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="flex h-7 items-center gap-1.5 rounded-md border border-surface-border px-2 text-[12px] text-text-secondary transition-colors hover:text-text-primary" aria-label="GitHub account">
          {avatar ? <img src={avatar} alt="" className="h-4 w-4 rounded-full" /> : <Github size={12} />}
          <span>{login ?? "Signed in"}</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="z-50 min-w-[200px] overflow-hidden rounded-md border border-surface-border bg-surface-raised py-1 text-[12px] text-text-secondary shadow-lg">
          {login && (
            <Menu.Item asChild>
              <a href={`https://github.com/${login}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-1.5 outline-none hover:bg-surface-subtle hover:text-text-primary data-[highlighted]:bg-surface-subtle"><ExternalLink size={12} /> Your GitHub profile</a>
            </Menu.Item>
          )}
          {installUrl && (
            <Menu.Item asChild>
              <a href={installUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-1.5 outline-none hover:bg-surface-subtle hover:text-text-primary data-[highlighted]:bg-surface-subtle"><ExternalLink size={12} /> Install on more repositories</a>
            </Menu.Item>
          )}
          <Menu.Item onSelect={() => void signOut()} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none hover:bg-surface-subtle hover:text-text-primary data-[highlighted]:bg-surface-subtle">
            <LogOut size={12} /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

// A notice at the top of the page for what happened to a sign-in: it was cancelled or refused on the way back, or
// it ran out. Nothing is shown otherwise.
export function AccountNotices() {
  const { notice, ended, setNotice } = useAccount();
  const signIn = useAccount((s) => s.signIn);
  const auth = useAuth();
  if (!notice && ended !== "expired") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4">
      <div role="alert" className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-md border border-amber-500/40 bg-surface-raised px-3 py-2 text-xs text-text-primary shadow-lg">
        <span className="min-w-0">{notice ?? "Your GitHub sign-in has expired."}</span>
        {(ended === "expired" || notice) && (
          <button
            onClick={() => { if (auth.status === "ready" && !auth.user) { setNotice(null); auth.openDialog(); } else signIn(); }}
            className="flex-shrink-0 rounded border border-surface-border px-2 py-0.5 text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
          >
            {ended === "expired" && !notice ? "Sign in again" : "Try again"}
          </button>
        )}
        {notice && <button onClick={() => setNotice(null)} aria-label="Dismiss" className="flex-shrink-0 text-text-tertiary hover:text-text-primary"><X size={12} /></button>}
      </div>
    </div>
  );
}
