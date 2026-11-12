import type { RepoComponent } from "../repo-scan/types";

// A repository component as Motif keeps it: the scanner's description of it, under a stable id.
export interface LibraryComponent extends RepoComponent {
  id: string;
}

export const componentId = (c: { file: string; name: string }) => `${c.file}::${c.name}`;

// Components that are part of the design system: the public ones, or all of them when the repository has no entry file to tell by.
export const importable = (components: RepoComponent[]) => components.filter((c) => c.public !== false);

export const toLibrary = (components: RepoComponent[]): LibraryComponent[] =>
  importable(components).map((c) => ({ ...c, id: componentId(c) }));

export interface UpdateSummary {
  added: string[];
  changed: string[];
  removed: string[];
}

// Line numbers move on every edit and say nothing about how a component behaves, so they don't count as a change.
const signature = ({ line: _line, id: _id, ...rest }: LibraryComponent) => JSON.stringify(rest);

export function diffLibrary(previous: LibraryComponent[], next: LibraryComponent[]): UpdateSummary {
  const before = new Map(previous.map((c) => [c.id, c]));
  const after = new Map(next.map((c) => [c.id, c]));
  return {
    added: next.filter((c) => !before.has(c.id)).map((c) => c.name),
    changed: next.filter((c) => before.has(c.id) && signature(before.get(c.id)!) !== signature(c)).map((c) => c.name),
    removed: previous.filter((c) => !after.has(c.id)).map((c) => c.name),
  };
}

export function describeUpdate(s: UpdateSummary): string {
  const parts = [s.added.length && `${s.added.length} new`, s.changed.length && `${s.changed.length} changed`, s.removed.length && `${s.removed.length} removed`].filter(Boolean);
  return parts.length ? parts.join(", ") : "Up to date";
}
