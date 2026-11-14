import { describe, expect, it } from "vitest";
import type { GitHost, PrHost, PullRequestInfo } from "../github";
import { hashText } from "../sync/payload";
import { branchName, plan, refreshWork, statusOf, syncWork, SyncFailed, WorkEnded, type Changed, type WorkState } from "./sync";

// A GitHub in memory: branches that hold files, one pull request at a time, and a log of every request.
function fake() {
  const log: string[] = [];
  const branches = new Map<string, Record<string, string>>([["main", { "a.tsx": "A0", "b.tsx": "B0" }]]);
  const pr = { open: true, merged: false, mergeable: "clean" as string | null, body: "", title: "" };
  let commits = 0;
  const fail: { commit?: string; pr?: string } = {};
  const host: GitHost & PrHost = {
    async getRepo() { return { defaultBranch: "main", canPush: true }; },
    async isEmpty() { return false; },
    async listBranches() { return [...branches.keys()]; },
    async createBranch(name, from) { log.push(`branch ${name}`); branches.set(name, { ...branches.get(from)! }); },
    async getFile() { return null; },
    async getBlob() { return null; },
    async putFile() { throw new Error("not used"); },
    async getRef(b) { log.push(`ref ${b}`); return branches.has(b) ? "sha" : null; },
    async commitFiles({ branch, files }) {
      log.push(`commit ${branch} ${files.map((f) => f.path).join(",")}`);
      if (fail.commit) throw new Error(fail.commit);
      const tree = branches.get(branch)!;
      for (const f of files) { if (f.text === null) delete tree[f.path]; else tree[f.path] = f.text; }
      commits++;
      return { sha: `c${commits}`, url: "u" };
    },
    async createPullRequest(a) {
      log.push("pr create");
      if (fail.pr) throw new Error(fail.pr);
      pr.body = a.body; pr.title = a.title;
      return { number: 7, url: "https://github.com/acme/ds/pull/7" };
    },
    async getPullRequest(): Promise<PullRequestInfo> {
      log.push("pr get");
      return { number: 7, url: "u", state: pr.open ? "open" : "closed", merged: pr.merged, mergeableState: pr.mergeable };
    },
    async updatePullRequest(_n, c) { log.push("pr update"); if (c.body !== undefined) pr.body = c.body; },
    async updateBranch() { log.push("pr update-branch"); },
  };
  return { host, log, branches, pr, fail, commits: () => commits };
}

const ch = (path: string, before: string, after: string, sha: string | null = "s-" + path): Changed => ({ path, before, after, sha });
const input = (f: ReturnType<typeof fake>, work: WorkState | null, changed: Changed[], now = 1000) => ({
  host: f.host, base: "main", work, changed, title: "Changes from Motif",
  body: (paths: string[], note: string) => `${note}|${paths.join(",")}`,
  message: (n: number) => `Update ${n}`, now,
});

describe("plan", () => {
  it("sends what was never sent, keeps what is unchanged since, and puts back what is no longer changed", () => {
    const work: WorkState = {
      branch: "b", pr: null, note: "", syncedAt: 1,
      pushed: {
        "kept.tsx": { hash: hashText("K1"), original: { text: "K0", sha: "k" } },
        "undone.tsx": { hash: hashText("U1"), original: { text: "U0", sha: "u" } },
        "made.tsx": { hash: hashText("M1"), original: { text: "", sha: null } },
        "edited.tsx": { hash: hashText("E1"), original: { text: "E0", sha: "e" } },
      },
    };
    const p = plan([ch("kept.tsx", "K0", "K1"), ch("edited.tsx", "E0", "E2"), ch("fresh.tsx", "F0", "F1")], work);
    expect(p.inPr).toEqual(["kept.tsx"]);
    expect(p.push.map((f) => f.path)).toEqual(["edited.tsx", "fresh.tsx"]);
    // A file sent before keeps the original it had on the default branch, not what the branch held after the last sync.
    expect(p.push[0].original).toEqual({ text: "E0", sha: "e" });
    expect(p.restore).toEqual([{ path: "undone.tsx", text: "U0" }, { path: "made.tsx", text: null }]);
  });
});

