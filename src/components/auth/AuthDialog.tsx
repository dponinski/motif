"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Github, Loader2, Mail, X } from "lucide-react";
import { signInUrl, hereWithoutNotices, useAuth } from "@/store/auth";

const providerButton = "flex h-9 w-full items-center justify-center gap-2 rounded-md border border-surface-border bg-surface-subtle text-sm font-medium text-text-primary transition-colors hover:bg-surface-overlay";

// The ways to sign in that this server offers, one under another. Whoever may sign in is decided by the server; this
// only says how.
function EmailForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/auth/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-requested-with": "motif" },
        body: JSON.stringify({ email, returnTo: hereWithoutNotices() }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "The link couldn't be sent right now");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The link couldn't be sent right now");
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <p className="rounded-md border border-surface-border px-3 py-2.5 text-xs leading-relaxed text-text-secondary" role="status" data-email-sent>
        If <span className="text-text-primary">{email}</span> can sign in here, a link is on its way. It works once, for 15 minutes.{" "}
        <button type="button" onClick={() => setState("idle")} className="underline hover:text-text-primary">Use another address</button>
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input className="input-sm" type="email" required placeholder="you@example.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      <button type="submit" disabled={state === "sending" || !email.trim()} className={`${providerButton} disabled:opacity-60`}>
        {state === "sending" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Email me a sign-in link
      </button>
    </form>
  );
}

export default function AuthDialog() {
  const { dialog, closeDialog, providers, nobodyAllowed } = useAuth();
  const go = (provider: "github" | "google" | "apple") => window.location.assign(signInUrl(provider, hereWithoutNotices()));
  const social = providers.github || providers.google || providers.apple;
  const none = !social && !providers.email;

  return (
    <Dialog.Root open={dialog} onOpenChange={(o) => { if (!o) closeDialog(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-surface-border bg-surface-raised p-4 shadow-2xl text-text-primary"
        >
          <div className="mb-3 flex items-center">
            <Dialog.Title className="flex-1 text-sm font-medium">Sign in to Motif</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="text-xs leading-relaxed text-text-secondary">Signing in lets you use the assistant. Only people who have been added to the list of who may sign in can.</p>
            {nobodyAllowed && (
              <p className="rounded-md border border-amber-500/40 px-3 py-2 text-xs leading-relaxed text-amber-500" role="alert">
                Nobody is allowed to sign in yet: whoever runs this site needs to set <span className="font-mono">ALLOWED_EMAILS</span>.
              </p>
            )}
            {none && <p className="text-xs text-text-tertiary">No way to sign in has been set up on this server.</p>}
            {providers.github && <button type="button" data-provider="github" onClick={() => go("github")} className={providerButton}><Github size={14} /> Continue with GitHub</button>}
            {providers.google && <button type="button" data-provider="google" onClick={() => go("google")} className={providerButton}>Continue with Google</button>}
            {providers.apple && <button type="button" data-provider="apple" onClick={() => go("apple")} className={providerButton}>Continue with Apple</button>}
            {social && providers.email && <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-text-tertiary"><span className="h-px flex-1 bg-surface-border" /> or <span className="h-px flex-1 bg-surface-border" /></div>}
            {providers.email && <EmailForm />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
