"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// A short walk round the canvas the first time a component is opened in Design: what each part is for, one card at a time, pointing at
// the part. It never blocks the page (there is no backdrop), it is left at Skip or Esc, and it is not shown again once it has been
// left or finished. The question mark in the toolbar shows it again.
const KEY = "motif-tour-done";

interface Step { anchor: string; title: string; body: string }

const STEPS: Step[] = [
  { anchor: "canvas", title: "Your component, on a canvas", body: "Click any element to pick it, then change it on the right. Drag the handles on a picked element to resize it. Scroll to pan; Ctrl or ⌘ and scroll to zoom." },
  { anchor: "add", title: "Add things", body: "Press an element to add it to the one you picked, or drag it onto the canvas and a line shows where it will go. Your repository's own components are in the list too." },
  { anchor: "sizes", title: "Try other sizes", body: "Switch the width, or press Compare to see Phone, Tablet and Desktop side by side. They all follow every edit." },
  { anchor: "layers", title: "Layers", body: "Everything the component is made of. Drag a row to move it. On the canvas, double-click text to type in it." },
  { anchor: "panel", title: "Style it here", body: "Layout, spacing, size, type and color for what you picked. Every change goes into the component's code, and into a pull request when you sync." },
];

const find = (anchor: string) => document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);

export function tourSeen(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return true; }
}
const remember = () => { try { localStorage.setItem(KEY, "1"); } catch { /* it is shown again next time */ } };

// Opens by itself once, when `ready` (the component is on the canvas), and again when asked.
export function useTour(ready: boolean) {
  const [open, setOpen] = useState(false);
  const checked = useRef(false);
  useEffect(() => {
    if (!ready || checked.current) return;
    checked.current = true;
    if (!tourSeen()) setOpen(true);
  }, [ready]);
  const close = useCallback(() => { remember(); setOpen(false); }, []);
  const start = useCallback(() => setOpen(true), []);
  return { open, close, start };
}

const CARD = { width: 300, gap: 12, margin: 12 };

// Where the card goes: beside what it points at, on the side with room.
export function place(rect: { left: number; top: number; right: number; bottom: number }, view: { width: number; height: number }, height: number): { left: number; top: number } {
  const { width, gap, margin } = CARD;
  let left: number, top: number;
  if (rect.left > view.width * 0.66) { left = rect.left - width - gap; top = rect.top + 8; }
  else if (rect.right < view.width * 0.3) { left = rect.right + gap; top = rect.top + 8; }
  else if (rect.bottom + gap + height < view.height - margin && rect.top < view.height * 0.4) { left = rect.left + (rect.right - rect.left) / 2 - width / 2; top = rect.bottom + gap; }
  else { left = rect.left + (rect.right - rect.left) / 2 - width / 2; top = rect.bottom - height - 56; }
  return {
    left: Math.max(margin, Math.min(view.width - width - margin, left)),
    top: Math.max(margin, Math.min(view.height - height - margin, top)),
  };
}

export default function Tour({ onClose }: { onClose: () => void }) {
  // Steps whose part isn't on the page (Compare is not in every mode) are left out.
  const [steps] = useState(() => STEPS.filter((s) => find(s.anchor)));
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<{ rect: DOMRect; left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index];

  const measure = useCallback(() => {
    const el = step && find(step.anchor);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const height = card.current?.offsetHeight ?? 170;
    setBox({ rect, ...place(rect, { width: window.innerWidth, height: window.innerHeight }, height) });
  }, [step]);

  useLayoutEffect(() => { measure(); }, [measure, index]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    const timer = setInterval(measure, 400);
    return () => { window.removeEventListener("resize", measure); clearInterval(timer); };
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => { if (steps.length === 0) onClose(); }, [steps.length, onClose]);
  if (!step || !box) return null;
  const last = index === steps.length - 1;

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-[85] rounded-md ring-2 ring-accent/70"
        style={{ left: box.rect.left - 2, top: box.rect.top - 2, width: box.rect.width + 4, height: box.rect.height + 4 }}
      />
      <div
        ref={card}
        role="dialog"
        aria-label="Tour"
        data-tour-card
        className="fixed z-[90] rounded-lg border border-surface-border bg-surface-raised p-3.5 text-text-primary shadow-2xl"
        style={{ left: box.left, top: box.top, width: CARD.width }}
      >
        <div className="mb-1 flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium">{step.title}</p>
          <button onClick={onClose} aria-label="Skip the tour" title="Skip the tour" className="-mr-1 -mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-tertiary hover:bg-surface-subtle hover:text-text-primary"><X size={13} /></button>
        </div>
        <p className="text-xs leading-relaxed text-text-secondary">{step.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-2xs tabular-nums text-text-tertiary">{index + 1} of {steps.length}</span>
          <div className="flex-1" />
          {index > 0 && <button onClick={() => setIndex(index - 1)} className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary">Back</button>}
          <button onClick={() => (last ? onClose() : setIndex(index + 1))} className="rounded bg-blaze px-3 py-1 text-xs font-medium text-on-blaze hover:bg-blaze/90">{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </>
  );
}
