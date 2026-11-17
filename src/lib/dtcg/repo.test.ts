import { describe, expect, it } from "vitest";
import { configPathIn, readRepoTokenFiles } from "./repo";

const reader = (files: Record<string, string>) => ({
  listTree: async () => ({ paths: Object.keys(files), truncated: false }),
  readText: async (path: string) => files[path] ?? null,
});
const config = JSON.stringify({ files: "single", output: "src/styles/tokens.css", tailwind: true, selectors: { dark: ".dark" }, sets: [{ name: "Tokens", key: "tokens", themes: [] }] });

describe("finding a repository's design tokens", () => {
  it("is the tokens config nearest the top", () => {
    expect(configPathIn(["a/b/c/tokens.config.json", "src/tokens/tokens.config.json", "x.json"])).toBe("src/tokens/tokens.config.json");
    expect(configPathIn(["tokens.config.json", "src/tokens/tokens.config.json"])).toBe("tokens.config.json");
    expect(configPathIn(["src/index.css"])).toBeNull();
  });

  it("reads the config and the files it describes, and nothing else", async () => {
    const found = await readRepoTokenFiles(reader({
      "src/tokens/tokens.config.json": config, "src/tokens/tokens.json": "{}", "src/tokens/tokens.dark.json": "{}",
      "src/tokens/nested/other.json": "{}", "src/tokens/other.json": "{}", "src/tokens/readme.md": "x", "package.json": "{}",
    }), "main");
    expect(found?.dir).toBe("src/tokens");
    expect(Object.keys(found!.files).sort()).toEqual(["src/tokens/tokens.config.json", "src/tokens/tokens.dark.json", "src/tokens/tokens.json"]);
  });

  it("works from the top of the repository", async () => {
    const found = await readRepoTokenFiles(reader({ "tokens.config.json": config, "tokens.json": "{}", "package.json": "{}" }), "main");
    expect(found?.dir).toBe("");
    expect(Object.keys(found!.files).sort()).toEqual(["tokens.config.json", "tokens.json"]);
  });

  it("isn't design tokens when there is no config, or the config isn't one", async () => {
    expect(await readRepoTokenFiles(reader({ "tokens.json": "{}" }), "main")).toBeNull();
    expect(await readRepoTokenFiles(reader({ "tokens.config.json": "{}" }), "main")).toBeNull();
    expect(await readRepoTokenFiles(reader({ "tokens.config.json": "nope" }), "main")).toBeNull();
  });
});
