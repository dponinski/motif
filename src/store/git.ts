import { create } from "zustand";
import type { RepoAnalysis } from "@/lib/repo-scan/types";
import type { DtcgLink } from "@/lib/dtcg/sync";
import type { TokenLink } from "@/lib/token-sync/flow";
import type { WorkState } from "@/lib/work/sync";

export interface GitConnection {
  owner: string;
  repo: string;
  // Personal access token, or "" to read a public repository without one. Only ever sent to the git host.
  token: string;
  defaultBranch: string;
}

// Stands in for a connection while there isn't one (a hook that has to be called either way takes this, and nothing is asked
// of the host with it).
export const NO_CONNECTION: GitConnection = { owner: "", repo: "", token: "", defaultBranch: "main" };

// The link between Motif's tokens and a repository: of one set to the tokens in the repository's stylesheets, or of every set to
// design tokens files (`format: "dtcg"`).
export type AnyTokenLink = TokenLink | DtcgLink;
export const isDtcgLink = (link: AnyTokenLink | null | undefined): link is DtcgLink => !!link && (link as DtcgLink).format === "dtcg";
// What the parts that only know the first kind of link read.
export const stylesheetLink = (link: AnyTokenLink | null | undefined): TokenLink | null => (link && !isDtcgLink(link) ? link : null);

// The repository of the project that is open. It is held in memory and kept by the project (store/projects.ts).
export interface RepoState {
  connection: GitConnection | null;
  // The most recent repository scan.
  analysis: RepoAnalysis | null;
  // Which Motif token set is synced with which repository, and where the last sync left off.
  tokenLink: AnyTokenLink | null;
  // The working branch and pull request the project's unsent changes go to (lib/work/sync.ts). Only on this device.
  work?: WorkState | null;
  // The commit the default branch was at when the repository was last read, to tell when it has moved. Only on this device.
  pulledSha?: string | null;
}

interface GitStore extends RepoState {
  connect: (connection: GitConnection) => void;
  setAnalysis: (analysis: RepoAnalysis | null) => void;
  setTokenLink: (link: AnyTokenLink | null) => void;
  setWork: (work: WorkState | null) => void;
  setPulledSha: (sha: string | null) => void;
  load: (state: RepoState) => void;
}

export const useGitStore = create<GitStore>()((set) => ({
  connection: null,
  analysis: null,
  tokenLink: null,
  work: null,
  pulledSha: null,
  connect: (connection) => set({ connection }),
  setAnalysis: (analysis) => set({ analysis }),
  setTokenLink: (tokenLink) => set({ tokenLink }),
  setWork: (work) => set({ work }),
  setPulledSha: (pulledSha) => set({ pulledSha }),
  load: ({ connection, analysis, tokenLink, work, pulledSha }) => set({ connection, analysis, tokenLink, work: work ?? null, pulledSha: pulledSha ?? null }),
}));

export const repoSlug = (c: Pick<GitConnection, "owner" | "repo">) => `${c.owner}/${c.repo}`;
