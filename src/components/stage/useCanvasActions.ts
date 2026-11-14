"use client";

import { useRef } from "react";
import { useEditStore, currentText } from "@/store/edit";
import { choicesFor } from "@/lib/edit/tokens";
import { cleanEdits, valueForPx, type GestureEdit } from "@/lib/edit/gesture";
import { deleteElement, duplicateElement, elementSource, moveElement } from "@/lib/edit/element";
import { insertElement, unwrapElement, wrapElement } from "@/lib/edit/insert";
import { elementTree, relatives } from "@/lib/edit/tree";
import type { LibraryComponent } from "@/lib/preview/library";
import type { LibrarySource } from "@/store/library";
import type { useElementEdit } from "@/components/panels/useElementEdit";

// What the canvas does for the picked element: a dragged handle, a key, an entry in the right-click menu. All of it goes through
// the same edit functions as the inspector, so each is one step to undo.

export interface KeyInfo { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

export function useCanvasActions(component: LibraryComponent, source: LibrarySource, edit: ReturnType<typeof useElementEdit>) {
  // What was copied: the text of an element. Kept here, not in the system clipboard, which a page can't read without asking.
  const clipboard = useRef<string | null>(null);
  const { derived, selection, info, run, reader, index, theme } = edit;

  const readCode = async (path: string) => currentText(useEditStore.getState(), path) ?? (await reader.readText(path, source.branch));
  const select = (start: number | null) => useEditStore.getState().select(start === null ? null : { path: component.file, start });
  const treeNow = async () => {
    const code = await readCode(component.file);
    return code === null ? [] : elementTree(component.file, code, component.exported === "default" ? "default" : component.name);
  };
  const stylesheetComponent = !!derived?.css;

  // A handle was let go: the sizes it asks for become tokens, steps or written-out values, as one edit. Whether anything changed
  // is told back to the page.
  const applyGesture = async (key: string, asked: unknown): Promise<boolean> => {
    if (!derived || !selection || key !== `${selection.path}|${selection.start}`) return false;
    const list = cleanEdits(asked).flatMap((e: GestureEdit) => {
      const group = derived.groups.find((g) => g.id === e.group);
      return group ? [{ group, value: valueForPx(e.px, choicesFor(group, index, theme)) }] : [];
    });
    const before = useEditStore.getState().revision;
    await derived.changeMany(list);
    return useEditStore.getState().revision !== before;
  };

  const act = {
    duplicate: () => run((c, s) => duplicateElement(selection!.path, c, s)),
    remove: () => run((c, s) => deleteElement(selection!.path, c, s)),
    moveUp: () => run((c, s) => moveElement(selection!.path, c, s, -1)),
    moveDown: () => run((c, s) => moveElement(selection!.path, c, s, 1)),
    wrapInBox: () => run((c, s) => wrapElement(selection!.path, c, s, "div", stylesheetComponent ? null : "flex flex-col")),
    unwrap: () => run((c, s) => unwrapElement(selection!.path, c, s)),
    copy: async () => {
      if (!selection) return;
      const code = await readCode(selection.path);
      clipboard.current = code === null ? null : await elementSource(selection.path, code, selection.start);
    },
    // Pasted after the element, or inside it when it has no place beside others (the root of a component).
    paste: async () => {
      const jsx = clipboard.current;
      if (!jsx || !selection) return;
      await run((c, s) => insertElement(selection.path, c, s, info?.canDelete ? "after" : "last-child", jsx));
    },
    cut: async () => { await act.copy(); await act.remove(); },
    copyClasses: async () => { if (info?.classes) await navigator.clipboard?.writeText(info.classes).catch(() => undefined); },
  };

  // The keys of editing. Escape goes out to the element around, Enter in to the first one inside, the arrows along its neighbours
  // (with Alt they move the element itself); Delete, duplicate, copy, cut and paste are what they are everywhere.
  const onKey = async (k: KeyInfo) => {
    if (!selection) return;
    const mod = k.metaKey || k.ctrlKey;
    const letter = k.key.length === 1 ? k.key.toLowerCase() : "";
    if (mod && letter === "d") return void (await act.duplicate());
    if (mod && letter === "c") return void (await act.copy());
    if (mod && letter === "x") return void (await act.cut());
    if (mod && letter === "v") return void (await act.paste());
    if (mod && letter === "z") { const store = useEditStore.getState(); return k.shiftKey ? store.redo() : store.undo(); }
    if (mod) return;
    if (k.key === "Delete" || k.key === "Backspace") { if (info?.canDelete) await act.remove(); return; }
    if (k.altKey && (k.key === "ArrowUp" || k.key === "ArrowLeft")) return void (info?.canMoveUp ? await act.moveUp() : undefined);
    if (k.altKey && (k.key === "ArrowDown" || k.key === "ArrowRight")) return void (info?.canMoveDown ? await act.moveDown() : undefined);
    const near = relatives(await treeNow(), selection.start);
    if (k.key === "Escape") return select(near.parent);
    if (k.key === "Enter") return void (near.firstChild !== null ? select(near.firstChild) : undefined);
    if ((k.key === "ArrowUp" || k.key === "ArrowLeft") && near.previous !== null) return select(near.previous);
    if ((k.key === "ArrowDown" || k.key === "ArrowRight") && near.next !== null) return select(near.next);
  };

  return { applyGesture, act, onKey, canPaste: () => clipboard.current !== null };
}
