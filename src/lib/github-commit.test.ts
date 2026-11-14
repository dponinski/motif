import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubClient, GitHostError } from "./github";

interface Call { method: string; path: string; body?: Record<string, unknown> }

// A GitHub that answers the Git Data calls, recording them.
function stub(handlers: Record<string, (body?: Record<string, unknown>) => { status: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace("/repos/acme/ds", "") + u.search;
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });
    const h = handlers[`${method} ${path}`] ?? handlers[`${method} ${u.pathname.replace("/repos/acme/ds", "").replace(/\/[0-9a-f]{40}$/, "/:sha")}`];
    const r = h ? h(body) : { status: 404, body: { message: "Not Found" } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}
const host = () => createGitHubClient({ owner: "acme", repo: "ds", token: "t" });
afterEach(() => vi.unstubAllGlobals());

const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const NEW_TREE = "c".repeat(40);
const NEW_COMMIT = "d".repeat(40);
const happy = {
  "GET /git/ref/heads/motif/changes-1": () => ({ status: 200, body: { object: { sha: HEAD } } }),
  [`GET /git/commits/:sha`]: () => ({ status: 200, body: { tree: { sha: TREE } } }),
  "POST /git/trees": () => ({ status: 201, body: { sha: NEW_TREE } }),
  "POST /git/commits": () => ({ status: 201, body: { sha: NEW_COMMIT } }),
  "PATCH /git/refs/heads/motif/changes-1": () => ({ status: 200, body: {} }),
};

describe("several files in one commit", () => {
  it("reads the branch, builds a tree on its tree, commits on its head, and moves the branch forward", async () => {
    const calls = stub(happy);
    const out = await host().commitFiles({ branch: "motif/changes-1", message: "Update from Motif", files: [{ path: "src/A.tsx", text: "a\n" }, { path: "src/A.css", text: ".a{}\n" }] });
    expect(out).toEqual({ sha: NEW_COMMIT, url: `https://github.com/acme/ds/commit/${NEW_COMMIT}` });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /git/ref/heads/motif/changes-1", `GET /git/commits/${HEAD}`, "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/motif/changes-1",
    ]);
    expect(calls[2].body).toEqual({
      base_tree: TREE,
      tree: [{ path: "src/A.tsx", mode: "100644", type: "blob", content: "a\n" }, { path: "src/A.css", mode: "100644", type: "blob", content: ".a{}\n" }],
    });
    expect(calls[3].body).toEqual({ message: "Update from Motif", tree: NEW_TREE, parents: [HEAD] });
    expect(calls[4].body).toEqual({ sha: NEW_COMMIT, force: false });
  });

  it("takes a file away when its text is null", async () => {
    const calls = stub(happy);
    await host().commitFiles({ branch: "motif/changes-1", message: "m", files: [{ path: "src/Old.tsx", text: null }] });
    expect((calls[2].body as { tree: unknown[] }).tree).toEqual([{ path: "src/Old.tsx", mode: "100644", type: "blob", sha: null }]);
  });

  it("keeps unicode and long text as they are", async () => {
    const calls = stub(happy);
    const text = "日本語 🎨 ".repeat(5000);
    await host().commitFiles({ branch: "motif/changes-1", message: "m", files: [{ path: "a.txt", text }] });
    expect((calls[2].body as { tree: { content: string }[] }).tree[0].content).toBe(text);
  });

  it("says when there is no such branch, and sends nothing", async () => {
    const calls = stub({});
    await expect(host().commitFiles({ branch: "gone", message: "m", files: [{ path: "a", text: "b" }] })).rejects.toThrow(/branch gone was not found/);
    expect(calls).toHaveLength(1);
  });

  it("says the branch moved when it can't be moved forward, which leaves its files as they were", async () => {
    stub({ ...happy, "PATCH /git/refs/heads/motif/changes-1": () => ({ status: 422, body: { message: "Update is not a fast forward" } }) });
    const err = await host().commitFiles({ branch: "motif/changes-1", message: "m", files: [{ path: "a", text: "b" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHostError);
    expect(err.message).toMatch(/changed while the changes were being sent/);
  });

  it("passes other failures on as they are", async () => {
    stub({ ...happy, "POST /git/trees": () => ({ status: 500, body: { message: "Server Error" } }) });
    await expect(host().commitFiles({ branch: "motif/changes-1", message: "m", files: [{ path: "a", text: "b" }] })).rejects.toThrow(/Server Error/);
  });
});

describe("branches and the pull request", () => {
  it("finds the commit a branch is at, or nothing", async () => {
    stub({ "GET /git/ref/heads/a/b": () => ({ status: 200, body: { object: { sha: HEAD } } }) });
    expect(await host().getRef("a/b")).toBe(HEAD);
    expect(await host().getRef("nope")).toBeNull();
  });

  it("changes a pull request's title and description", async () => {
    const calls = stub({ "PATCH /pulls/7": () => ({ status: 200, body: {} }) });
    await host().updatePullRequest(7, { body: "new text" });
    expect(calls[0]).toEqual({ method: "PATCH", path: "/pulls/7", body: { body: "new text" } });
  });

  it("reads whether a pull request can be merged", async () => {
    stub({ "GET /pulls/7": () => ({ status: 200, body: { number: 7, html_url: "https://github.com/acme/ds/pull/7", state: "open", merged: false, mergeable_state: "behind" } }) });
    expect(await host().getPullRequest(7)).toEqual({ number: 7, url: "https://github.com/acme/ds/pull/7", state: "open", merged: false, mergeableState: "behind" });
    stub({ "GET /pulls/8": () => ({ status: 200, body: { number: 8, html_url: "u", state: "closed", merged_at: "2026-01-01" } }) });
    expect(await host().getPullRequest(8)).toMatchObject({ state: "closed", merged: true, mergeableState: null });
  });

  it("brings the branch up to date, and says when it can't be done by itself", async () => {
    const calls = stub({ "PUT /pulls/7/update-branch": () => ({ status: 202, body: { message: "Updating pull request branch." } }) });
    await host().updateBranch(7);
    expect(calls[0].method).toBe("PUT");
    stub({ "PUT /pulls/7/update-branch": () => ({ status: 422, body: { message: "merge conflict between base and head" } }) });
    await expect(host().updateBranch(7)).rejects.toThrow(/conflict with the base branch/);
  });
});
