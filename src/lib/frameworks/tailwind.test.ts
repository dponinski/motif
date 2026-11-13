import { describe, expect, it } from "vitest";
import { scanRepository, memorySource } from "../repo-scan";
import { readRepoState, planExport } from "../token-sync/flow";
import { FrameworkRefusal, TAILWIND_VERSION, addDevDependency, newPackageJson, planTailwind, tailwindPrBody } from "./tailwind";

// A host holding files in memory, with the sha each has.
const host = (files: Record<string, string>) => ({
  getFile: async (path: string) => (path in files ? { text: files[path], sha: `sha:${path}` } : null),
});
const stateOf = async (files: Record<string, string>) => {
  const reader = { listTree: async () => ({ paths: Object.keys(files), truncated: false }), readText: async (p: string) => files[p] ?? null };
  return readRepoState(reader, "acme/ds", "main");
};

describe("adding a dev dependency to package.json by editing its text", () => {
  it("adds to devDependencies and changes nothing else", () => {
    const text = `{\n  "name": "ds",\n  "scripts": { "build": "vite build" },\n  "files": ["dist", "src"],\n  "devDependencies": {\n    "vite": "^6.0.0"\n  }\n}\n`;
    const out = addDevDependency(text, "tailwindcss", "^4.0.0")!;
    expect(out).toBe(`{\n  "name": "ds",\n  "scripts": { "build": "vite build" },\n  "files": ["dist", "src"],\n  "devDependencies": {\n    "vite": "^6.0.0",\n    "tailwindcss": "^4.0.0"\n  }\n}\n`);
    expect(JSON.parse(out).devDependencies).toEqual({ vite: "^6.0.0", tailwindcss: "^4.0.0" });
  });

  it("keeps tabs, and four-space indents", () => {
    const tabs = `{\n\t"name": "ds",\n\t"devDependencies": {\n\t\t"vite": "6"\n\t}\n}\n`;
    expect(addDevDependency(tabs, "tailwindcss", "^4")).toBe(`{\n\t"name": "ds",\n\t"devDependencies": {\n\t\t"vite": "6",\n\t\t"tailwindcss": "^4"\n\t}\n}\n`);
    const four = `{\n    "name": "ds"\n}\n`;
    expect(addDevDependency(four, "tailwindcss", "^4")).toBe(`{\n    "name": "ds",\n    "devDependencies": {\n        "tailwindcss": "^4"\n    }\n}\n`);
  });

  it("fills an empty devDependencies, and makes the block when there is none", () => {
    expect(JSON.parse(addDevDependency(`{\n  "name": "ds",\n  "devDependencies": {}\n}\n`, "tailwindcss", "^4")!).devDependencies).toEqual({ tailwindcss: "^4" });
    expect(JSON.parse(addDevDependency(`{\n  "name": "ds"\n}\n`, "tailwindcss", "^4")!)).toEqual({ name: "ds", devDependencies: { tailwindcss: "^4" } });
    expect(JSON.parse(addDevDependency(`{}`, "tailwindcss", "^4")!)).toEqual({ devDependencies: { tailwindcss: "^4" } });
  });

  it("is not thrown by braces or the word in other places", () => {
    const text = `{\n  "description": "a {devDependencies} thing",\n  "devDependencies": {\n    "a": "1"\n  },\n  "peerDependencies": {\n    "react": "^19"\n  }\n}\n`;
    const out = addDevDependency(text, "tailwindcss", "^4")!;
    expect(JSON.parse(out)).toEqual({ description: "a {devDependencies} thing", devDependencies: { a: "1", tailwindcss: "^4" }, peerDependencies: { react: "^19" } });
  });

  it("gives up on what isn't a package.json", () => {
    expect(addDevDependency("not json", "tailwindcss", "^4")).toBeNull();
    expect(addDevDependency("[]", "tailwindcss", "^4")).toBeNull();
    expect(addDevDependency(`{"devDependencies": []}`, "tailwindcss", "^4")).toBeNull();
  });

  it("makes a package.json of its own when there is none", () => {
    const json = JSON.parse(newPackageJson("ds"));
    expect(json).toMatchObject({ name: "ds", private: true, type: "module", devDependencies: { tailwindcss: TAILWIND_VERSION } });
  });
});

