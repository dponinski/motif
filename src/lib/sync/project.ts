import { nanoid } from "nanoid";
import type { Project } from "@/store/projects";
import { emptyTokenData, type TokenData } from "@/store/design-system";
import type { ProjectPayload } from "./payload";

// Moving a synced project's parts into a project held in the browser, and the other way round (toPayload).

// A project that came from the server. It has no access token: that stays with whichever browser it was typed into,
// and a project without one reads public repositories or goes by the GitHub sign-in.
export function projectFromPayload(id: string, payload: ProjectPayload, now = Date.now()): Project {
  return {
    id,
    name: payload.name,
    createdAt: now,
    updatedAt: now,
    repo: {
      connection: payload.connection ? { ...payload.connection, token: "" } : null,
      analysis: null,
      tokenLink: payload.tokenLink as unknown as Project["repo"]["tokenLink"],
    },
    library: { source: null, components: [] },
    tokens: { ...emptyTokenData(), ...(payload.tokens as unknown as Partial<TokenData>) },
    docs: payload.docs as Project["docs"],
  };
}

// Takes the server's parts into a project, keeping what is only on this device: the access token (while it is the
// same repository), and the scan and library (until the repository is a different one).
export function applyPayload(project: Project, payload: ProjectPayload, now = Date.now()): Project {
  const was = project.repo.connection;
  const next = payload.connection;
  const sameRepo = !!was && !!next && was.owner === next.owner && was.repo === next.repo;
  return {
    ...project,
    name: payload.name,
    updatedAt: now,
    repo: {
      connection: next ? { ...next, token: sameRepo ? was!.token : "" } : null,
      analysis: sameRepo || (!was && !next) ? project.repo.analysis : null,
      tokenLink: payload.tokenLink as unknown as Project["repo"]["tokenLink"],
      // Where this device has got to with its pull request is its own, and goes with its unsent changes.
      work: sameRepo ? project.repo.work ?? null : null,
    },
    library: sameRepo || (!was && !next) ? project.library : { source: null, components: [] },
    tokens: { ...emptyTokenData(), ...(payload.tokens as unknown as Partial<TokenData>) },
    docs: payload.docs as Project["docs"],
  };
}

export const newProjectId = () => nanoid(8);
