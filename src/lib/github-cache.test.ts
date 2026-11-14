import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubClient, memoReader, type RepoReader } from "./github";

// A GitHub that counts what it is asked, by kind of request.
function stub(repo: string, sha: () => string) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url).pathname.replace(`/repos/acme/${repo}`, "");
    calls.push(path.replace(/[0-9a-f]{40}/, ":sha"));
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (path.startsWith("/git/ref/heads/")) return json({ object: { sha: sha() } });
    if (path.startsWith("/git/trees/")) return json({ tree: [{ path: `src/${path.slice(-45, -5)}.tsx`, type: "blob" }, { path: "src", type: "tree" }], truncated: false });
    if (path.startsWith("/git/blobs/")) return json({ content: btoa("hello") });
    return new Response("{}", { status: 404 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("what GitHub names by content is read once", () => {
  it("lists a commit's tree once, but looks the branch up every time", async () => {
    const head = "a".repeat(40);
    const calls = stub("cache1", () => head);
    const client = createGitHubClient({ owner: "acme", repo: "cache1", token: "t" });
    const first = await client.listTree("main");
    const second = await client.listTree("main");
    expect(second).toEqual(first);
    expect(calls.filter((c) => c === "/git/ref/heads/main")).toHaveLength(2);
    expect(calls.filter((c) => c === "/git/trees/:sha")).toHaveLength(1);
  });

  it("lists the tree again when the branch has moved", async () => {
    let head = "b".repeat(40);
    const calls = stub("cache2", () => head);
    const client = createGitHubClient({ owner: "acme", repo: "cache2", token: "t" });
    const before = await client.listTree("main");
    head = "c".repeat(40);
    const after = await client.listTree("main");
    expect(after.paths).not.toEqual(before.paths);
    expect(calls.filter((c) => c === "/git/trees/:sha")).toHaveLength(2);
  });

  it("keeps trees and blobs of one repository apart from another's", async () => {
    const head = "d".repeat(40);
    const calls = stub("cache3", () => head);
    await createGitHubClient({ owner: "acme", repo: "cache3", token: "t" }).listTree("main");
    vi.unstubAllGlobals();
    const other = stub("cache4", () => head);
    await createGitHubClient({ owner: "acme", repo: "cache4", token: "t" }).listTree("main");
    expect(calls.filter((c) => c.startsWith("/git/trees/"))).toHaveLength(1);
    expect(other.filter((c) => c.startsWith("/git/trees/"))).toHaveLength(1);
  });

  it("reads a blob once", async () => {
    const calls = stub("cache5", () => "e".repeat(40));
    const client = createGitHubClient({ owner: "acme", repo: "cache5", token: "t" });
    expect(await client.getBlob!("f".repeat(40))).toBe("hello");
    expect(await client.getBlob!("f".repeat(40))).toBe("hello");
    expect(calls.filter((c) => c === "/git/blobs/:sha")).toHaveLength(1);
  });
});

describe("a reader for one piece of work", () => {
  const counting = () => {
    const seen = { text: 0, tree: 0 };
    const reader: RepoReader = {
      readText: async (path) => { seen.text++; return path === "boom" ? Promise.reject(new Error("offline")) : `text of ${path}`; },
      listTree: async () => { seen.tree++; return { paths: ["a"], truncated: false }; },
    };
    return { seen, reader };
  };

  it("reads each file and each tree once", async () => {
    const { seen, reader } = counting();
    const memo = memoReader(reader);
    await Promise.all([memo.readText("a", "main"), memo.readText("a", "main"), memo.readText("b", "main"), memo.readText("a", "other")]);
    await memo.readText("a", "main");
    expect(seen.text).toBe(3);
    await memo.listTree("main");
    await memo.listTree("main");
    expect(seen.tree).toBe(1);
  });

  it("doesn't keep a failure, so the next ask tries again", async () => {
    const { seen, reader } = counting();
    const memo = memoReader(reader);
    await expect(memo.readText("boom", "main")).rejects.toThrow("offline");
    await expect(memo.readText("boom", "main")).rejects.toThrow("offline");
    expect(seen.text).toBe(2);
  });
});
