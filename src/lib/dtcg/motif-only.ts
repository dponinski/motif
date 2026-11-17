import type { RepoToken } from "../repo-scan/types";
import { COMPOSITION_NAMESPACE, leafOf, pathOf, placeOf, themeKey, THEME_NAMESPACES } from "./names";
import { parseLengthPx } from "../token-sync/values";
import type { StoredTokenData } from "../tokens/model";
import { ALL_THEMES } from "../tokens/model";

// The tokens Motif has that the repository's stylesheets don't (yet), as the inspector's pickers need to see them when the tokens are design
// tokens files: a token is usable the moment it is made. Each is named by the variable it makes (`color.brand` is `--color-brand`), which
// is also its name for Tailwind when it is in one of its namespaces, so `bg-brand` is the class.

const KEY = (themeName: string, repoKey?: string) => repoKey ?? themeKey(themeName);

export function motifOnlyFromFiles(model: StoredTokenData, have: Set<string>, tailwind: 3 | 4 | null): RepoToken[] {
  const out: RepoToken[] = [];
  const keysOf = (setId: string) => (model.sets.find((s) => s.id === setId)?.themes ?? []).map((t) => ({ id: t.id, key: KEY(t.name, t.repoKey) }));

  const add = (path: string[], kind: RepoToken["kind"], values: Record<string, string>) => {
    const name = path.join("-");
    if (have.has(name) || Object.keys(values).length === 0) return;
    // Tailwind makes classes of the variables in its namespaces.
    const named = tailwind === 4 && path.length > 1 && THEME_NAMESPACES.has(path[0]);
    out.push({ name, kind, values, locations: {}, tailwind: named ? name : null, file: "Motif", line: 0 });
  };

  for (const t of model.tokens) {
    const path = placeOf(t.repoName) ?? pathOf(t.type, t.use, t.name);
    if (t.type === "color") {
      const values: Record<string, string> = {};
      for (const { id, key } of keysOf(t.setId)) { const v = t.values[id]; if (v !== undefined) values[key] = v; }
      add(path, "color", values);
    } else if (t.type === "number" && (t.use === "radius" || t.use === "spacing")) {
      const px = parseLengthPx(`${t.values[ALL_THEMES] ?? Object.values(t.values)[0] ?? ""}${t.unit ?? ""}`);
      if (px !== null) add(path, t.use, { default: `${px}px` });
    }
  }
  for (const c of model.compositions) {
    if (c.kind !== "shadow") continue;
    const slot = (n: string) => c.slots.find((s) => s.name === n)?.value ?? "0";
    const text = c.raw ?? `${c.inset ? "inset " : ""}${slot("x")}px ${slot("y")}px ${slot("blur")}px ${slot("spread")}px ${slot("color") === "0" ? "#00000000" : slot("color")}`;
    add(placeOf(c.repoName) ?? [COMPOSITION_NAMESPACE.shadow, leafOf(c.name, COMPOSITION_NAMESPACE.shadow)], "shadow", { default: text });
  }
  return out;
}
