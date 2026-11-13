import { describe, expect, it, vi } from "vitest";
import { scanRepository } from ".";
import { createGitHubClient } from "../github";
import { createFirstCommit, firstReadme } from "../repo-init";
import { memorySource } from "./source";

describe("scanning a repository with nothing in it", () => {
  it("gives an empty analysis, not an error", async () => {
    const analysis = await scanRepository(memorySource({}), { repo: "acme/new", ref: "main" });
    expect(analysis.components).toEqual([]);
    expect(analysis.tokens).toEqual([]);
    expect(analysis.styleFiles).toEqual([]);
    expect(analysis.stack.tailwindVersion).toBeNull();
    expect(analysis.tailwindEntry ?? null).toBeNull();
  });

  it("does the same for a repository that only has a README", async () => {
    const analysis = await scanRepository(memorySource({ "README.md": "# hi" }), { repo: "acme/new", ref: "main" });
    expect(analysis.components).toEqual([]);
    expect(analysis.tokens).toEqual([]);
  });

  it("also with only the tokens read", async () => {
    const analysis = await scanRepository(memorySource({}), { repo: "acme/new", ref: "main" }, { tokensOnly: true });
    expect(analysis.tokens).toEqual([]);
  });
});

// GitHub's answers for a repository that has no commits.
function emptyRepoFetch(extra: (url: string, init?: RequestInit) => Response | null = () => null) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ url: u.pathname + u.search, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = extra(url, init);
    if (custom) return custom;
    if (u.pathname.endsWith("/branches")) return json(200, []);
    if (u.pathname.includes("/git/ref/")) return json(409, { message: "Git Repository is empty." });
    if (u.pathname.includes("/git/trees/")) return json(409, { message: "Git Repository is empty." });
    if (u.pathname.includes("/contents/") && (init?.method ?? "GET") === "PUT") return json(201, { content: { sha: "abc" }, commit: { html_url: "https://github.com/acme/new/commit/1" } });
    if (u.pathname.includes("/contents/")) return json(404, { message: "This repository is empty." });
    return json(200, { default_branch: "main", permissions: { push: true } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("reading an empty repository from GitHub", () => {
  it("says it is empty", async () => {
    emptyRepoFetch();
    expect(await createGitHubClient({ owner: "acme", repo: "new", token: "t" }).isEmpty()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("says a repository with a branch is not", async () => {
    emptyRepoFetch((url) => (new URL(url).pathname.endsWith("/branches") ? new Response(JSON.stringify([{ name: "main" }]), { status: 200 }) : null));
    expect(await createGitHubClient({ owner: "acme", repo: "new", token: "t" }).isEmpty()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("lists no files, whether GitHub answers 409 on the ref or the tree", async () => {
    emptyRepoFetch();
    const host = createGitHubClient({ owner: "acme", repo: "new", token: "t" });
    expect(await host.listTree("main")).toEqual({ paths: [], truncated: false });
    vi.unstubAllGlobals();

    // A 404 for the branch in a repository that has no branches at all is the same thing
    emptyRepoFetch((url) => (new URL(url).pathname.includes("/git/ref/") ? new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }) : null));
    expect(await createGitHubClient({ owner: "acme", repo: "new", token: "t" }).listTree("main")).toEqual({ paths: [], truncated: false });
    vi.unstubAllGlobals();

    // ...and by a sha
    emptyRepoFetch();
    expect(await createGitHubClient({ owner: "acme", repo: "new", token: "t" }).listTree("a".repeat(40))).toEqual({ paths: [], truncated: false });
    vi.unstubAllGlobals();
  });

  it("still says so when a branch is really missing in a repository that has others", async () => {
    emptyRepoFetch((url) => {
      const path = new URL(url).pathname;
      if (path.includes("/git/ref/")) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      if (path.endsWith("/branches")) return new Response(JSON.stringify([{ name: "main" }]), { status: 200 });
      return null;
    });
    await expect(createGitHubClient({ owner: "acme", repo: "new", token: "t" }).listTree("nope")).rejects.toThrow(/branch nope was not found/);
    vi.unstubAllGlobals();
  });

  it("is not hidden by other errors", async () => {
    emptyRepoFetch((url) => (new URL(url).pathname.includes("/git/trees/") ? new Response(JSON.stringify({ message: "Server Error" }), { status: 500 }) : new URL(url).pathname.includes("/git/ref/") ? new Response(JSON.stringify({ object: { sha: "b".repeat(40) } }), { status: 200 }) : null));
    await expect(createGitHubClient({ owner: "acme", repo: "new", token: "t" }).listTree("main")).rejects.toThrow(/Server Error/);
    vi.unstubAllGlobals();
  });
});

describe("the first commit", () => {
  it("writes a README to the default branch, without naming a branch or a sha", async () => {
    const calls = emptyRepoFetch();
    const host = createGitHubClient({ owner: "acme", repo: "new", token: "t" });
    const out = await createFirstCommit(host, "new");
    expect(out.commitUrl).toContain("/commit/1");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("/contents/README.md");
    expect(put.body).toMatchObject({ message: "Initial commit" });
    expect(put.body).not.toHaveProperty("branch");
    expect(put.body).not.toHaveProperty("sha");
    expect(Buffer.from(put.body!.content as string, "base64").toString()).toBe(firstReadme("new"));
    vi.unstubAllGlobals();
  });
});
