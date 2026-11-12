import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface GitConnection {
  owner: string;
  repo: string;
  // Personal access token. Kept in its own localStorage entry and only ever sent to the git host.
  token: string;
  // Folder inside the repo that holds design files.
  dir: string;
  defaultBranch: string;
}

interface GitStore {
  connection: GitConnection | null;
  connect: (connection: GitConnection) => void;
  disconnect: () => void;
}

export const useGitStore = create<GitStore>()(
  persist(
    (set) => ({
      connection: null,
      connect: (connection) => set({ connection }),
      disconnect: () => set({ connection: null }),
    }),
    { name: "motif-git" }
  )
);

export const repoSlug = (c: GitConnection) => `${c.owner}/${c.repo}`;
