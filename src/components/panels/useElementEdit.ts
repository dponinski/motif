"use client";

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { gitBlobSha } from "@/lib/github";
import { recordChange } from "./useEditRunner";
import { BREAKPOINT_WIDTH, GROUPS, readGroup, type ClassGroup } from "@/lib/edit/classes";
import { analyze, setGroup, type EditResult, type ElementInfo } from "@/lib/edit/element";
import { readDeclarations } from "@/lib/edit/css";
import { CSS_GROUPS, cssNames, readCssGroup, type CssGroup } from "@/lib/edit/css-groups";
import { setCssGroup, stylesheetOf, viewOf } from "@/lib/edit/css-element";
import type { LibraryComponent } from "@/lib/preview/library";
import { activeTheme } from "@/lib/edit/tokens";
import { useTokenIndex } from "@/components/stage/preview-core";
import { readerFor } from "@/components/stage/reader";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { NEW_FILE, useEditStore, currentText, type Base } from "@/store/edit";
import type { GitConnection } from "@/store/git";
import type { LibrarySource } from "@/store/library";
import { usePreviewStore } from "@/store/preview";

// Shown for every element; anything else that is set on the element appears as well, and the rest is under "Add".
export const SHOWN: Record<string, string[]> = {
  layout: ["display", "direction", "gap", "items", "justify"],
  spacing: ["p", "px", "py", "m"],
  size: ["w", "h"],
  type: ["text-size", "font-weight", "text-color"],
  fill: ["bg", "border-width", "border-color", "radius", "shadow"],
};

export const STATE_IDS = ["hover:", "focus:", "active:", "disabled:"];
export const SCOPE_IDS = ["dark:", "sm:", "md:", "lg:", "xl:"];

