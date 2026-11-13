import { useEffect, useState } from "react";
import { useAIStore } from "./ai";
import { useDesignSystemStore, snapshotTokens } from "./design-system";
import { useDocsStore } from "./docs";
import { useGitStore } from "./git";
import { useLibraryStore } from "./library";
import { useProjectsStore, type Project, type ProjectData } from "./projects";

// The editor works on one project at a time, in the same stores it always used. These move a project into them
// and back, so the stores themselves hold nothing between projects (or between visits: the project keeps it).

export function loadProject(project: Project) {
  // What was said about another project components is not about this one.
  useAIStore.getState().clearMessages();
  useGitStore.getState().load(project.repo);
  useLibraryStore.getState().load(project.library);
  useDesignSystemStore.setState(project.tokens);
  useDocsStore.getState().setPages(project.docs);
}

export function snapshotProject(): ProjectData {
  const { connection, analysis, tokenLink } = useGitStore.getState();
  const { source, components } = useLibraryStore.getState();
  return {
    repo: { connection, analysis, tokenLink },
    library: { source, components },
    tokens: snapshotTokens(useDesignSystemStore.getState()),
    docs: useDocsStore.getState().pages,
  };
}

const SAVE_DELAY = 500;

// Loads the project into the stores while the editor is open and writes changes back as they happen.
// Returns "missing" when there is no such project, and "ready" once the stores hold it.
export function useProjectSession(projectId: string): "loading" | "ready" | "missing" {
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
    if (!project) {
      setState("missing");
      return;
    }
    loadProject(project);
    setState("ready");

    let timer: ReturnType<typeof setTimeout> | null = null;
    // Writes only when something changed since the last write, so leaving the page never overwrites a project
    // with what it was loaded as.
    const flush = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      // A project deleted while open stays deleted.
      if (useProjectsStore.getState().projects.some((p) => p.id === projectId)) {
        useProjectsStore.getState().save(projectId, snapshotProject());
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY);
    };

    const unsubscribe = [
      useGitStore.subscribe(schedule),
      useDesignSystemStore.subscribe(schedule),
      useDocsStore.subscribe(schedule),
      useLibraryStore.subscribe((s, prev) => {
        if (s.source !== prev.source || s.components !== prev.components) schedule();
      }),
    ];
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("pagehide", flush);
      unsubscribe.forEach((off) => off());
      flush();
    };
  }, [projectId]);

  return state;
}
