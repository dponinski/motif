import type { GitHost } from "./github";

// A repository with no commits has nothing to branch from, so the very first thing that goes in is committed straight to
// its default branch. It is a README only: nothing else is created for the person, who builds the rest themselves.
export const FIRST_COMMIT_PATH = "README.md";

export const firstReadme = (repo: string) => `# ${repo}\n\nA design system, built with Motif.\n`;

export async function createFirstCommit(host: Pick<GitHost, "putFile">, repo: string): Promise<{ commitUrl: string }> {
  const { commitUrl } = await host.putFile({ path: FIRST_COMMIT_PATH, text: firstReadme(repo), message: "Initial commit" });
  return { commitUrl };
}
