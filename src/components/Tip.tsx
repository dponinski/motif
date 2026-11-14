"use client";

import * as Tooltip from "@radix-ui/react-tooltip";

// The key that Cmd is on a Mac and Ctrl is elsewhere, for a shortcut shown in a tooltip.
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function TipProvider({ children }: { children: React.ReactNode }) {
  return <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>{children}</Tooltip.Provider>;
}

// A tooltip with the name of what a button does and, if it has one, its shortcut. The button keeps its own `aria-label`.
export default function Tip({ label, shortcut, side = "bottom", children }: { label: string; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; children: React.ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="z-[60] flex items-center gap-1.5 rounded bg-text-primary px-2 py-1 text-2xs text-surface-base shadow-lg">
          {label}
          {shortcut && <kbd className="rounded bg-white/20 px-1 font-mono text-[10px]">{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
