import type { RepoReader } from "../github";
import { isIgnoredPath, mapLimit } from "../repo-scan/source";
import type { RepoToken } from "../repo-scan/types";
import { namesFor, planRename, type RenamePlan } from "./rename";

// Reading the code a rename has to change. Wider than the scan that counts where a token is used: every file that can name a token
// counts here, demos, stories, tests and docs included, because a reference that is left behind is a broken build.

export const RENAME_FILE_LIMIT = 800;
const MAX_BYTES = 600_000;
const CODE = /\.(css|tsx?|jsx?|mjs|cjs|mdx|html?)$/i;
const SKIP = /\.d\.ts$|\.min\.(js|css)$|(^|\/)(package-lock|pnpm-lock)\./;

export const isCodePath = (path: string) => CODE.test(path) && !SKIP.test(path) && !isIgnoredPath(path);

// The files of the repository (as it will be with the editor's changes in it, if the reader is an overlay) that can name a token.
export async function readCodeFiles(reader: RepoReader, branch: string, options: { onProgress?: (done: number, total: number) => void; limit?: number } = {}): Promise<{ files: Record<string, string> } | { refused: string }> {
  const tree = await reader.listTree(branch);
  const paths = tree.paths.filter(isCodePath);
  const limit = options.limit ?? RENAME_FILE_LIMIT;
  if (tree.truncated) return { refused: "GitHub returned only part of this repository's file list, so not every place could be found" };
  if (paths.length > limit) return { refused: `This repository has ${paths.length} source files, more than the ${limit} Motif reads for a rename` };
  const files: Record<string, string> = {};
  let done = 0;
  await mapLimit(paths, 8, async (path) => {
    const text = await reader.readText(path, branch);
    if (text !== null && text.length <= MAX_BYTES) files[path] = text;
    options.onProgress?.(++done, paths.length);
  });
  return { files };
}

// What renaming the token to `to` would change in the repository, or why it can't be.
export async function findRename(input: {
  reader: RepoReader;
  branch: string;
  token: RepoToken;
  to: string;
  tokens: RepoToken[];
  onProgress?: (done: number, total: number) => void;
}): Promise<RenamePlan | { refused: string }> {
  // The name is checked before any file is read.
  const names = namesFor(input.token, input.to, input.tokens);
  if (typeof names === "string") return { refused: names };
  const read = await readCodeFiles(input.reader, input.branch, { onProgress: input.onProgress });
  if ("refused" in read) return read;
  return planRename({ token: input.token, to: input.to, tokens: input.tokens, files: read.files });
}
