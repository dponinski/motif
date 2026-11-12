import { parseModule, walk } from "../repo-scan/ast";
import { applyEdits, type Edit } from "./patch";

// A preview can only tell Motif which element was clicked if the elements say where they came from, so every
// plain HTML element in a module gets `data-motif="path|offset"`, where the offset is where it starts in the
// source. The attribute is added to the text that is compiled for the preview, never to the file that is edited.
export const MOTIF_ATTR = "data-motif";

export async function instrument(path: string, code: string): Promise<string> {
  if (!/\.[jt]sx$|\.js$/.test(path)) return code;
  const ast = await parseModule(code, path);
  const edits: Edit[] = [];
  walk(ast.program, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const name = node.name as { type: string; name?: string; end: number };
    if (name.type === "JSXIdentifier" && /^[a-z]/.test(name.name ?? "")) {
      edits.push({ start: name.end, end: name.end, text: ` ${MOTIF_ATTR}="${path}|${node.start as number}"` });
    }
  });
  return applyEdits(code, edits).code;
}

export function parseMotifKey(key: string): { path: string; start: number } | null {
  const i = key.lastIndexOf("|");
  if (i < 1) return null;
  const start = Number(key.slice(i + 1));
  return Number.isInteger(start) ? { path: key.slice(0, i), start } : null;
}
