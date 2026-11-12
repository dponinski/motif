import { create } from "zustand";
import type { RepoAnalysis } from "@/lib/repo-scan/types";
import type { TokenLink } from "@/lib/token-sync/flow";

export interface GitConnection {
  owner: string;
  repo: string;
  // Personal access token, or "" to read a public repository without one. Only ever sent to the git host.
  token: string;
  defaultBranch: string;
}

// The repository of the project that is open. It is held in memory and kept by the project (store/projects.ts).
export interface RepoState {
  connection: GitConnection | null;
  // The most recent repository scan.
  analysis: RepoAnalysis | null;
  // Which Motif token set is synced with which repository, and where the last sync left off.
  tokenLink: TokenLink | null;
}

interface GitStore extends RepoState {
  connect: (connection: GitConnection) => void;
  setAnalysis: (analysis: RepoAnalysis | null) => void;
  setTokenLink: (link: TokenLink | null) => void;
  load: (state: RepoState) => void;
}

export const useGitStore = create<GitStore>()((set) => ({
  connection: null,
  analysis: null,
  tokenLink: null,
  connect: (connection) => set({ connection }),
  setAnalysis: (analysis) => set({ analysis }),
  setTokenLink: (tokenLink) => set({ tokenLink }),
  load: ({ connection, analysis, tokenLink }) => set({ connection, analysis, tokenLink }),
}));

export const repoSlug = (c: Pick<GitConnection, "owner" | "repo">) => `${c.owner}/${c.repo}`;
