import { afterAll, describe, expect, it } from "vitest";
import { createGitHubClient, GitHostError, gitBlobSha } from "./github";

// Motif's GitHub client against the real GitHub, not a stand-in. Everything else is tested against stand-ins, which can only be as right
// as what they were written from; this is where that is checked.
//
// It does nothing unless asked:
//
//   LIVE_GITHUB_REPO=owner/name LIVE_GITHUB_TOKEN=... npm run live:github
//
// The token needs to push to the repository (a fine-grained token with Contents and Pull requests write); without one, requests are made
// as anyone is, which is for a place that adds the credentials itself. It works on a branch of its
// own, `motif-live-check/<time>`, and takes it away when it is done (a pull request it opens is closed first). Set LIVE_GITHUB_PR=0 to
// leave the pull request part out, which is what starts a CI run on the repository. Nothing is written to the default branch.
const repoName = process.env.LIVE_GITHUB_REPO;
const token = process.env.LIVE_GITHUB_TOKEN ?? "";
const live = !!repoName;
const withPr = process.env.LIVE_GITHUB_PR !== "0";
const [owner = "", repo = ""] = (repoName ?? "/").split("/");

const api = (path: string, init?: RequestInit) =>
  fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, { ...init, headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-GitHub-Api-Version": "2022-11-28", ...(init?.headers ?? {}) } });

describe.skipIf(!live)(`GitHub client against ${repoName}`, () => {
  const client = createGitHubClient({ owner, repo, token });
  const scratch = `motif-live-check/${Date.now().toString(36)}`;
  let base = "main";
  let baseSha = "";
  let pr: number | null = null;

  afterAll(async () => {
    if (pr !== null) await api(`/pulls/${pr}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) }).catch(() => undefined);
    await api(`/git/refs/heads/${scratch}`, { method: "DELETE" }).catch(() => undefined);
  }, 30_000);

  it("reads the repository, its branches and its tree", async () => {
    const info = await client.getRepo();
    expect(info.defaultBranch).toMatch(/\S/);
    expect(info.canPush).toBe(true);
    base = info.defaultBranch;
    expect(await client.isEmpty()).toBe(false);
    expect(await client.listBranches()).toContain(base);
    const tree = await client.listTree(base);
    expect(tree.paths.length).toBeGreaterThan(0);
    expect(tree.truncated).toBe(false);
    const sha = await client.getRef(base);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    baseSha = sha!;
    expect(await client.getRef(`no-such-branch-${Date.now()}`)).toBeNull();
  }, 30_000);

  it("reads a file, and the blob it is, the way git hashes it", async () => {
    const tree = await client.listTree(base);
    const path = tree.paths.find((p) => p === "package.json") ?? tree.paths.find((p) => /\.(md|json|ts)$/.test(p))!;
    const file = await client.getFile(path, base);
    expect(file).not.toBeNull();
    // The sha GitHub gives is the one a file with that text has: it is what stale edits are noticed by.
    expect(await gitBlobSha(file!.text)).toBe(file!.sha);
    expect(await client.getBlob(file!.sha)).toBe(file!.text);
    expect(await client.readText(path, base)).toBe(file!.text);
    expect(await client.getFile(`no/such/file-${Date.now()}.txt`, base)).toBeNull();
    expect(await client.getBlob("0".repeat(40))).toBeNull();
  }, 30_000);

  it("makes a branch, and puts several files in one commit on it", async () => {
    await client.createBranch(scratch, base);
    expect(await client.getRef(scratch)).toBe(baseSha);
    expect(await client.listBranches()).toContain(scratch);

    const text = "日本語 🎨 line two\nline three\n";
    const out = await client.commitFiles({
      branch: scratch,
      message: "Live check [skip ci]",
      files: [{ path: ".motif-live-check/a.txt", text }, { path: ".motif-live-check/b/c.css", text: ".a { color: red }\n" }],
    });
    expect(out.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(out.url).toContain(out.sha);
    expect(await client.getRef(scratch)).toBe(out.sha);
    expect((await client.getFile(".motif-live-check/a.txt", scratch))?.text).toBe(text);
    expect((await client.getFile(".motif-live-check/b/c.css", scratch))?.text).toBe(".a { color: red }\n");
    // It was one commit on top of where the branch started.
    const commit = await (await api(`/git/commits/${out.sha}`)).json() as { parents: { sha: string }[] };
    expect(commit.parents.map((p) => p.sha)).toEqual([baseSha]);

    // A file taken away, in the same way.
    const gone = await client.commitFiles({ branch: scratch, message: "Live check, remove [skip ci]", files: [{ path: ".motif-live-check/b/c.css", text: null }] });
    expect(await client.getFile(".motif-live-check/b/c.css", scratch)).toBeNull();
    expect((await client.getFile(".motif-live-check/a.txt", scratch))?.text).toBe(text);
    expect(gone.sha).not.toBe(out.sha);
  }, 60_000);

  it("calls a write over a file that has moved on stale", async () => {
    const file = await client.getFile(".motif-live-check/a.txt", scratch);
    const first = await client.putFile({ path: ".motif-live-check/a.txt", branch: scratch, text: "one\n", message: "Live check, one [skip ci]", sha: file!.sha });
    expect(first.sha).toMatch(/^[0-9a-f]{40}$/);
    // The same write again, from the version that was read before: the file is not at that version any more.
    const error = await client.putFile({ path: ".motif-live-check/a.txt", branch: scratch, text: "two\n", message: "Live check, two [skip ci]", sha: file!.sha }).catch((e) => e);
    expect(error).toBeInstanceOf(GitHostError);
    expect((error as GitHostError).isStale).toBe(true);
  }, 60_000);

  it.skipIf(!withPr)("opens a pull request, reads it, edits it, and says what the branch can do", async () => {
    const made = await client.createPullRequest({ title: "Motif live check (will be closed)", body: "Opened by Motif's live check, and closed straight away.", head: scratch, base });
    pr = made.number;
    expect(made.url).toContain(`/pull/${made.number}`);

    let info = await client.getPullRequest(made.number);
    expect(info).toMatchObject({ number: made.number, state: "open", merged: false });
    // GitHub works out whether it can be merged in its own time: "unknown" first.
    for (let i = 0; i < 10 && (!info.mergeableState || info.mergeableState === "unknown"); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      info = await client.getPullRequest(made.number);
    }
    expect(["clean", "unstable", "blocked", "behind", "has_hooks"]).toContain(info.mergeableState);

    await client.updatePullRequest(made.number, { title: "Motif live check, renamed (will be closed)", body: "Changed." });
    const reread = await (await api(`/pulls/${made.number}`)).json() as { title: string; body: string };
    expect(reread.title).toBe("Motif live check, renamed (will be closed)");
    expect(reread.body).toBe("Changed.");

    // With nothing new on the base branch there is nothing to bring in; what that says is what the Sync panel will be told.
    const behind = await client.updateBranch(made.number).then(() => null, (e) => e);
    if (behind) expect(behind).toBeInstanceOf(GitHostError);
  }, 120_000);
});
