// A fake GitHub for the browser suites: branches as commits that point at trees, the Git Data calls, contents,
// pull requests (create, read, update, update-branch). `repo.mergeable` sets what a pull request reports.
const crypto = require("crypto");
const blobSha = (text) => {
  const body = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};

function createFake({ owner = "acme", name, files, token = "t", empty = false }) {
  const trees = new Map();
  const commits = new Map();
  const heads = new Map();
  let n = 0;
  const mkTree = (map) => { const sha = `tree${++n}`; trees.set(sha, new Map(map)); return sha; };
  const mkCommit = (tree, message, parent) => { const sha = `commit${++n}`; commits.set(sha, { tree, message, parent }); return sha; };
  // An empty repository has no commits at all until the first file is written straight to the default branch.
  if (!empty) heads.set("main", mkCommit(mkTree(new Map(Object.entries(files))), "initial", null));
  const repo = { prs: [], commitLog: [], writes: [], calls: [], mergeable: "clean", failNext: null };
  const filesOf = (b) => (heads.has(b) ? trees.get(commits.get(heads.get(b)).tree) : undefined);
  const setFiles = (b, map) => heads.set(b, mkCommit(mkTree(map), "set", heads.get(b)));
  const api = {
    repo,
    files: filesOf,
    branches: () => [...heads.keys()],
    // Someone else changes a file on the default branch.
    push(branch, path, text) { const m = new Map(filesOf(branch)); m.set(path, text); setFiles(branch, m); },
    merge(number) {
      const pr = repo.prs[number - 1];
      setFiles(pr.base, new Map(filesOf(pr.head)));
      pr.merged = true; pr.state = "closed";
    },
    close(number) { repo.prs[number - 1].state = "closed"; },
    blobSha,
    async handler(route) {
      const req = route.request();
      const url = new URL(req.url());
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "x-ratelimit-remaining" };
      const json = (status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const m = url.pathname.match(new RegExp(`^/repos/${owner}/${name}(/.*)?$`));
      if (!m) return json(404, { message: "Not Found" });
      const rest = decodeURIComponent(m[1] ?? "");
      const method = req.method();
      if ((req.headers()["authorization"] ?? "") !== `Bearer ${token}`) return json(401, { message: "Bad credentials" });
      repo.calls.push(`${method} ${rest}`);
      if (repo.failNext && repo.failNext.test(`${method} ${rest}`)) { const f = repo.failNext; repo.failNext = null; return json(f.status ?? 500, { message: "Simulated failure" }); }
      if (rest === "") return json(200, { default_branch: "main", permissions: { push: true } });
      if (empty && !heads.has("main")) {
        if (rest === "/branches") return json(200, []);
        if (rest.startsWith("/git/")) return json(409, { message: "Git Repository is empty." });
        if (rest.startsWith("/contents/") && method === "PUT") {
          const body = req.postDataJSON();
          if (body.branch || body.sha) return json(422, { message: "Branch main not found" });
          const file = rest.slice(10);
          const text = Buffer.from(body.content, "base64").toString("utf8");
          heads.set("main", mkCommit(mkTree(new Map([[file, text]])), "Initial commit", null));
          repo.writes.push({ file, branch: "main", first: true });
          return json(201, { content: { sha: blobSha(text) }, commit: { html_url: `https://github.com/${owner}/${name}/commit/1` } });
        }
        return json(404, { message: "Not Found" });
      }
      if (rest === "/branches") return json(200, [...heads.keys()].map((b) => ({ name: b })));
      if (rest.startsWith("/git/ref/heads/")) {
        const b = rest.slice(15);
        return heads.has(b) ? json(200, { object: { sha: heads.get(b) } }) : json(404, { message: "Not Found" });
      }
      if (rest.startsWith("/git/commits/") && method === "GET") {
        const c = commits.get(rest.slice(13));
        return c ? json(200, { sha: rest.slice(13), tree: { sha: c.tree } }) : json(404, { message: "Not Found" });
      }
      if (rest === "/git/trees" && method === "POST") {
        const body = req.postDataJSON();
        const map = new Map(trees.get(body.base_tree));
        for (const t of body.tree) { if (t.sha === null) map.delete(t.path); else map.set(t.path, t.content); }
        return json(201, { sha: mkTree(map) });
      }
      if (rest === "/git/commits" && method === "POST") {
        const body = req.postDataJSON();
        const sha = mkCommit(body.tree, body.message, body.parents[0]);
        return json(201, { sha });
      }
      if (rest.startsWith("/git/refs/heads/") && method === "PATCH") {
        const b = rest.slice(16);
        const body = req.postDataJSON();
        // Only forward: the new commit must be a child of the current head.
        if (commits.get(body.sha)?.parent !== heads.get(b)) return json(422, { message: "Update is not a fast forward" });
        heads.set(b, body.sha);
        repo.commitLog.push({ branch: b, message: commits.get(body.sha).message, files: [...trees.get(commits.get(body.sha).tree).keys()] });
        return json(200, { object: { sha: body.sha } });
      }
      if (rest.startsWith("/git/trees/")) {
        const b = rest.slice(11).split("?")[0];
        const t = heads.has(b) ? filesOf(b) : commits.has(b) ? trees.get(commits.get(b).tree) : trees.get(b);
        return t ? json(200, { truncated: false, tree: [...t.keys()].map((p) => ({ path: p, type: "blob" })) }) : json(404, { message: "Not Found" });
      }
      if (rest === "/git/refs" && method === "POST") {
        const body = req.postDataJSON();
        heads.set(body.ref.replace("refs/heads/", ""), body.sha);
        return json(201, {});
      }
      if (rest.startsWith("/contents/")) {
        const file = rest.slice(10);
        if (method === "PUT") {
          const body = req.postDataJSON();
          const tree = new Map(filesOf(body.branch));
          const current = tree.get(file);
          if ((current === undefined ? undefined : blobSha(current)) !== body.sha) return json(422, { message: `${file} does not match ${body.sha}` });
          tree.set(file, Buffer.from(body.content, "base64").toString("utf8"));
          setFiles(body.branch, tree);
          repo.writes.push({ file, branch: body.branch, isNew: current === undefined });
          return json(200, { content: { sha: blobSha(tree.get(file)) }, commit: { html_url: `https://github.com/${owner}/${name}/commit/2` } });
        }
        const text = filesOf(url.searchParams.get("ref"))?.get(file);
        return text === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: blobSha(text), content: Buffer.from(text).toString("base64"), encoding: "base64" });
      }
      if (rest === "/pulls" && method === "POST") {
        const body = req.postDataJSON();
        const pr = { number: repo.prs.length + 1, ...body, state: "open", merged: false };
        repo.prs.push(pr);
        return json(201, { number: pr.number, html_url: `https://github.com/${owner}/${name}/pull/${pr.number}` });
      }
      const pull = rest.match(/^\/pulls\/(\d+)(\/update-branch)?$/);
      if (pull) {
        const pr = repo.prs[Number(pull[1]) - 1];
        if (!pr) return json(404, { message: "Not Found" });
        if (pull[2] && method === "PUT") { repo.updated = (repo.updated ?? 0) + 1; repo.mergeable = "clean"; return json(202, { message: "Updating pull request branch." }); }
        if (method === "PATCH") { Object.assign(pr, req.postDataJSON()); return json(200, {}); }
        return json(200, { number: pr.number, html_url: `https://github.com/${owner}/${name}/pull/${pr.number}`, state: pr.state, merged: pr.merged, mergeable_state: pr.state === "open" ? repo.mergeable : "unknown" });
      }
      return json(404, { message: "Not Found" });
    },
  };
  return api;
}
module.exports = { createFake, blobSha };
