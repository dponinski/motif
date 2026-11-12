import { beforeEach, describe, expect, it } from "vitest";
import { useDesignSystemStore } from "./design-system";
import { useDocsStore } from "./docs";
import { useGitStore } from "./git";
import { useLibraryStore } from "./library";
import { loadProject, snapshotProject } from "./project-session";
import { useProjectsStore } from "./projects";

const connection = (repo: string) => ({ owner: "acme", repo, token: "t", defaultBranch: "main" });

beforeEach(() => {
  useProjectsStore.setState({ projects: [] });
});

describe("projects", () => {
  it("starts a project from a repository, with nothing in it yet", () => {
    const p = useProjectsStore.getState().create(connection("ui"));
    expect(p.name).toBe("ui");
    expect(p.repo.connection).toEqual(connection("ui"));
    expect(p.library.components).toEqual([]);
    expect(p.tokens.colors).toEqual([]);
    expect(p.tokens.sets).toHaveLength(1);
    expect(p.content.docs).toEqual([]);
  });

  it("gives each project its own token set", () => {
    const a = useProjectsStore.getState().create(connection("a"));
    const b = useProjectsStore.getState().create(connection("b"));
    expect(a.tokens.sets).not.toBe(b.tokens.sets);
    expect(a.id).not.toBe(b.id);
  });

  it("renames and removes", () => {
    const { create, rename, remove } = useProjectsStore.getState();
    const p = create(connection("ui"));
    rename(p.id, "Acme UI");
    expect(useProjectsStore.getState().projects[0].name).toBe("Acme UI");
    remove(p.id);
    expect(useProjectsStore.getState().projects).toEqual([]);
  });
});

describe("working on a project", () => {
  it("loads one project's repository, tokens and docs and keeps them apart from another's", () => {
    const { create, save } = useProjectsStore.getState();
    const a = create(connection("a"));
    const b = create(connection("b"));

    loadProject(a);
    expect(useGitStore.getState().connection?.repo).toBe("a");
    useDesignSystemStore.getState().addColor({ name: "primary", value: "#ff0000", group: "brand", setId: a.tokens.sets[0].id });
    useDocsStore.getState().savePage({ id: "p1", title: "Intro", blocks: [] });
    save(a.id, snapshotProject());

    loadProject(useProjectsStore.getState().projects.find((p) => p.id === b.id)!);
    expect(useGitStore.getState().connection?.repo).toBe("b");
    expect(useDesignSystemStore.getState().colors).toEqual([]);
    expect(useDocsStore.getState().pages).toEqual([]);

    loadProject(useProjectsStore.getState().projects.find((p) => p.id === a.id)!);
    expect(useDesignSystemStore.getState().colors.map((c) => c.name)).toEqual(["primary"]);
    expect(useDocsStore.getState().pages.map((p) => p.id)).toEqual(["p1"]);
  });

  it("writes the library back with the project", () => {
    const { create, save } = useProjectsStore.getState();
    const p = create(connection("a"));
    loadProject(p);
    useLibraryStore.setState({
      source: { repo: "acme/a", branch: "main", importedAt: 1, tailwindVersion: 4, tailwindEntry: null, styleFiles: [] },
      components: [],
    });
    save(p.id, snapshotProject());
    expect(useProjectsStore.getState().projects[0].library.source?.repo).toBe("acme/a");
  });
});
