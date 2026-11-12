import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RepoAnalysis } from "@/lib/repo-scan/types";

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
  connect: (connection: GitConnection) => void;
  disconnect: () => void;
  setAnalysis: (analysis: RepoAnalysis | null) => void;
}

export const useGitStore = create<GitStore>()(
  persist(
    (set) => ({
      connection: null,
      analysis: null,
      connect: (connection) => set({ connection }),
      disconnect: () => set({ connection: null, analysis: null }),
      setAnalysis: (analysis) => set({ analysis }),
    }),
    { name: "motif-git" }
  )
);

export const repoSlug = (c: GitConnection) => `${c.owner}/${c.repo}`;
