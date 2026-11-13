import type { GitHost, RepoReader } from "./github";
import { readerSource } from "./repo-scan/source";
import type { RepoAnalysis } from "./repo-scan/types";
import { useGitStore, repoSlug, type GitConnection } from "../store/git";
import { useLibraryStore } from "../store/library";

// Reads a project's repository: the scan, and the components found in it brought into the library. This is what happens
// when a project is first opened, so there is nothing to press before a repository is ready to work in.
export async function readRepository(host: GitHost & RepoReader, connection: GitConnection, branch = connection.defaultBranch): Promise<RepoAnalysis> {
  const { scanRepository } = await import("./repo-scan");
  const analysis = await scanRepository(readerSource(host, branch), { repo: repoSlug(connection), ref: branch });
  useGitStore.getState().setAnalysis(analysis);
  useLibraryStore.getState().importComponents(analysis);
  return analysis;
}
