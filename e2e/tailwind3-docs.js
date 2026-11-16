const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");
const { gitData } = require("./support/git-data");
const { openSync, syncNow } = require("./support/sync-helpers");

const { OUT } = require("./support/env");
const { FIXTURE_V3 } = require("./support/env");
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

const design = loadDir(FIXTURE_V3);
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
design["src/components/Promo.tsx"] = [
  'export function Promo() {',
  '  return (',
  '    <div className="flex flex-col gap-[18px] rounded-[8px] bg-[oklch(0.52_0.21_270)] p-[16px] text-[15px] shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04),0_1px_3px_0_rgb(0_0_0_/_0.06)]">',
  '      <h3 className="text-lg font-semibold text-white">Promo</h3>',
  '      <p className="text-red-500">Body</p>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
design["src/index.ts"] += '\nexport { Promo } from "./components/Promo";\n';
// An element with values written out where a token could be.
design["src/components/Chip.tsx"] = [
  'export function Chip() {',
  '  return (',
  '    <div className="flex flex-col gap-2 rounded-[10px] bg-[#1d4ed8] p-[13.5px] text-[#1d4ed8]">',
  '      <span>Chip</span>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
design["src/index.ts"] += '\nexport { Chip } from "./components/Chip";\n';
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
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

  await seed(page, "tw3docs1");
  await page.goto("http://localhost:3000/editor/tw3docs1");
  await page.getByText("Layers", { exact: true }).waitFor();
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());

  await componentsReady(page);

  // ── A documentation page shows the component, styled ──────────────────────
  await nav("Docs");
  await page.getByText("Documentation", { exact: true }).waitFor();
  const sidebar = page.locator("div.w-\\[220px\\]");
  const paper = page.locator(".motif-docs").first();
  const preview = (name) => page.frameLocator(`iframe[title="${name} preview"]`);
  await sidebar.getByRole("button", { name: "Button", exact: true }).click();
  await paper.locator("h1").waitFor();
  await preview("Button").locator("#root button").first().waitFor({ timeout: 90000 });
  check("the page shows every variant running, not refused", await settle(async () => (await preview("Button").locator("#root button").count()) === 20, 30000));
  check("with no engine in it: it carries a stylesheet built beforehand", await (async () => {
    const doc = await page.locator('iframe[title="Button preview"]').getAttribute("srcdoc");
    return doc.includes('id="motif-tw3">') && !/src="[^"]*motif-tailwind3/.test(doc) && /\.bg-primary\s*\{/.test(doc);
  })(), await page.locator('iframe[title="Button preview"]').getAttribute("srcdoc").then((d) => JSON.stringify({ tw3: d.includes('id="motif-tw3">'), eng: d.includes("motif-tailwind3.js"), bg: /\.bg-primary\s*\{/.test(d), at: d.indexOf("motif-tw3"), s: d.slice(d.indexOf("motif-tw3") - 20, d.indexOf("motif-tw3") + 80) })));
  const bg = await preview("Button").locator("#root button").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const radius = await preview("Button").locator("#root button").first().evaluate((el) => getComputedStyle(el).borderRadius);
  check("in the repository's colors and radius", bg === "rgb(15, 23, 42)" && radius === "8px", `${bg} ${radius}`);
  await page.screenshot({ path: `${OUT}/tailwind3-docs.png` });

  // ── The exported site runs by itself ──────────────────────────────────────
  await page.getByRole("button", { name: "preview" }).click();
  const site = page.frameLocator('iframe[title="Documentation preview"]');
  await site.locator("article").first().waitFor();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Export HTML/ }).click()]);
  const html = fs.readFileSync(await download.path(), "utf8");
  fs.writeFileSync(`${OUT}/tailwind3-docs-site.html`, html);
  check("the export carries no engine file and no address of Motif's", !/src=[^>]*motif-tailwind3/.test(html) && !html.includes("localhost:3000"), JSON.stringify({ eng: html.includes("motif-tailwind3.js"), host: html.includes("localhost:3000"), at: html.indexOf("localhost:3000"), s: html.slice(html.indexOf("localhost:3000") - 80, html.indexOf("localhost:3000") + 60) }));

  const exported = await context.newPage();
  await exported.goto(`file://${OUT}/tailwind3-docs-site.html`);
  const live = exported.frameLocator("iframe[data-md-live]").first();
  await live.locator("#root > *").first().waitFor({ timeout: 90000 });
  const exportedBg = await live.locator("body").evaluate(() => `${getComputedStyle(document.body).fontFamily} | ${document.querySelectorAll("#root *").length}`);
  check("the exported file shows the component styled, by itself", /Inter/.test(exportedBg) && !/\| 0$/.test(exportedBg), exportedBg);
  await exported.screenshot({ path: `${OUT}/tailwind3-docs-export.png` });
  await exported.close();

  // ── A new component in this repository is made of Tailwind classes ────────
  await nav("Components");
  await page.getByRole("button", { name: /New component/ }).first().click().catch(() => {});
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    check("it says it is styled with Tailwind classes, with no stylesheet beside it", (await dialog.innerText()).includes("Styled with Tailwind classes") && !(await dialog.innerText()).includes(".css"));
    await page.keyboard.press("Escape");
  } else {
    check("a new component can be started (the dialog opened)", false);
  }

  const real = errors.filter((e) => !/hydrat|must be used inside/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