describe("syncWork", () => {
  it("first sync: a branch, one commit, a pull request", async () => {
    const f = fake();
    const r = await syncWork(input(f, null, [ch("a.tsx", "A0", "A1")]));
    expect(f.log).toEqual([`branch ${branchName(1000)}`, `commit ${branchName(1000)} a.tsx`, "pr create"]);
    expect(f.branches.get(branchName(1000))!["a.tsx"]).toBe("A1");
    expect(f.branches.get("main")!["a.tsx"]).toBe("A0");
    expect(r.createdPr).toBe(true);
    expect(r.work).toMatchObject({ branch: branchName(1000), pr: { number: 7 }, syncedAt: 1000 });
    expect(r.work!.pushed["a.tsx"].original).toEqual({ text: "A0", sha: "s-a.tsx" });
  });

  it("second sync: one more commit on the same branch and a new description, no new pull request", async () => {
    const f = fake();
    const first = await syncWork(input(f, null, [ch("a.tsx", "A0", "A1")]));
    f.log.length = 0;
    const second = await syncWork(input(f, { ...first.work!, note: "hello" }, [ch("a.tsx", "A0", "A1"), ch("b.tsx", "B0", "B1")], 2000));
    expect(f.log).toEqual(["pr get", `ref ${branchName(1000)}`, `commit ${branchName(1000)} b.tsx`, "pr update"]);
    expect(second.createdPr).toBe(false);
    expect(second.sent).toEqual(["b.tsx"]);
    expect(f.commits()).toBe(2);
    expect(f.pr.body).toBe("hello|a.tsx,b.tsx");
  });

  it("makes no requests beyond reading the pull request when nothing is waiting", async () => {
    const f = fake();
    const first = await syncWork(input(f, null, [ch("a.tsx", "A0", "A1")]));
    f.log.length = 0;
    const again = await syncWork(input(f, first.work, [ch("a.tsx", "A0", "A1")]));
    expect(f.log).toEqual(["pr get"]);
    expect(again.sent).toEqual([]);
    expect(again.work).toBe(first.work);
  });

  it("does nothing at all when there is no work and nothing changed", async () => {
    const f = fake();
    const r = await syncWork(input(f, null, []));
    expect(f.log).toEqual([]);
    expect(r.work).toBeNull();
  });

  it("an undone edit puts the original back; a file made here is taken away", async () => {
    const f = fake();
    const first = await syncWork(input(f, null, [ch("a.tsx", "A0", "A1"), ch("new.tsx", "", "N1", null)]));
    const branch = first.work!.branch;
    expect(f.branches.get(branch)!["new.tsx"]).toBe("N1");
    const second = await syncWork(input(f, first.work, []));
    expect(f.branches.get(branch)!["a.tsx"]).toBe("A0");
    expect(f.branches.get(branch)!["new.tsx"]).toBeUndefined();
    expect(second.restored.sort()).toEqual(["a.tsx", "new.tsx"]);
    expect(second.work!.pushed).toEqual({});
    // The pull request stays open and its description follows.
    expect(f.pr.body).toBe("|");
  });

  it("a merged or closed pull request ends the cycle and adds nothing", async () => {
    const f = fake();
    const first = await syncWork(input(f, null, [ch("a.tsx", "A0", "A1")]));
    f.pr.open = false; f.pr.merged = true;
    f.log.length = 0;
    await expect(syncWork(input(f, first.work, [ch("b.tsx", "B0", "B1")]))).rejects.toMatchObject({ merged: true });
    f.pr.merged = false;
    const err = await syncWork(input(f, first.work, [ch("b.tsx", "B0", "B1")])).catch((e) => e);
    expect(err).toBeInstanceOf(WorkEnded);
    expect(err.merged).toBe(false);
    expect(f.log.every((l) => l === "pr get")).toBe(true);
  });

  it("starts the branch over when it was taken away before a pull request was opened", async () => {
    const f = fake();
    f.fail.pr = "nope";
    const failed = (await syncWork(input(f, null, [ch("a.tsx", "A0", "A1")])).catch((e) => e)) as SyncFailed;
    f.fail.pr = undefined;
    f.branches.delete(failed.work!.branch);
    const r = await syncWork(input(f, failed.work, [ch("a.tsx", "A0", "A1")], 3000));
    // The branch is made again and everything is sent again, because none of it is there.
    expect(f.branches.get(failed.work!.branch)!["a.tsx"]).toBe("A1");
    expect(r.sent).toEqual(["a.tsx"]);
    expect(r.createdPr).toBe(true);
  });

  it("a failed commit leaves the work as it was, with the branch kept", async () => {
    const f = fake();
    f.fail.commit = "moved";
    const err = (await syncWork(input(f, null, [ch("a.tsx", "A0", "A1")])).catch((e) => e)) as SyncFailed;
    expect(err).toBeInstanceOf(SyncFailed);
    expect(err.message).toBe("moved");
    expect(err.work).toMatchObject({ branch: branchName(1000), pr: null, pushed: {} });
    // The next sync goes on with that branch and sends everything.
    f.fail.commit = undefined;
    const r = await syncWork(input(f, err.work, [ch("a.tsx", "A0", "A1")], 2000));
    expect(r.work!.branch).toBe(branchName(1000));
    expect(r.createdPr).toBe(true);
  });

  it("a pull request that couldn't be opened leaves the files sent, and the next sync only opens it", async () => {
    const f = fake();
    f.fail.pr = "nope";
    const err = (await syncWork(input(f, null, [ch("a.tsx", "A0", "A1")])).catch((e) => e)) as SyncFailed;
    expect(err.work!.pr).toBeNull();
    expect(Object.keys(err.work!.pushed)).toEqual(["a.tsx"]);
    f.fail.pr = undefined;
    f.log.length = 0;
    const r = await syncWork(input(f, err.work, [ch("a.tsx", "A0", "A1")], 2000));
    expect(f.log).toEqual([`ref ${branchName(1000)}`, "pr create"]);
    expect(r.work!.pr!.number).toBe(7);
  });
});

