"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Loader2, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { useTeams, type Member, type TeamView } from "@/store/teams";

const btn = "h-7 rounded-md border border-surface-border px-2.5 text-xs text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary disabled:opacity-50";
const btnPrimary = "flex h-7 items-center justify-center gap-1.5 rounded-md bg-blaze px-3 text-xs font-medium text-on-blaze transition-colors hover:bg-blaze/90 disabled:opacity-50";

function Avatar({ member }: { member: Pick<Member, "name" | "email" | "avatar"> }) {
  const label = member.name || member.email;
  return member.avatar
    ? <img src={member.avatar} alt="" className="h-6 w-6 flex-shrink-0 rounded-full" referrerPolicy="no-referrer" />
    : <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-on-cobalt">{label[0]?.toUpperCase()}</span>;
}

function Invite({ team }: { team: TeamView }) {
  const invite = useTeams((s) => s.invite);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; link: string; mailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    const r = await invite(team.id, email);
    setBusy(false);
    if (r.error || !r.link) { setError(r.error ?? "That didn't work"); return; }
    setSent({ email: email.trim(), link: r.link, mailed: !!r.mailed });
    setEmail("");
  };
  const copy = async () => {
    if (!sent) return;
    try { await navigator.clipboard.writeText(sent.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the link is shown to copy by hand */ }
  };

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex gap-2">
        <input className="input-sm min-w-0 flex-1" type="email" required placeholder="teammate@example.com" aria-label="Invite by email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <button type="submit" className={btnPrimary} disabled={busy || !email.trim()}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Invite
        </button>
      </form>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      {sent && (
        <div className="flex flex-col gap-1.5 rounded-md border border-surface-border p-2.5" role="status" data-invite-sent>
          <p className="text-xs text-text-primary">{sent.mailed ? <>An invitation was emailed to <span className="font-medium">{sent.email}</span>.</> : <>Invited <span className="font-medium">{sent.email}</span>. No email was sent: pass them this link.</>}</p>
          <div className="flex items-center gap-1.5">
            <input readOnly className="input-sm min-w-0 flex-1 font-mono" aria-label="Invitation link" value={sent.link} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className={btn} onClick={() => void copy()} aria-label="Copy the link">{copied ? <Check size={12} /> : <Copy size={12} />}</button>
          </div>
          <p className="text-2xs leading-relaxed text-text-tertiary">They sign in with that address and are in. It works for 14 days.</p>
        </div>
      )}
    </div>
  );
}

function Body({ teamId, onGone }: { teamId: string; onGone: () => void }) {
  const team = useTeams((s) => s.teams.find((t) => t.id === teamId));
  const t = useTeams();
  const me = useAuth((s) => s.user);
  const [name, setName] = useState(team?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"leave" | "delete" | null>(null);
  useEffect(() => { if (team) setName(team.name); }, [team?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!team) return <p className="text-xs text-text-secondary">You are not in this team any more.</p>;
  const owner = team.role === "owner";
  const owners = team.members.filter((m) => m.role === "owner").length;
  const run = async (action: Promise<string | null>) => { setError(null); const e = await action; if (e) setError(e); return !e; };

  return (
    <div className="flex flex-col gap-4">
      {owner ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== team.name) void run(t.rename(team.id, name)); }}>
          <input className="input-sm min-w-0 flex-1" aria-label="Team name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className={btn} disabled={!name.trim() || name.trim() === team.name}>Rename</button>
        </form>
      ) : (
        <p className="text-xs text-text-secondary">You are a member of <span className="font-medium text-text-primary">{team.name}</span>. You can edit its design systems; an owner invites people and deletes them.</p>
      )}

      <section aria-label="Members" className="flex flex-col gap-1.5">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">Members ({team.members.length})</h3>
        <ul className="divide-y divide-surface-border rounded-md border border-surface-border">
          {team.members.map((m) => {
            const self = m.userId === me?.id;
            return (
              <li key={m.userId} className="flex items-center gap-2 px-2.5 py-2" data-member={m.email}>
                <Avatar member={m} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-text-primary">{m.name || m.email}{self && <span className="text-text-tertiary"> (you)</span>}</p>
                  {m.name && <p className="truncate text-2xs text-text-tertiary">{m.email}</p>}
                </div>
                {owner ? (
                  <select className="input-sm !w-24" aria-label={`Role of ${m.email}`} value={m.role} onChange={(e) => void run(t.setRole(team.id, m.userId, e.target.value as "owner" | "member"))} disabled={m.role === "owner" && owners <= 1}>
                    <option value="owner">Owner</option>
                    <option value="member">Member</option>
                  </select>
                ) : <span className="text-2xs text-text-tertiary">{m.role === "owner" ? "Owner" : "Member"}</span>}
                {owner && !self && <button className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-danger" aria-label={`Remove ${m.email}`} onClick={() => void run(t.removeMember(team.id, m.userId))}><X size={12} /></button>}
              </li>
            );
          })}
        </ul>
      </section>

      {owner && (
        <section aria-label="Invitations" className="flex flex-col gap-2">
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">Invite someone</h3>
          <Invite team={team} />
          {team.invites.length > 0 && (
            <ul className="divide-y divide-surface-border rounded-md border border-surface-border" aria-label="Waiting to join">
              {team.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs" data-invite={i.email}>
                  <span className="min-w-0 flex-1 truncate text-text-secondary">{i.email}</span>
                  <span className="text-2xs text-text-tertiary">invited</span>
                  <button className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-danger" aria-label={`Cancel the invitation to ${i.email}`} onClick={() => void run(t.revoke(team.id, i.id))}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && <p className="text-xs text-danger" role="alert">{error}</p>}

      <div className="flex flex-col gap-2 border-t border-surface-border pt-3">
        {confirming === "leave" ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary" role="alertdialog" aria-label="Leave the team">
            <span className="flex-1">Leave {team.name}? Its design systems leave this browser unless you have changes of your own in them.</span>
            <button className={btn} onClick={() => setConfirming(null)}>Stay</button>
            <button className="h-7 rounded-md bg-danger px-3 text-xs font-medium text-text-inverse hover:bg-danger/90" onClick={async () => { if (me && (await run(t.removeMember(team.id, me.id)))) { onGone(); void import("@/store/sync").then((m) => m.useSync.getState().sync()); } }}>Leave</button>
          </div>
        ) : confirming === "delete" ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary" role="alertdialog" aria-label="Delete the team">
            <span className="flex-1">Delete {team.name}? A team can be deleted once it has no design systems.</span>
            <button className={btn} onClick={() => setConfirming(null)}>Keep</button>
            <button className="h-7 rounded-md bg-danger px-3 text-xs font-medium text-text-inverse hover:bg-danger/90" onClick={async () => { if (await run(t.remove(team.id))) onGone(); else setConfirming(null); }}>Delete team</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button className={btn} onClick={() => setConfirming("leave")} disabled={owner && owners <= 1}>Leave team</button>
            {owner && <button className={cn(btn, "hover:text-danger")} onClick={() => setConfirming("delete")}>Delete team</button>}
            {owner && owners <= 1 && <span className="self-center text-2xs text-text-tertiary">Make someone else an owner before leaving.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Who is in a team, and the invitations that are out. Owners change all of it; members see it and can leave.
export default function TeamDialog({ teamId, open, onOpenChange }: { teamId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[460px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 select-text overflow-y-auto rounded-xl border border-surface-border bg-surface-raised p-4 text-text-primary shadow-2xl"
        >
          <div className="mb-3 flex items-center">
            <Dialog.Title className="flex-1 text-sm font-medium">Team</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <Body teamId={teamId} onGone={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
