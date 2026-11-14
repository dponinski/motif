"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import AuthDialog from "@/components/auth/AuthDialog";
import { AccountNotices, useAccountInit } from "@/components/git/AccountControls";
import { useAuth } from "@/store/auth";
import { useTeams } from "@/store/teams";

// Where the link in an invitation opens. Signed out, it asks to sign in (with the address that was invited) and comes back
// here; signed in, a press takes up the invitation.
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  useAccountInit();
  const { status, user, openDialog } = useAuth();
  const accept = useTeams((s) => s.accept);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    const r = await accept({ token: decodeURIComponent(token) });
    setBusy(false);
    if (r.error) setError(r.error);
    else setJoined(r.teamName ?? "the team");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-base p-6 text-text-primary">
      <AccountNotices />
      <AuthDialog />
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-surface-border bg-surface-raised p-6 shadow-lg" data-invite-page>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">M</div>
        {status === "unknown" ? (
          <p className="flex items-center gap-2 text-xs text-text-tertiary"><Loader2 size={12} className="animate-spin" /> One moment…</p>
        ) : status === "unavailable" ? (
          <p className="text-sm font-medium">Accounts aren&apos;t set up on this server, so there are no teams here.</p>
        ) : joined ? (
          <>
            <div>
              <p className="text-sm font-medium" role="status">You&apos;re in {joined}.</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">Its design systems are on your dashboard.</p>
            </div>
            <Link href="/" className="flex h-9 items-center justify-center rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent/90">Open the dashboard</Link>
          </>
        ) : !user ? (
          <>
            <div>
              <p className="text-sm font-medium">You&apos;ve been invited to a team on Motif</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">Sign in with the email address the invitation was sent to, and you can join.</p>
            </div>
            <button onClick={openDialog} className="flex h-9 items-center justify-center rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent/90">Sign in to join</button>
          </>
        ) : (
          <>
            <div>
              <p className="text-sm font-medium">Join the team</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">as <span className="text-text-primary" data-invite-email>{user.email}</span></p>
            </div>
            {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
            <button onClick={() => void join()} disabled={busy} className="flex h-9 items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} Join
            </button>
          </>
        )}
      </div>
    </main>
  );
}
