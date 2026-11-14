import { beforeEach, describe, expect, it } from "vitest";
import { useEditStore } from "../../store/edit";
import { memoryReader } from "../repo-scan/source";
import { editPrBody } from "./body";
import { createdPaths, overlayOf, overlayPaths, overlayReader } from "./overlay";
import { stageFiles } from "./stage";
import { gitBlobSha } from "../github";

const repo = { "package.json": "{}\n", "src/a.css": "a {}\n", "src/index.ts": "export {};\n" };
const host = () => {
  const reader = memoryReader(repo);
  return { ...reader, getFile: async (path: string) => (path in repo ? { text: repo[path as keyof typeof repo], sha: await gitBlobSha(repo[path as keyof typeof repo]) } : null) };
};
const edit = () => useEditStore.getState();

describe("the overlay", () => {
  beforeEach(() => { useEditStore.setState({ scope: null }); edit().adopt("acme/ds@main"); });

  it("shows the editor's text over the repository's, and lists files made here", async () => {
    edit().change("src/a.css", "a { color: red }\n", null, "edit", { text: repo["src/a.css"], sha: "s1" });
    edit().change("src/new.css", "n {}\n", null, "make", { text: "", sha: null });
    const overlay = overlayOf(edit());
    const reader = overlayReader(host(), overlay);
    expect(await reader.readText("src/a.css", "main")).toBe("a { color: red }\n");
    expect(await reader.readText("package.json", "main")).toBe("{}\n");
    expect(await reader.readText("src/new.css", "main")).toBe("n {}\n");
    expect((await reader.listTree("main")).paths.sort()).toEqual(["package.json", "src/a.css", "src/index.ts", "src/new.css"]);
    expect(createdPaths(overlay)).toEqual(["src/new.css"]);
    expect(overlayPaths(["src/a.css", "src/new.css"], overlay)).toEqual(["src/a.css", "src/new.css"]);
  });

  it("getFile gives a changed file's repository sha, so writes are guarded by what the repository had", async () => {
    edit().change("src/a.css", "b\n", null, "edit", { text: repo["src/a.css"], sha: "s1" });
    const reader = overlayReader(host(), overlayOf(edit()));
    expect(await reader.getFile("src/a.css", "main")).toEqual({ text: "b\n", sha: "s1" });
    expect((await reader.getFile("package.json", "main"))?.text).toBe("{}\n");
    expect(await reader.getFile("missing", "main")).toBeNull();
  });

  it("a file changed and changed back is not part of it", async () => {
    edit().change("src/a.css", "b\n", null, "edit", { text: repo["src/a.css"], sha: "s1" });
    edit().change("src/a.css", repo["src/a.css"], null, "back");
    expect(overlayOf(edit()).texts).toEqual({});
  });

  it("works over a reader that can only read text", async () => {
    const reader = overlayReader(memoryReader(repo), overlayOf(edit()));
    expect((await reader.getFile("package.json", "main"))?.sha).toBe(await gitBlobSha("{}\n"));
  });
});

describe("stageFiles", () => {
  beforeEach(() => { useEditStore.setState({ scope: null }); edit().adopt("acme/ds@main"); });

  it("starts files from what the default branch has, and new files from nothing, as one step", async () => {
    await stageFiles({ host: host(), branch: "main", scope: "acme/ds@main", files: { "src/a.css": "a { color: red }\n", "src/tokens.css": "t {}\n" }, summary: "Tokens: 1 change" });
    const changed = Object.fromEntries(Object.entries(edit().bases).map(([p, b]) => [p, b.sha === null ? "new" : "existing"]));
    expect(changed).toEqual({ "src/a.css": "existing", "src/tokens.css": "new" });
    expect(edit().bases["src/a.css"].text).toBe("a {}\n");
    expect(edit().history).toHaveLength(2);
    edit().undo();
    expect(overlayOf(edit()).texts).toEqual({});
  });

  it("is a no-op when nothing changes, and keeps a file's starting point when staged again", async () => {
    await stageFiles({ host: host(), branch: "main", scope: "acme/ds@main", files: { "src/a.css": "x\n" }, summary: "one" });
    await stageFiles({ host: host(), branch: "main", scope: "acme/ds@main", files: { "src/a.css": "x\n" }, summary: "again" });
    expect(edit().history).toHaveLength(2);
    await stageFiles({ host: host(), branch: "main", scope: "acme/ds@main", files: { "src/a.css": "y\n" }, summary: "two" });
    expect(edit().bases["src/a.css"].text).toBe("a {}\n");
    expect(edit().history).toHaveLength(3);
  });
});

describe("the pull request description", () => {
  it("nests a step's details under it and leaves out an empty change list", () => {
    const body = editPrBody(["a.css"], ["Tokens: 2 changes\n`primary` (light): `#fff` → `#000`\n`space-2`: added", "Create Card"], "");
    expect(body).toContain("- Tokens: 2 changes\n  - `primary` (light): `#fff` → `#000`\n  - `space-2`: added\n- Create Card");
    expect(editPrBody(["a.css"], [], "")).not.toContain("### Changes");
  });
});
