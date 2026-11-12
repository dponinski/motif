import type { RepoReader } from "@/lib/github";
import { cachedReader } from "@/lib/preview/graph";
import type { LibrarySource } from "@/store/library";

// One reader per import, so the stage, the inspector and the editor all share what has been read.
const readers = new Map<string, RepoReader>();

export const versionOf = (source: LibrarySource) => `${source.repo}@${source.branch}#${source.importedAt}`;

export function readerFor(source: LibrarySource, host: RepoReader): RepoReader {
  const key = versionOf(source);
  if (!readers.has(key)) readers.set(key, cachedReader(host));
  return readers.get(key)!;
}
