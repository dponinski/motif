// The Git Data calls (commits, trees, moving a branch) and a pull request update, for the older suites' fake GitHubs,
// whose branches are `branches[name] = Map(path -> text)` and whose branch heads are `commit:<name>`.
const trees = new Map();
const commits = new Map();
let n = 0;
function gitData({ rest, method, req, branches, prs, json }) {
  let m;
  if ((m = rest.match(/^\/git\/commits\/commit:(.+)$/)) && method === "GET") return branches[m[1]] ? json(200, { sha: `commit:${m[1]}`, tree: { sha: `tree:${m[1]}` } }) : json(404, { message: "Not Found" });
  if (rest === "/git/trees" && method === "POST") {
    const body = req.postDataJSON();
    const base = body.base_tree.replace("tree:", "");
    const map = new Map(branches[base] ?? trees.get(body.base_tree));
    for (const t of body.tree) { if (t.sha === null) map.delete(t.path); else map.set(t.path, t.content); }
    const sha = `tree:new${++n}`;
    trees.set(sha, map);
    return json(201, { sha });
  }
  if (rest === "/git/commits" && method === "POST") {
    const body = req.postDataJSON();
    const sha = `commit:new${++n}`;
    commits.set(sha, { tree: body.tree, parent: body.parents[0], message: body.message });
    return json(201, { sha });
  }
  if ((m = rest.match(/^\/git\/refs\/heads\/(.+)$/)) && method === "PATCH") {
    const body = req.postDataJSON();
    const c = commits.get(body.sha);
    if (!c || c.parent !== `commit:${m[1]}`) return json(422, { message: "Update is not a fast forward" });
    branches[m[1]] = new Map(trees.get(c.tree));
    return json(200, { object: { sha: body.sha } });
  }
  if ((m = rest.match(/^\/pulls\/(\d+)$/)) && method === "PATCH") {
    Object.assign(prs[Number(m[1]) - 1], req.postDataJSON());
    return json(200, {});
  }
  return null;
}
module.exports = { gitData };
