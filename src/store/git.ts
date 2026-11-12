import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RepoAnalysis } from "@/lib/repo-scan/types";
import type { TokenLink } from "@/lib/token-sync/flow";

export interface GitConnection {
  owner: string;
  repo: string;
  // Personal access token, or "" to read a public repository without one. Only ever sent to the git host.
  token: string;
  // Folder inside the repo that holds design files.
  dir: string;
  defaultBranch: string;
}

interface GitStore {
  connection: GitConnection | null;
  // The most recent repository scan, kept so a reload does not lose it.
  analysis: RepoAnalysis | null;
  // Which Motif token set is synced with which repository, and where the last sync left off.
  tokenLink: TokenLink | null;
  connect: (connection: GitConnection) => void;
  disconnect: () => void;
  setAnalysis: (analysis: RepoAnalysis | null) => void;
  setTokenLink: (link: TokenLink | null) => void;
}

export const useGitStore = create<GitStore>()(
  persist(
    (set) => ({
      connection: null,
      analysis: null,
      tokenLink: null,
      connect: (connection) => set({ connection }),
      disconnect: () => set({ connection: null, analysis: null }),
      setAnalysis: (analysis) => set({ analysis }),
      setTokenLink: (tokenLink) => set({ tokenLink }),
    }),
    { name: "motif-git" }
  )
);

export const repoSlug = (c: GitConnection) => `${c.owner}/${c.repo}`;