describe("refreshWork and statusOf", () => {
  const work: WorkState = { branch: "b", pr: { number: 7, url: "u" }, pushed: { "a.tsx": { hash: hashText("A1"), original: { text: "A0", sha: "s" } } }, note: "", syncedAt: 1 };
  const base = { changed: [ch("a.tsx", "A0", "A1")], work, refreshed: { state: "open" as const, mergeableState: "clean" }, syncing: false, error: null, stale: 0 };

  it("reads the pull request's state", async () => {
    const f = fake();
    expect(await refreshWork(f.host, null)).toEqual({ state: "none", mergeableState: null });
    expect(await refreshWork(f.host, work)).toEqual({ state: "open", mergeableState: "clean" });
    f.pr.open = false; f.pr.merged = true;
    expect((await refreshWork(f.host, work)).state).toBe("merged");
    f.pr.merged = false;
    expect((await refreshWork(f.host, work)).state).toBe("closed");
  });

  it("says what is going on", () => {
    expect(statusOf({ ...base, changed: [], work: null, refreshed: null }).kind).toBe("none");
    expect(statusOf({ ...base, changed: [ch("b.tsx", "B0", "B1")], work: null, refreshed: null })).toMatchObject({ kind: "waiting", waiting: 1 });
    expect(statusOf(base)).toMatchObject({ kind: "synced", text: "In sync with pull request #7" });
    expect(statusOf({ ...base, changed: [ch("a.tsx", "A0", "A2")] }).kind).toBe("waiting");
    expect(statusOf({ ...base, syncing: true }).kind).toBe("syncing");
    expect(statusOf({ ...base, refreshed: { state: "open", mergeableState: "behind" } })).toMatchObject({ kind: "attention", reason: "behind" });
    expect(statusOf({ ...base, refreshed: { state: "open", mergeableState: "dirty" } })).toMatchObject({ kind: "attention", reason: "conflict" });
    expect(statusOf({ ...base, refreshed: { state: "closed", mergeableState: null } })).toMatchObject({ kind: "attention", reason: "closed" });
    expect(statusOf({ ...base, error: "boom" })).toMatchObject({ kind: "attention", reason: "error", text: "boom" });
    expect(statusOf({ ...base, stale: 2 })).toMatchObject({ kind: "attention", reason: "stale" });
  });
});
