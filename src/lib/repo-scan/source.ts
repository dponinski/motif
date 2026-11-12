import type { RepoReader } from "../github";
import type { RepoSource } from "./types";

export const readerSource = (reader: RepoReader, ref: string): RepoSource => ({
  listFiles: () => reader.listTree(ref),
  readText: (path) => reader.readText(path, ref),
});

export const memorySource = (files: Record<string, string>): RepoSource => ({
  listFiles: async () => ({ paths: Object.keys(files), truncated: false }),
  readText: async (path) => files[path] ?? null,
});

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const IGNORED_DIRS = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.git|\.turbo|\.cache|storybook-static)\//;

export const isIgnoredPath = (path: string) => IGNORED_DIRS.test(path);

// Demo apps, stories and tests render components; they are not part of the design system.
const NON_LIBRARY = /(^|\/)(demo|demos|example|examples|stories|story|playground|__tests__|__mocks__|e2e|cypress|docs?)\/|\.(stories|story|test|spec)\.[jt]sx?$/;

export const isLibraryPath = (path: string) => !isIgnoredPath(path) && !NON_LIBRARY.test(path);
