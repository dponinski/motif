import type { GitHost, RepoReader } from "./github";
import { readerSource } from "./repo-scan/source";
import type { RepoAnalysis } from "./repo-scan/types";
import { useGitStore, repoSlug, type GitConnection } from "../store/git";
import { useLibraryStore } from "../store/library";

// Scans one branch of a repository: what every place that reads a repository does first.
export async function scanBranch(host: RepoReader, repo: string, branch: string): Promise<RepoAnalysis> {
  const { scanRepository } = await import("./repo-scan");
  return scanRepository(readerSource(host, branch), { repo, ref: branch });
}

// Reads a project's repository: the scan, and the components found in it brought into the library. This is what happens
// when a project is first opened, so there is nothing to press before a repository is ready to work in.
export async function readRepository(host: GitHost & RepoReader, connection: GitConnection, branch = connection.defaultBranch): Promise<RepoAnalysis> {
  const analysis = await scanBranch(host, repoSlug(connection), branch);
  useGitStore.getState().setAnalysis(analysis);
  useGitStore.getState().setPulledSha(await host.getRef(branch).catch(() => null));
  useLibraryStore.getState().importComponents(analysis);
  return analysis;
}
