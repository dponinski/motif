import { EXT } from "./types";

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// The tokens of a design tokens file, flat: each with its path, its type (a group's `$type` is the type of what is in it), its value and
// Motif's extension.
export interface Flat {
  path: string[];
  type: string | undefined;
  value: unknown;
  ext: Obj;
  file: string;
  // A group that is a composition of your own: the tokens in it.
  children?: Flat[];
}

export function walk(node: Obj, path: string[], inherited: string | undefined, file: string, out: Flat[]) {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith("$") || !isObject(val)) continue;
    const ext = isObject(val.$extensions) && isObject(val.$extensions[EXT]) ? (val.$extensions[EXT] as Obj) : {};
    const type = typeof val.$type === "string" ? val.$type : inherited;
    if ("$value" in val) { out.push({ path: [...path, key], type, value: val.$value, ext, file }); continue; }
    if (ext.composition === "custom") {
      const children: Flat[] = [];
      walk(val, [...path, key], type, file, children);
      out.push({ path: [...path, key], type: "composition", value: undefined, ext, file, children });
      continue;
    }
    walk(val, [...path, key], type, file, out);
  }
}

