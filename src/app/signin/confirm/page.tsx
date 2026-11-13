"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

// Where the link in a sign-in email opens. It says who it would sign in and waits for a press, so a mail program that
// opens links to check them can't use the link up before the person does.
const HEADERS = { "Content-Type": "application/json", "x-requested-with": "motif" };

function Confirm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const returnTo = params.get("returnTo") ?? "/";
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/auth/email/verify?token=${encodeURIComponent(token)}`, { headers: { "x-requested-with": "motif" }, cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, body: (await res.json().catch(() => null)) as { email?: string; error?: string } | null }))
      .then(({ ok, body }) => { if (live) { if (ok && body?.email) setEmail(body.email); else setError(body?.error ?? "This link isn't valid."); } })
      .catch(() => { if (live) setError("The server couldn't be reached."); });
    return () => { live = false; };
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/email/verify", { method: "POST", headers: HEADERS, body: JSON.stringify({ token, returnTo }) });
      const body = (await res.json().catch(() => null)) as { error?: string; returnTo?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "This link isn't valid.");
      window.location.assign(body?.returnTo ?? "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "This link isn't valid.");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-base p-6 text-text-primary">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-surface-border bg-surface-raised p-6 shadow-lg">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">M</div>
        {error ? (
          <>
            <p className="text-sm font-medium" role="alert">{error}</p>
            <a href="/" className="text-xs text-text-secondary underline hover:text-text-primary">Back to Motif</a>
          </>
        ) : email ? (
          <>
            <div>
              <p className="text-sm font-medium">Sign in to Motif</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">as <span className="text-text-primary" data-confirm-email>{email}</span></p>
            </div>
            <button onClick={confirm} disabled={busy} className="flex h-9 items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} Sign in
            </button>
            <p className="text-2xs leading-relaxed text-text-tertiary">Only continue if you asked for this link. Anyone who sends you one can't sign in as you, but they could sign you in as them.</p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> Checking the link…</p>
        )}
      </div>
    </main>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <Confirm />
    </Suspense>
  );
}
