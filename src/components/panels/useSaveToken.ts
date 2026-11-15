import { useCallback } from "react";
import { classValueOf, freeName, rawValue, type MakeKind } from "@/lib/edit/motif-tokens";
import { statusOf, suggest, type TokenIndex } from "@/lib/edit/tokens";
import type { ClassGroup } from "@/lib/edit/classes";
import { cssName } from "@/lib/token-sync/doc";
import { useDesignSystemStore } from "@/store/design-system";
import { useGitStore } from "@/store/git";
import { editTokens } from "@/store/token-history";
import type { SaveToken } from "./TokenField";

const MAKE: Partial<Record<string, MakeKind>> = { color: "color", radius: "radius", spacing: "spacing" };

// What it would take to make a value written out on an element (`bg-[#1d4ed8]`, `rounded-[10px]`) a token: a name, a place in the set
// the repository's tokens are linked to, and then the element uses the token. Null when the value is one that is already a token or
// a step of the scale, or not one that can be.
export function useSaveToken(repo: string, index: TokenIndex): (group: ClassGroup, value: string | null, apply: (value: string) => void) => SaveToken | null {
  const link = useGitStore((s) => s.tokenLink);
  const linked = link && link.repo === repo ? link : null;
  return useCallback((group, value, apply) => {
    const kind = group.role ? MAKE[group.role] : undefined;
    if (!kind || value === null || statusOf(group.role!, value, index) !== "raw") return null;
    // The token that is the same already is what to use, not another one.
    if (suggest(group, value, index)?.exact) return null;
    const raw = rawValue(kind, value);
    if (!raw) return null;
    const plan = index.make?.[kind] ?? { reason: "This repository's tokens can't be read" };
    const state = useDesignSystemStore.getState();
    const setId = linked?.setId;
    const list = kind === "color" ? state.colors : kind === "radius" ? state.radii : state.spacing;
    const takenName = (full: string) =>
      index.byRole[kind].some((c) => c.name === full || c.value === full) || list.some((t) => t.setId === setId && ((t as { repoName?: string }).repoName ?? cssName(t.name)) === full);
    const prefix = "prefix" in plan ? plan.prefix : "";
    return {
      plan: !linked ? { reason: "Link this repository's tokens first (Repo sync), so the token has a set to go in" } : plan,
      kind,
      prefix,
      value: raw.value,
      suggested: freeName((n) => takenName(prefix + n)),
      taken: (n) => takenName(prefix + cssName(n)),
      save: (name) => {
        if (!linked || "reason" in plan) return;
        const full = prefix + cssName(name);
        editTokens(() => {
          const s = useDesignSystemStore.getState();
          if (kind === "color") s.addColor({ name: full, value: raw.value, group: "base", setId: linked.setId });
          else if (kind === "radius") s.addRadius({ name: full, value: raw.px!, group: "base", setId: linked.setId });
          else s.addSpacing({ name: full, value: raw.px!, group: "base", setId: linked.setId });
        });
        const used = classValueOf(full, { prefix });
        apply(raw.opacity && raw.opacity !== "100" ? `${used}/${raw.opacity}` : used);
      },
    };
  }, [index, linked]);
}
