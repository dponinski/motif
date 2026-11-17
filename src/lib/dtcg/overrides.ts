import type { StoredTokenData } from "../tokens/model";
import { cssBlocks, type CssBlock } from "./generate";
import { writeOptionsOf, type DtcgLink } from "./sync";
import type { DtcgConfig, DtcgFiles } from "./types";
import { writeDtcg } from "./write";

// What Motif has changed in its tokens since the last sync, as the CSS a preview needs to show it: the variables whose value is not what the
// repository's files come to, each under the selector of its theme (the base ones under `:root`, where Tailwind's `@theme` variables are
// too), and the new variables Tailwind should make classes of (a token made here that the repository doesn't have yet).

export interface DtcgOverrides {
  css: string;
  // The variables that changed or are new, without the `--`.
  changed: string[];
  // `@theme` with the new variables of the namespaces Tailwind makes classes from, or "".
  theme: string;
}

const NONE: DtcgOverrides = { css: "", changed: [], theme: "" };

const selectorsOf = (base: DtcgFiles): Record<string, string> | undefined => {
  const path = Object.keys(base).find((f) => f.endsWith("tokens.config.json"));
  try { return path ? (JSON.parse(base[path]) as DtcgConfig).selectors : undefined; } catch { return undefined; }
};

// A block's variables by where they are: `@theme` and `:root` are the same place for a preview.
const place = (b: CssBlock) => (b.selector === "@theme" ? ":root" : b.selector);

function variables(blocks: CssBlock[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of blocks) for (const [name, value] of b.lines) out.set(`${place(b)}\0${name}`, value);
  return out;
}

export function dtcgOverrides(link: Pick<DtcgLink, "dir" | "files" | "output" | "tailwind" | "base">, model: StoredTokenData): DtcgOverrides {
  const mine = writeDtcg(model, { ...writeOptionsOf(link), selectors: selectorsOf(link.base) }).files;
  let was: CssBlock[] = [];
  try { was = Object.keys(link.base).length ? cssBlocks(link.base) : []; } catch { was = []; }
  let now: CssBlock[];
  try { now = cssBlocks(mine); } catch { return NONE; }

  const before = variables(was);
  const known = new Set([...before.keys()].map((k) => k.split("\0")[1]));
  const changed = new Set<string>();
  const bySelector = new Map<string, string[]>();
  const fresh: string[] = [];
  for (const b of now) {
    for (const [name, value] of b.lines) {
      const key = `${place(b)}\0${name}`;
      if (before.get(key) === value) continue;
      changed.add(name.slice(2));
      bySelector.set(place(b), [...(bySelector.get(place(b)) ?? []), `  ${name}: ${value};`]);
      if (b.selector === "@theme" && !known.has(name)) fresh.push(`  ${name}: ${value};`);
    }
  }
  const order = [...bySelector.keys()].sort((a, b) => Number(b === ":root") - Number(a === ":root"));
  // The base theme's rule must not outrank the others' (a repository's `.dark` beats its `:root` by coming later), so it only applies where no
  // other theme does.
  const others = Object.values(selectorsOf(mine) ?? {});
  const scoped = (selector: string) => (selector === ":root"
    ? `html:root${others.length ? `:not(${others.join(", ")})` : ""}`
    : selector.split(",").map((s) => `html${s.trim()}`).join(", "));
  return {
    css: order.map((selector) => `${scoped(selector)} {\n${bySelector.get(selector)!.join("\n")}\n}`).join("\n"),
    changed: [...changed],
    theme: link.tailwind && fresh.length ? `@theme {\n${fresh.join("\n")}\n}` : "",
  };
}
