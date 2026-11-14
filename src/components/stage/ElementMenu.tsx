"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { MOD } from "@/components/Tip";
import type { ElementInfo } from "@/lib/edit/element";
import type { useCanvasActions } from "./useCanvasActions";

const item = "flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-xs text-text-secondary outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-surface-subtle data-[highlighted]:text-text-primary";

// The menu of a right click on an element in Design: what can be done to it. It opens where the click was.
export default function ElementMenu({ point, info, canPaste, actions, onClose }: {
  point: { x: number; y: number };
  info: ElementInfo | null;
  canPaste: boolean;
  actions: ReturnType<typeof useCanvasActions>["act"];
  onClose: () => void;
}) {
  const row = (label: string, shortcut: string | null, enabled: boolean, run: () => unknown, name?: string) => (
    <Menu.Item key={label} disabled={!enabled} onSelect={() => void run()} className={item} aria-label={name ?? label}>
      <span className="flex-1">{label}</span>
      {shortcut && <kbd className="font-mono text-[10px] text-text-tertiary">{shortcut}</kbd>}
    </Menu.Item>
  );
  return (
    <Menu.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Menu.Trigger asChild>
        <span aria-hidden style={{ position: "fixed", left: point.x, top: point.y, width: 1, height: 1, pointerEvents: "none" }} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-element-menu align="start" side="bottom" sideOffset={2} collisionPadding={8} className="z-[70] min-w-[200px] rounded-lg border border-surface-border bg-surface-raised p-1 shadow-2xl">
          {row("Duplicate", `${MOD}D`, !!info?.canDelete, actions.duplicate)}
          {row("Copy", `${MOD}C`, !!info, actions.copy)}
          {row("Paste", `${MOD}V`, canPaste, actions.paste)}
          {row("Copy classes", null, !!info?.classes, actions.copyClasses)}
          <Menu.Separator className="my-1 h-px bg-surface-border" />
          {row("Move up", "Alt+↑", !!info?.canMoveUp, actions.moveUp)}
          {row("Move down", "Alt+↓", !!info?.canMoveDown, actions.moveDown)}
          {row("Wrap in a box", null, !!info, actions.wrapInBox)}
          {row("Unwrap", null, !!info?.canUnwrap, actions.unwrap)}
          <Menu.Separator className="my-1 h-px bg-surface-border" />
          {row("Delete", "Del", !!info?.canDelete, actions.remove)}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
