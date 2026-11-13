"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { ExternalLink, Github, LogOut } from "lucide-react";
import { AccountMenu } from "@/components/git/AccountControls";
import { useAccount } from "@/store/account";
import { useAuth } from "@/store/auth";
import { useSync } from "@/store/sync";

const item = "flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none hover:bg-surface-subtle hover:text-text-primary data-[highlighted]:bg-surface-subtle";

// In the header: how to sign in to Motif, or who is signed in with what they can do. On a server without accounts
// it is the GitHub account menu, as it was.
export default function UserMenu() {
  const { status, user, signOut, openDialog } = useAuth();
  const github = useAccount();
  const sync = useSync();
  if (status === "unknown") return null;
  if (status === "unavailable") return <AccountMenu />;

  if (!user) {
    return (
      <button onClick={openDialog} className="flex h-7 items-center gap-1.5 rounded-md bg-text-primary px-3 text-[12px] font-medium text-surface-base transition-opacity hover:opacity-90">
        Sign in
      </button>
    );
  }
  const label = user.name || user.email;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="flex h-7 items-center gap-1.5 rounded-md border border-surface-border px-2 text-[12px] text-text-secondary transition-colors hover:text-text-primary" aria-label="Your account">
          {user.avatar ? <img src={user.avatar} alt="" className="h-4 w-4 rounded-full" referrerPolicy="no-referrer" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-white">{label[0]?.toUpperCase()}</span>}
          <span className="max-w-[160px] truncate">{label}</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="z-50 min-w-[220px] overflow-hidden rounded-md border border-surface-border bg-surface-raised py-1 text-[12px] text-text-secondary shadow-lg">
          <div className="border-b border-surface-border px-3 py-2">
            {user.name && <p className="truncate text-text-primary">{user.name}</p>}
            <p className="truncate text-text-tertiary" data-account-email>{user.email}</p>
          </div>
          <div className="border-b border-surface-border px-3 py-1.5 text-2xs text-text-tertiary" data-sync-status={sync.status}>
            {sync.status === "syncing" ? "Saving your projects…"
              : sync.status === "offline" ? "Offline: your projects are saved here and will be sent when you're back online"
              : sync.status === "error" ? "Some projects couldn't be saved to your account"
              : sync.status === "idle" ? "Your projects are saved to your account"
              : "Projects aren't being saved to your account"}
          </div>
          {github.status === "signed-in" ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-text-tertiary" data-github-connected><Github size={12} /> GitHub: {github.login ?? "connected"}</div>
          ) : github.status === "signed-out" ? (
            <Menu.Item onSelect={() => github.signIn(undefined, "connect")} className={item}><Github size={12} /> Connect GitHub</Menu.Item>
          ) : null}
          {github.status === "signed-in" && github.installUrl && (
            <Menu.Item asChild>
              <a href={github.installUrl} target="_blank" rel="noreferrer" className={item}><ExternalLink size={12} /> Install on more repositories</a>
            </Menu.Item>
          )}
          <Menu.Item onSelect={() => void signOut()} className={item}><LogOut size={12} /> Sign out</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