// Reads the picked element and changes it: what the inspector's controls do, and what a drag on the canvas does. Both go through
// `change`, so the Tailwind classes and a stylesheet are edited the same way for either, as one step to undo.
export function useElementEdit(component: LibraryComponent, source: LibrarySource, connection: GitConnection) {
  const host = useGitHost(connection);
  const reader = useMemo(() => readerFor(source, host), [source, host]);
  const selection = useEditStore((s) => s.selection);
  const revision = useEditStore((s) => s.revision);
  const overrides = usePreviewStore((s) => s.values[component.id]);
  // The repository's tokens: what the controls offer, and what decides whether `text-display` is a size or a color.
  const index = useTokenIndex(source.repo);
  const names = index.names;
  const dark = usePreviewStore((s) => s.dark);
  const theme = activeTheme(index, dark);

  const [info, setInfo] = useState<ElementInfo | null>(null);
  // For a component whose styles are in a stylesheet: that file, as it is now, and the component's own text.
  const [sheet, setSheet] = useState<{ path: string; text: string; exists: boolean; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which state the controls edit: the plain classes, or the ones that apply on hover, in dark mode, at md and up. It is in
  // the store so that what is done on the canvas (dragging a handle) edits the same one the controls do.
  const modifier = usePreviewStore((s) => s.editModifier);
  const setModifier = usePreviewStore((s) => s.setEditModifier);
  const { setDark, setWidth } = usePreviewStore(useShallow((s) => ({ setDark: s.setDark, setWidth: s.setWidth })));
  const chooseState = (id: string) => {
    // The preview is put where the state can be seen: dark theme, or a width the breakpoint applies at.
    if (id === "dark:") setDark(true);
    else if (modifier === "dark:") setDark(false);
    if (BREAKPOINT_WIDTH[id]) setWidth(BREAKPOINT_WIDTH[id]);
    else if (BREAKPOINT_WIDTH[modifier]) setWidth(null);
    setModifier(id);
  };

  // The state of an element (hover, focus) and where a style applies (dark, a width) are two choices, but one modifier: they
  // are edited one at a time, so choosing one sets the other back to its plain value.
  const stateValue = STATE_IDS.includes(modifier) ? modifier : "";
  const scopeValue = SCOPE_IDS.includes(modifier) ? modifier : "";
  const chooseStateOnly = (id: string) => { if (id === "" && SCOPE_IDS.includes(modifier)) return; chooseState(id); };
  const chooseScope = (id: string) => { if (id === "" && STATE_IDS.includes(modifier)) return; chooseState(id); };

  // What variant choices are showing, so the classes of the variant on screen are the ones edited.
  const values = useMemo(
    () => Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => ["string", "boolean", "number"].includes(typeof v)).map(([k, v]) => [k, String(v)])),
    [overrides]
  );

  const read = async (path: string): Promise<string | null> => currentText(useEditStore.getState(), path) ?? (await reader.readText(path, source.branch));

  useEffect(() => {
    let stale = false;
    setError(null);
    if (!selection) { setInfo(null); setSheet(null); return; }
    (async () => {
      try {
        const code = await read(selection.path);
        const next = code === null ? null : await analyze(selection.path, code, selection.start, values);
        // Styles that are in a stylesheet next to the component are edited there. (With Tailwind v4 the classes are.)
        let nextSheet: typeof sheet = null;
        const sheetPath = code !== null && source.tailwindVersion === null ? stylesheetOf(selection.path, code) : null;
        if (code !== null && sheetPath) {
          const text = await read(sheetPath);
          nextSheet = { path: sheetPath, text: text ?? "", exists: text !== null, code };
        }
        if (!stale) { setInfo(next); setSheet(nextSheet); }
      } catch (err) {
        if (!stale) { setInfo(null); setError(errorMessage(err)); }
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, revision, values, reader]);

  const run = async (op: (code: string, start: number) => Promise<EditResult | null>) => {
    if (!selection) return;
    setError(null);
    try {
      const code = await read(selection.path);
      if (code === null) throw new Error(`Couldn't read ${selection.path}`);
      const result = await op(code, selection.start);
      if (!result || result.code === code) return;
      await recordChange(selection.path, code, result.code, result.selection === null ? null : { path: selection.path, start: result.selection }, result.summary);
    } catch (err) {
      setError(errorMessage(err));
    }
  };


  // What is known once an element is picked and has been read.
  const derived = selection && info ? (() => {
    const editable = info.className !== "dynamic";
    const classes = info.classes;
    // The groups the controls show, and where their values are: the element's classes, or the rule for its class in the stylesheet.
    const css = sheet !== null;
    const groups: ClassGroup[] = css ? CSS_GROUPS : GROUPS;
    const cssTokens = css ? cssNames(index) : null;
    const view = sheet ? viewOf(info, sheet.code, sheet.text) : null;
    const valueOf = (g: ClassGroup, m: string): string | null => {
      if (!sheet) return readGroup(classes, g, m, names);
      if (!view?.cls) return null;
      try {
        return readCssGroup(readDeclarations(sheet.text, view.cls, m), g as CssGroup, cssTokens!);
      } catch {
        return null;
      }
    };
    const groupsFor = (section: string) => {
      const set = groups.filter((g) => g.section === section && valueOf(g, modifier) !== null).map((g) => g.id);
      const shown = [...new Set([...SHOWN[section], ...set])];
      const ordered = groups.filter((g) => g.section === section && shown.includes(g.id));
      return { ordered, rest: groups.filter((g) => g.section === section && !shown.includes(g.id)) };
    };
    // A change to the stylesheet, and to the component when the element gets a class of its own, as one step.
    const runCss = async (g: ClassGroup, value: string | null) => {
      if (!sheet) return;
      setError(null);
      try {
        const result = await setCssGroup({ path: selection.path, code: sheet.code, start: selection.start, stylesheet: sheet.path, css: sheet.text, groupId: g.id, value, modifier, index });
        if (!result || Object.keys(result.texts).length === 0) return;
        const store = useEditStore.getState();
        const bases: Record<string, Base> = {};
        for (const path of Object.keys(result.texts)) {
          if (store.bases[path]) continue;
          const text = path === sheet.path ? (sheet.exists ? sheet.text : null) : sheet.code;
          bases[path] = text === null ? NEW_FILE : { text, sha: await gitBlobSha(text) };
        }
        store.changeMany(result.texts, { path: selection.path, start: result.selection }, result.summary, bases);
      } catch (err) {
        setError(errorMessage(err));
      }
    };
    const change = (g: ClassGroup, value: string | null) => (css ? runCss(g, value) : run((code, start) => setGroup(selection.path, code, start, g.id, value, values, modifier, names)));
    // Several groups at once (a corner dragged is a width and a height): one step to undo for classes. A stylesheet's rule and
    // the component are written together by each `runCss`, so those go one after another.
    const changeMany = async (list: { group: ClassGroup; value: string | null }[]) => {
      if (list.length === 0) return;
      if (list.length === 1) return change(list[0].group, list[0].value);
      if (css) { for (const { group, value } of list) await runCss(group, value); return; }
      await run(async (code, start) => {
        let text = code, at = start, last: EditResult | null = null;
        const summaries: string[] = [];
        for (const { group, value } of list) {
          const result = await setGroup(selection.path, text, at, group.id, value, values, modifier, names);
          if (!result) continue;
          text = result.code;
          at = result.selection ?? at;
          last = result;
          summaries.push(result.summary);
        }
        return last ? { ...last, code: text, summary: summaries.join(", ") } : null;
      });
    };
    return { editable, classes, css, groups, cssTokens, view, valueOf, groupsFor, change, changeMany };
  })() : null;

  return { selection, info, sheet, error, modifier, chooseState, stateValue, scopeValue, chooseStateOnly, chooseScope, values, names, index, theme, reader, run, derived };
}
