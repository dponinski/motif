import { describe, expect, it } from "vitest";
import { GitHostError, gitBlobSha } from "../github";
import { openTokenPr, prBody, prBranchName } from "./pr";
import type { TokenChange } from "./merge";

function fakeRepo(files: Record<string, string>) {
  const calls: string[] = [];
  const branches = new Map<string, Map<string, string>>([["main", new Map(Object.entries(files))]]);
  return {
    calls,
    branches,
    host: {
      async createBranch(name: string, from: string) {
        calls.push(`branch ${name} from ${from}`);
        branches.set(name, new Map(branches.get(from)));
      },
      async putFile({ path, branch, text, sha }: { path: string; branch: string; text: string; message: string; sha?: string }) {
        const current = branches.get(branch)!.get(path);
        const currentSha = current === undefined ? undefined : await gitBlobSha(current);
        if (currentSha !== sha) throw new GitHostError("sha mismatch", 409);
        calls.push(`put ${path}`);
        branches.get(branch)!.set(path, text);
        return { sha: await gitBlobSha(text), commitUrl: "" };
      },
      async createPullRequest({ title, head, base }: { title: string; body: string; head: string; base: string }) {
        calls.push(`pr ${head} -> ${base}: ${title}`);
        return { number: 7, url: "https://github.com/a/b/pull/7" };
      },
    },
  };
}

describe("openTokenPr", () => {
  it("makes a branch, commits each file, then opens the pull request", async () => {
    const repo = fakeRepo({ "a.css": "old" });
    const pr = await openTokenPr({
      host: repo.host, base: "main", branch: "motif/tokens-x", title: "T", body: "B", message: "M",
      files: { "a.css": { text: "new", sha: await gitBlobSha("old") }, "b.css": { text: "created", sha: null } },
    });
    expect(pr).toEqual({ number: 7, url: "https://github.com/a/b/pull/7", branch: "motif/tokens-x" });
    expect(repo.calls).toEqual(["branch motif/tokens-x from main", "put a.css", "put b.css", "pr motif/tokens-x -> main: T"]);
    expect(repo.branches.get("motif/tokens-x")!.get("a.css")).toBe("new");
    expect(repo.branches.get("main")!.get("a.css")).toBe("old");
  });

  it("refuses to overwrite a file that changed since the edit was computed, and opens no pull request", async () => {
    const repo = fakeRepo({ "a.css": "changed by someone else" });
    await expect(
      openTokenPr({ host: repo.host, base: "main", branch: "b", title: "T", body: "B", message: "M", files: { "a.css": { text: "new", sha: await gitBlobSha("old") } } })
    ).rejects.toThrow(/a\.css changed in the repository while the pull request was being prepared/);
    expect(repo.calls.some((c) => c.startsWith("pr "))).toBe(false);
    expect(repo.branches.get("main")!.get("a.css")).toBe("changed by someone else");
  });

  it("names branches uniquely", () => {
    expect(prBranchName(1)).toBe("motif/tokens-1");
    expect(prBranchName(1000)).not.toBe(prBranchName(1001));
  });
});

describe("prBody", () => {
  const changes: TokenChange[] = [
    { name: "primary", kind: "color", theme: "dark", type: "changed", before: "#111111", after: "#222222" },
    { name: "brand`s", kind: "color", theme: "light", type: "added", after: "#333333" },
    { name: "radius-md", kind: "radius", theme: "light", type: "changed", before: "8", after: "10" },
  ];

  it("lists each change and what was left out", () => {
    const body = prBody(changes, [{ name: "radius-md", theme: "light", reason: "Defined in a Tailwind config file, which can't be edited yet" }], { generated: false });
    expect(body).toContain("Updates design tokens to match the changes made in Motif.");
    expect(body).toContain("### Changes (3)");
    expect(body).toContain("- `radius-md` (light): `8px` → `10px`");
    expect(body).toContain("- `primary` (dark): `#111111` → `#222222`");
    expect(body).toContain("- `brand's` (light): `#333333`");
    expect(body).toContain("### Not included");
    expect(body).toContain("- `radius-md` (light): Defined in a Tailwind config file, which can't be edited yet");
  });

  it("describes a generated file and caps long lists", () => {
    const many = Array.from({ length: 75 }, (_, i): TokenChange => ({ name: `t${i}`, kind: "color", theme: "light", type: "added", after: "#000000" }));
    const body = prBody(many, [], { generated: true });
    expect(body).toContain("Adds the design tokens from Motif as a stylesheet");
    expect(body).toContain("### Tokens (75)");
    expect(body).toContain("…and 15 more");
    expect(body).not.toContain("### Not included");
  });
});
