"use client";

import { useCallback, useMemo } from "react";
import { elementTree } from "@/lib/edit/tree";
import { activeTheme } from "@/lib/edit/tokens";
import { flattenTree, type ElementRef } from "@/lib/ai/proposal";
import { useTokenIndex } from "@/components/stage/preview-core";
import { readerFor } from "@/components/stage/reader";
import { useGitHost } from "@/components/git/hooks";
import { currentText, useEditStore } from "@/store/edit";
import { useGitStore } from "@/store/git";
import { activeComponent, useLibraryStore } from "@/store/library";
import { usePreviewStore } from "@/store/preview";

// What the assistant needs from the editor: the open component, its file as it is now (with the changes made in
// the editor), the repository's tokens, and the variant choices that are showing.
export function useChatSource() {
  const component = useLibraryStore(activeComponent);
  const source = useLibraryStore((s) => s.source);
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? { owner: "", repo: "", token: "", defaultBranch: "" });
  const reader = useMemo(() => (source ? readerFor(source, host) : null), [source, host]);
  const index = useTokenIndex(source?.repo ?? null);
  const dark = usePreviewStore((s) => s.dark);
  const overrides = usePreviewStore((s) => (component ? s.values[component.id] : undefined));
  const theme = activeTheme(index, dark);
  const names = index.names;
  const scope = source ? `${source.repo}@${source.branch}` : "";

  const values = useMemo(
    () => Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => ["string", "boolean", "number"].includes(typeof v)).map(([k, v]) => [k, String(v)])),
    [overrides]
  );

  const readCode = useCallback(
    async (path: string): Promise<string | null> => {
      if (!reader || !source) return null;
      return currentText(useEditStore.getState(), path) ?? (await reader.readText(path, source.branch));
    },
    [reader, source]
  );

  // The elements of the open component as its file is now.
  const elementsOf = useCallback(
    async (code: string): Promise<ElementRef[]> =>
      component ? flattenTree(await elementTree(component.file, code, component.exported === "default" ? "default" : component.name)) : [],
    [component]
  );

  return { component, source, scope, index, theme, names, values, readCode, elementsOf };
}
