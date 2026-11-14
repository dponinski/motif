import { currentText, useEditStore } from "@/store/edit";
import type { RepoReader } from "@/lib/github";
import type { EditResult } from "@/lib/edit/element";
import { insertElement, moveElementTo, type InsertPosition } from "@/lib/edit/insert";
import type { ImportSpec } from "@/lib/edit/imports";
import { recordChange } from "./useEditRunner";

// Edits to the open component's file that don't start from the selection: the palette puts an element somewhere, a drag moves one
// to a place. Each reads the file as it is now (with the editor's changes), makes the edit and records it as one step, selecting
// the element that was added or moved.

export interface FileRef { file: string; branch: string; reader: Pick<RepoReader, "readText"> }

async function edit(ref: FileRef, op: (code: string) => Promise<EditResult | null>): Promise<boolean> {
  const code = currentText(useEditStore.getState(), ref.file) ?? (await ref.reader.readText(ref.file, ref.branch));
  if (code === null) throw new Error(`Couldn't read ${ref.file}`);
  const result = await op(code);
  if (!result || result.code === code) return false;
  await recordChange(ref.file, code, result.code, result.selection === null ? null : { path: ref.file, start: result.selection }, result.summary);
  return true;
}

export const insertInFile = (ref: FileRef, target: number, position: InsertPosition, jsx: string, imp?: ImportSpec) =>
  edit(ref, (code) => insertElement(ref.file, code, target, position, jsx, imp));

export const moveInFile = (ref: FileRef, start: number, target: number, position: InsertPosition) =>
  edit(ref, (code) => moveElementTo(ref.file, code, start, target, position));

export const editInFile = edit;
