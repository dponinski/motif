// The canvas loads the Google Fonts that Motif's tokens use, whether or not the tokens are shown on it: a text style with a Google font is
// made on the Tokens screen, and the preview of a component has the stylesheet that asks Google for it.
const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");
const { gitData } = require("./support/git-data");

const { OUT } = require("./support/env");
const { FIXTURE } = require("./support/env");
const { withoutConversion } = require("./support/conversion");
const blobSha = (text) => {
  const body = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};
function loadDir(dir, prefix = "") {
  const files = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) Object.assign(files, loadDir(path.join(dir, e.name), `${prefix}${e.name}/`));
    else files[`${prefix}${e.name.replace(/\.fixture$/, "")}`] = fs.readFileSync(path.join(dir, e.name), "utf8");
  }
  return files;
}

const design = loadDir(FIXTURE);
// A component made of plain elements and text, to edit text and structure with.
design["src/components/Banner.tsx"] = [
  'export function Banner() {',
  '  return (',
  '    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border">',
  '      <h2 className="text-lg font-semibold">Hello</h2>',
  '      <p className="text-sm text-muted-foreground">World</p>',
  '      <small className="text-xs">Footnote</small>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
design["src/index.ts"] += '\nexport { Banner } from "./components/Banner";\n';
design["src/components/Card.tsx"] = [
  'export function Card() {',
  '  return (',
  '    <div className="flex flex-col gap-2 p-4 bg-white rounded-lg border border-gray-200 shadow-sm w-64">',
  '      <h2 className="text-lg font-semibold text-gray-900">Title</h2>',
  '      <p className="text-sm text-gray-500">Body</p>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
// Styled by a stylesheet, in a repository that uses Tailwind.
design["src/components/Plain.tsx"] = 'import "./Plain.css";\nexport function Plain() { return <div className="plain-box"><span className="plain-text">Plain</span></div>; }\n';
design["src/components/Plain.css"] = ".plain-box { display: flex; padding: 8px; background: #eee; }\n.plain-text { font-size: 14px; color: #333; }\n";
// Styled by its own style attribute.
design["src/components/Inline.tsx"] = 'export function Inline() { return <div className="flex"><span style={{ fontSize: 14, color: "#333" }}>Inline</span></div>; }\n';
// Classes that depend on a condition.
design["src/components/Cn.tsx"] = 'import { cn } from "../lib/cn";\nexport function Cn({ active = false }) { return <div className="flex p-2"><span className={cn("text-sm", active ? "font-bold" : "font-normal", active && "text-red-500")}>Cn</span></div>; }\n';
design["src/index.ts"] += '\nexport { Card } from "./components/Card";\nexport { Plain } from "./components/Plain";\nexport { Inline } from "./components/Inline";\nexport { Cn } from "./components/Cn";\n';

const repos = { "acme/ds": { main: new Map(Object.entries(design)) } };
const prs = [];

async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "x-ratelimit-remaining" };
  const json = (status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

  const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const branches = m && repos[m[1]];
  if (!branches) return json(404, { message: "Not Found" });
  const token = (req.headers()["authorization"] ?? "").replace("Bearer ", "");
  if (token && token !== "t" && token !== "ro") return json(401, { message: "Bad credentials" });
  const rest = decodeURIComponent(m[2] ?? "");
  const method = req.method();
  

  if (rest === "") return json(200, { default_branch: "main", permissions: { push: Boolean(token) } });
  if (rest === "/branches") return json(200, Object.keys(branches).map((name) => ({ name })));
  const gd = gitData({ rest, method, req, branches, prs, json });
  if (gd) return gd;
  if (rest.startsWith("/git/ref/heads/")) {
    const b = rest.slice(15);
    return branches[b] ? json(200, { object: { sha: `commit:${b}` } }) : json(404, { message: "Not Found" });
  }
  if (rest.startsWith("/git/trees/")) {
    const b = rest.slice(11).split("?")[0].replace("commit:", "");
    return branches[b] ? json(200, { truncated: false, tree: [...branches[b].keys()].map((p) => ({ path: p, type: "blob" })) }) : json(404, { message: "Not Found" });
  }
  if (rest === "/git/refs" && method === "POST") {
    const body = req.postDataJSON();
    const from = body.sha.replace("commit:", "");
    branches[body.ref.replace("refs/heads/", "")] = new Map(branches[from]);
    return json(201, {});
  }
  if (rest.startsWith("/contents/")) {
    const file = rest.slice(10);
    if (method === "PUT") {
      const body = req.postDataJSON();
      const tree = branches[body.branch];
      const current = tree.get(file);
      if ((current === undefined ? undefined : blobSha(current)) !== body.sha) return json(409, { message: `${file} does not match ${body.sha}` });
      tree.set(file, Buffer.from(body.content, "base64").toString("utf8"));
      return json(200, { content: { sha: blobSha(tree.get(file)) }, commit: { html_url: "https://github.com/commit/1" } });
    }
    const text = branches[url.searchParams.get("ref")]?.get(file);
    return text === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: blobSha(text), content: Buffer.from(text).toString("base64"), encoding: "base64" });
  }
  if (rest === "/pulls" && method === "POST") {
    if (token === "ro") return json(403, { message: "Resource not accessible by personal access token" });
    const body = req.postDataJSON();
    const pr = { number: prs.length + 1, repo: m[1], ...body, state: "open", merged: false };
    prs.push(pr);
    return json(201, { number: pr.number, html_url: `https://github.com/${m[1]}/pull/${pr.number}` });
  }
  const pull = rest.match(/^\/pulls\/(\d+)$/);
  if (pull) {
    const pr = prs[Number(pull[1]) - 1];
    return json(200, { number: pr.number, html_url: `https://github.com/${pr.repo}/pull/${pr.number}`, state: pr.state, merged: pr.merged });
  }
  return json(404, { message: "Not Found" });
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", github);
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });
  await context.route(/fonts\.googleapis\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "/* fake */" }));

  await seed(page, "fntcnv01");
  await page.goto("http://localhost:3000/editor/fntcnv01");
  await page.getByText("Layers", { exact: true }).waitFor();
  await componentsReady(page);
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const overrides = () => stage.locator("style#motif-overrides").evaluate((el) => el.textContent).catch(() => null);
  const until = async (read, want, ms = 20000) => { const end = Date.now() + ms; let got; while (Date.now() < end) { got = await read(); if (want(got)) return got; await page.waitForTimeout(100); } return got; };
  const openCard = async () => { const row = page.locator("aside button[title*='src/']").filter({ hasText: /^Card$/ }); if (!(await row.isVisible())) await page.locator('nav button[title="Components"]').click(); await row.click(); await stage.locator("#root h2").getByText("Title", { exact: true }).waitFor({ timeout: 60000 }); };

  await openCard();
  check("a component's preview asks for no font while no token uses one", (await until(overrides, (t) => t !== null)) !== null && !/googleapis/.test((await overrides()) ?? ""));

  // A text style, made on the Tokens screen, with a Google font as its family.
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();
  await page.getByRole("button", { name: "New token" }).click();
  await page.getByRole("menuitem", { name: /^Typography/ }).click();
  const addRow = page.locator("[data-add-row]");
  await addRow.getByLabel("New text style name").fill("display");
  await addRow.getByLabel("New text style size").fill("32");
  await addRow.getByLabel("New text style size").press("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit display", exact: true }).click();
  await page.getByRole("button", { name: "Browse fonts for Family of display" }).click();
  await page.getByLabel("Search fonts").fill("playfair");
  await page.getByRole("list", { name: "Google Fonts" }).locator('[data-font="Playfair Display"]').click();

  await page.locator('nav button[title="Components"]').click();
  await stage.locator("#root h2").getByText("Title", { exact: true }).waitFor({ timeout: 60000 });
  const text = await until(overrides, (t) => /Playfair/.test(t ?? ""));
  check("once a text style uses a Google font, the preview loads it", /^@import url\("https:\/\/fonts\.googleapis\.com\/css\?family=Playfair\+Display:[\d,]+&display=swap"\);/.test(text ?? ""), text);

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
