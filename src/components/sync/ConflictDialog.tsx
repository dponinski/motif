"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { SECTIONS, type Section } from "@/lib/sync/payload";
import type { Conflict } from "@/store/sync";

const PARTS: Record<Section, string> = {
  name: "the name",
  connection: "the repository",
  tokenLink: "the link to the repository's tokens",
  tokens: "the tokens",
  docs: "the documentation",
};
const quoted = (names: string[]) => names.map((n) => `“${n}”`).join(", ");
// What was changed on both sides, in words: whole parts, and the items of the tokens and the documentation that clashed.
function partsOf(conflict: Conflict): string[] {
  const parts = SECTIONS.filter((s) => conflict.sections.includes(s)).map((s) => PARTS[s]);
  const tokens = (conflict.items ?? []).filter((i) => i.section === "tokens").map((i) => i.name);
  const pages = (conflict.items ?? []).filter((i) => i.section === "docs").map((i) => i.name);
  if (tokens.length) parts.push(`${tokens.length === 1 ? "the token" : "the tokens"} ${quoted(tokens.slice(0, 6))}${tokens.length > 6 ? ` and ${tokens.length - 6} more` : ""}`);
  if (pages.length) parts.push(`${pages.length === 1 ? "the page" : "the pages"} ${quoted(pages.slice(0, 6))}${pages.length > 6 ? ` and ${pages.length - 6} more` : ""}`);
  return parts;
}
const listOf = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

// Asks which version to keep when the same part of a project was changed differently in two places. Loaded when there
// is a conflict to ask about, not with every page.
export default function ConflictDialog({ id, conflict, name, resolve }: { id: string; conflict: Conflict; name: string; resolve: (id: string, keep: "local" | "server") => Promise<void> | void }) {
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-surface-border bg-surface-raised p-4 text-text-primary shadow-2xl"
        >
            <div className="flex flex-col gap-3" data-sync-conflict>
              <Dialog.Title className="text-sm font-medium">
                {conflict.deleted ? `“${name}” was deleted ${conflict.updatedBy ? `by ${conflict.updatedBy}` : "on another device"}` : `“${name}” was changed ${conflict.updatedBy ? `by ${conflict.updatedBy}` : "on another device"}`}
              </Dialog.Title>
              <p className="text-xs leading-relaxed text-text-secondary">
                {conflict.deleted
                  ? "You have changes to it here that were never saved to your account. You can delete it here too, or keep this copy and save it to your account again."
                  : `You and ${conflict.updatedBy ?? "another device"} both changed ${listOf(partsOf(conflict))}. Choose which version to keep for ${partsOf(conflict).length === 1 && (conflict.items?.length ?? 0) <= 1 ? "it" : "them"}; everything else, from both of you, is kept.`}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <button onClick={() => void resolve(id, "local")} data-keep="local" className="h-8 flex-1 rounded-md bg-blaze px-3 text-xs font-medium text-on-blaze hover:bg-blaze/90">
                  {conflict.deleted ? "Keep this copy" : conflict.updatedBy ? "Keep my version" : "Keep this device's version"}
                </button>
                <button onClick={() => void resolve(id, "server")} data-keep="server" className="h-8 flex-1 rounded-md border border-line px-3 text-xs font-medium text-text-secondary hover:bg-surface-subtle hover:text-text-primary">
                  {conflict.deleted ? "Delete it here too" : conflict.updatedBy ? `Use ${conflict.updatedBy}'s version` : "Use the other version"}
                </button>
              </div>
            </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