describe("planning Tailwind for a repository", () => {
  it("in a repository with a README only: a package.json and a stylesheet that starts Tailwind", async () => {
    const files = { "README.md": "# ds" };
    const plan = await planTailwind(host(files), await stateOf(files), "main", "ds");
    expect(Object.keys(plan.files).sort()).toEqual(["package.json", "src/styles/tailwind.css"]);
    expect(plan.files["package.json"].sha).toBeNull();
    expect(plan.files["src/styles/tailwind.css"]).toEqual({ text: '@import "tailwindcss";\n', sha: null });
    expect(plan.notes.join(" ")).toMatch(/bundler/);
    expect(plan.summary.map((s) => s.path)).toEqual(["package.json", "src/styles/tailwind.css"]);
  });

  it("with Motif's tokens file: rewritten for Tailwind, and imported from the new stylesheet", async () => {
    const tokens = (await planExport(host({}), await stateOf({ "README.md": "# ds" }), "main", { id: "s", themes: [{ id: "t", name: "Default" }] }, {
      colors: [{ id: "c1", setId: "s", name: "primary", value: "#3366ff", group: "base", themeValues: { t: "#3366ff" } }], spacing: [], radii: [], shadows: [],
    })).files["src/styles/tokens.css"].text;
    expect(tokens).toContain("--primary: #3366ff");
    expect(tokens).not.toContain("@theme");

    const files = { "package.json": `{\n  "name": "ds",\n  "devDependencies": {\n    "vite": "6"\n  }\n}\n`, "src/styles/tokens.css": tokens };
    const plan = await planTailwind(host(files), await stateOf(files), "main", "ds");
    expect(plan.files["package.json"].sha).toBe("sha:package.json");
    expect(JSON.parse(plan.files["package.json"].text).devDependencies).toEqual({ vite: "6", tailwindcss: TAILWIND_VERSION });
    expect(plan.files["src/styles/tokens.css"].text).toContain("@theme inline");
    expect(plan.files["src/styles/tokens.css"].text).toContain("--color-primary: var(--primary)");
    expect(plan.files["src/styles/tokens.css"].sha).toBe("sha:src/styles/tokens.css");
    expect(plan.files["src/styles/tailwind.css"].text).toBe('@import "tailwindcss";\n@import "./tokens.css";\n');
  });

  it("leaves a tokens file Motif didn't make as it is, and says so", async () => {
    const files = { "package.json": "{}", "src/styles/tokens.css": ":root { --brand: red; }\n" };
    const plan = await planTailwind(host(files), await stateOf(files), "main", "ds");
    expect(plan.files["src/styles/tokens.css"]).toBeUndefined();
    expect(plan.files["src/styles/tailwind.css"].text).toBe('@import "tailwindcss";\n');
    expect(plan.notes.join(" ")).toMatch(/isn't a file Motif made/);
  });

  it("does not overwrite a stylesheet of the same name", async () => {
    const files = { "package.json": "{}", "src/styles/tailwind.css": "/* mine */", "src/styles/base.css": "body{}" };
    const plan = await planTailwind(host(files), await stateOf(files), "main", "ds");
    expect(Object.keys(plan.files)).toContain("src/styles/motif-tailwind.css");
    expect(plan.files["src/styles/tailwind.css"]).toBeUndefined();
  });

  it("refuses when Tailwind is already there, in either version, or package.json can't be edited", async () => {
    const v4 = { "package.json": `{"devDependencies":{"tailwindcss":"^4"}}`, "app.css": '@import "tailwindcss";' };
    await expect(planTailwind(host(v4), await stateOf(v4), "main", "ds")).rejects.toThrow(/already set up/);
    const v3 = { "package.json": `{"devDependencies":{"tailwindcss":"^3.4.0"}}`, "tailwind.config.js": "module.exports = {}" };
    await expect(planTailwind(host(v3), await stateOf(v3), "main", "ds")).rejects.toBeInstanceOf(FrameworkRefusal);
    const broken = { "package.json": "{ not json" };
    await expect(planTailwind(host(broken), await stateOf(broken), "main", "ds")).rejects.toThrow(/Add tailwindcss to it yourself/);
    // Listed anywhere in package.json counts as Tailwind being there.
    const listed = { "package.json": `{"dependencies":{"tailwindcss":"^4.1.0"}}` };
    await expect(planTailwind(host(listed), await stateOf(listed), "main", "ds")).rejects.toThrow(/already set up/);
  });

  it("writes a pull request description that lists every file", async () => {
    const files = { "README.md": "# ds" };
    const plan = await planTailwind(host(files), await stateOf(files), "main", "ds");
    const body = tailwindPrBody(plan);
    expect(body).toContain("`package.json`");
    expect(body).toContain("`src/styles/tailwind.css`");
    expect(body).toContain("Opened from Motif.");
  });

  it("once it is merged, the repository reads as a Tailwind v4 one, and tokens export in Tailwind's form", async () => {
    const files = { "README.md": "# ds" };
    const plan = await planTailwind(host(files), await stateOf(files), "main", "ds");
    const merged = { ...files, ...Object.fromEntries(Object.entries(plan.files).map(([p, f]) => [p, f.text])) };
    const analysis = await scanRepository(memorySource(merged), { repo: "acme/ds", ref: "main" });
    expect(analysis.stack.tailwindVersion).toBe(4);
    expect(analysis.tailwindEntry).toBe("src/styles/tailwind.css");
    const exported = await planExport(host(merged), await stateOf(merged), "main", { id: "s", themes: [{ id: "t", name: "Default" }] }, {
      colors: [{ id: "c1", setId: "s", name: "primary", value: "#3366ff", group: "base", themeValues: { t: "#3366ff" } }], spacing: [], radii: [], shadows: [],
    });
    expect(exported.files["src/styles/tokens.css"].text).toContain("@theme inline");
    // and the entry stylesheet imports it
    expect(exported.imported).toBe(true);
    expect(exported.files["src/styles/tailwind.css"].text).toContain('@import "./tokens.css";');
  });
});

describe("tokens made from scratch in a repository with no framework", () => {
  it("are written as plain CSS variables in a new stylesheet, with nothing to import it from", async () => {
    const files = { "README.md": "# ds" };
    const plan = await planExport(host(files), await stateOf(files), "main", { id: "s", themes: [{ id: "t", name: "Default" }, { id: "d", name: "Dark" }] }, {
      colors: [{ id: "c1", setId: "s", name: "primary", value: "#3366ff", group: "base", themeValues: { t: "#3366ff", d: "#99bbff" } }], spacing: [], radii: [], shadows: [],
    });
    expect(Object.keys(plan.files)).toEqual(["src/styles/tokens.css"]);
    expect(plan.files["src/styles/tokens.css"].sha).toBeNull();
    const css = plan.files["src/styles/tokens.css"].text;
    expect(css).toContain(":root {");
    expect(css).toContain("--primary: #3366ff;");
    expect(css).toContain("#99bbff");
    expect(css).not.toContain("@theme");
    expect(plan.imported).toBe(false);
  });
});
