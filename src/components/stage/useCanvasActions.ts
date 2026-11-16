"use client";

import { useRef } from "react";
import { useEditStore, currentText } from "@/store/edit";
import { choicesFor } from "@/lib/edit/tokens";
import { cleanEdits, valueForPx, type GestureEdit } from "@/lib/edit/gesture";
import { analyze, deleteElement, duplicateElement, elementSource, moveElement, setText } from "@/lib/edit/element";
import { parseMotifKey } from "@/lib/edit/instrument";
import { stylesheetOf } from "@/lib/edit/css-element";
import { plain } from "@/lib/edit/snippets";
import { insertElement, unwrapElement, wrapElement, type InsertPosition } from "@/lib/edit/insert";
import { elementTree, relatives } from "@/lib/edit/tree";
import type { LibraryComponent } from "@/lib/preview/library";
import type { LibrarySource } from "@/store/library";
import type { useElementEdit } from "@/components/panels/useElementEdit";
import { editInFile, insertInFile, moveInFile } from "@/components/panels/fileEdits";
import type { PaletteItem } from "./InsertPalette";
import { errorMessage } from "@/components/git/hooks";

// What the canvas does for the picked element: a dragged handle, a key, an entry in the right-click menu. All of it goes through
// the same edit functions as the inspector, so each is one step to undo.

export interface KeyInfo { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

export function useCanvasActions(component: LibraryComponent, source: LibrarySource, edit: ReturnType<typeof useElementEdit>, onError: (message: string | null) => void = () => undefined) {
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
  const fileRef = { file: component.file, branch: source.branch, reader };
  const startOf = (key: string): number | null => {
    const picked = parseMotifKey(key);
    return picked && picked.path === component.file ? picked.start : null;
  };
  // Runs something that can fail with a reason worth telling (an element that can't hold another, a file that doesn't read).
  const attempt = async <T,>(job: () => Promise<T>): Promise<T | undefined> => {
    onError(null);
    try { return await job(); } catch (err) { onError(errorMessage(err)); return undefined; }
  };
  const VOID = new Set(["img", "input", "br", "hr", "meta", "link", "source", "wbr"]);

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

  // An element from the palette, added where it is dropped, or else inside the picked element (beside it, when that can't hold
  // anything) or inside the component's own outermost element when nothing is picked.
  const insertItem = (item: PaletteItem, at?: { start: number; position: InsertPosition }) => attempt(async () => {
    const code = await readCode(component.file);
    if (code === null) return;
    const sheet = source.tailwindVersion === null && !!stylesheetOf(component.file, code);
    let place = at;
    if (!place && selection) place = { start: selection.start, position: VOID.has(info?.tag ?? "") ? "after" : "last-child" };
    if (!place) {
      const root = (await treeNow())[0];
      if (!root) return;
      place = { start: root.start, position: "last-child" };
    }
    await insertInFile(fileRef, place.start, place.position, sheet ? plain(item.jsx) : item.jsx, item.imp);
  });

  // Dropped from the palette on a place the page named.
  const insertAtKey = (item: PaletteItem, key: string, position: string | null) => {
    const start = startOf(key);
    return start === null || !position ? Promise.resolve(undefined) : insertItem(item, { start, position: position as InsertPosition });
  };

  // An element dragged by its grip, let go on a place the page named.
  const moveTo = (key: string, target: string, position: string) => attempt(async () => {
    const from = startOf(key);
    const to = startOf(target);
    if (from !== null && to !== null) await moveInFile(fileRef, from, to, position as InsertPosition);
  });

  // A double click on an element: can its text be typed in where it is? (Picks it, and says whether.)
  const canEditText = async (key: string): Promise<boolean> => {
    const start = startOf(key);
    if (start === null) return false;
    select(start);
    const code = await readCode(component.file);
    return code !== null && !!(await analyze(component.file, code, start))?.text;
  };
  const commitText = (key: string, value: string) => attempt(async () => {
    const start = startOf(key);
    if (start !== null) await editInFile(fileRef, (code) => setText(component.file, code, start, value));
  });

  return { applyGesture, act, onKey, canPaste: () => clipboard.current !== null, insertItem, insertAtKey, moveTo, canEditText, commitText };
}
