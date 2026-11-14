import { gitBlobSha, type GitHost, type RepoReader } from "../github";
import type { RepoSource } from "../repo-scan/types";
import type { Base } from "../../store/edit";

// The repository as it will be once the editor's changes are in it: the default branch's files, with the texts the
// editor holds put over them, and the files made here added. Everything that plans a change to the repository (tokens, the
// Tailwind add-on, a new component's barrel) reads through this, so a second step builds on the first instead of
// replacing it. What the repository really has (for staleness, and after a merge) is read from the host directly.

export interface Overlay {
  // The files that differ from the repository, as they are now.
  texts: Record<string, string>;
  // Which of them were made here (no sha), and what the rest were.
  bases: Record<string, Base>;
}

// The overlay of the editor's current state: only files that are really changed count.
export function overlayOf(state: { history: { texts: Record<string, string> }[]; index: number; bases: Record<string, Base> }): Overlay {
  const all = state.history[state.index].texts;
  const texts: Record<string, string> = {};
  const bases: Record<string, Base> = {};
  for (const [path, text] of Object.entries(all)) {
    const base = state.bases[path];
    if (base && text !== base.text) { texts[path] = text; bases[path] = base; }
  }
  return { texts, bases };
}

export const createdPaths = (overlay: Overlay) => Object.keys(overlay.texts).filter((p) => overlay.bases[p].sha === null);

// The repository's paths and the files made here, once each.
export const overlayPaths = (paths: string[], overlay: Overlay) => [...new Set([...paths, ...createdPaths(overlay)])];

export type OverlayReader = RepoReader & Pick<GitHost, "getFile">;

export function overlayReader(host: RepoReader & Partial<Pick<GitHost, "getFile">>, overlay: Overlay): OverlayReader {
  return {
    async listTree(ref) {
      const tree = await host.listTree(ref);
      return { ...tree, paths: overlayPaths(tree.paths, overlay) };
    },
    async readText(path, ref) {
      return path in overlay.texts ? overlay.texts[path] : host.readText(path, ref);
    },
    async getFile(path, branch) {
      // What the file's sha was on the repository is what a write has to be guarded with; a file made here has none.
      if (path in overlay.texts) return { text: overlay.texts[path], sha: overlay.bases[path].sha ?? "" };
      if (host.getFile) return host.getFile(path, branch);
      // A reader that only reads text: the sha is the one git would give the text.
      const text = await host.readText(path, branch);
      return text === null ? null : { text, sha: await gitBlobSha(text) };
    },
  };
}

export const overlaySource = (reader: OverlayReader, ref: string): RepoSource => ({
  listFiles: () => reader.listTree(ref),
  readText: (path) => reader.readText(path, ref),
});
