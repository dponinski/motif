const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");

const { OUT } = require("./support/env");
const { FIXTURE } = require("./support/env");
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

  await seed(page, "docsr001");
  await page.goto("http://localhost:3000/editor/docsr001");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());

  await nav("Git");
  await page.getByRole("button", { name: "Scan" }).click();
  await page.getByText(/tokens · \d+ components/).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /(Re-import|Import) components/ }).click();
  await page.getByText(/Imported \d+ components/).waitFor();
  if (await gitOpen()) await nav("Git");
  await nav("Components");

  // The pointer is moved off the preview first: a button under it would show its hover color.
  const css = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const editButton = page.getByRole("button", { name: "Design", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });

  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const sidebar = page.locator("div.w-\\[220px\\]");
  const paper = page.locator(".motif-docs").first();
  const preview = (name) => page.frameLocator(`iframe[title="${name} preview"]`);

  await nav("Docs");
  await page.getByText("Documentation", { exact: true }).waitFor();
  check("each imported component has a page, under its own heading", (await page.getByText("Repository components", { exact: true }).count()) === 1 && (await sidebar.getByRole("button", { name: "Button", exact: true }).count()) === 1);
  await sidebar.getByRole("button", { name: "Button", exact: true }).click();
  await paper.locator("h1").waitFor();
  check("the page is named after the component", (await paper.locator("h1").innerText()) === "Button");

  // ── The live preview ─────────────────────────────────────────────────────
  await preview("Button").locator("#root button").first().waitFor({ timeout: 60000 });
  check("it shows the component running, every variant of it", await settle(async () => (await preview("Button").locator("#root button").count()) === 20));
  const bg = await preview("Button").locator("#root button").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("with the repository's own styles", bg.startsWith("oklch(0.52"), bg);
  check("in a frame that can't reach Motif", (await page.locator('iframe[title="Button preview"]').getAttribute("sandbox")) === "allow-scripts");
  check("sized to what it shows", await settle(async () => (await page.locator('iframe[title="Button preview"]').evaluate((el) => el.getBoundingClientRect().height)) > 150));
  await page.screenshot({ path: `${OUT}/docsr-page.png` });

  // ── Props and usage ──────────────────────────────────────────────────────
  const ths = (await paper.locator("table th").allInnerTexts()).join();
  const chips = await paper.locator("table code.md-chip", { hasText: "danger" }).count();
  const loading = await paper.locator("table td code", { hasText: /^loading$/ }).count();
  check("the props table lists the props, the options of variants among them", ths.replace(/\s/g, "").toLowerCase() === "prop,type,default,description" && chips >= 1 && loading === 1, JSON.stringify({ ths, chips, loading }));
  check("the usage shows how to import and use it", (await paper.locator("pre").innerText()).includes('import { Button } from "./src/components/Button";') && (await paper.locator("pre").innerText()).includes("// variant: primary | secondary | outline | ghost | danger (default primary)"));

  // ── Changing a block ─────────────────────────────────────────────────────
  const block = paper.locator(".md-block", { has: page.locator('iframe[title="Button preview"]') });
  // A block's controls show while the pointer is over it, and the page moves under a pointer that stays still (a preview that is loading
  // changes the block's height, which can leave the pointer outside it). So the pointer is put over the block and the control used as
  // one attempt, and tried again if the control went before it was used.
  const pick = async (box, label, option) => {
    let last = null;
    for (let i = 0; i < 20; i++) {
      await box.hover();
      try { await box.getByLabel(label).selectOption(option, { timeout: 1500 }); return; } catch (e) { last = e; }
    }
    throw last;
  };
  await pick(block, "Preview shows", "single");
  check("a preview can show one instead of every variant", await settle(async () => (await preview("Button").locator("#root button").count()) === 1));
  await pick(block, "Repository component", { label: "Badge" });
  check("or another component", await settle(async () => (await page.locator('iframe[title="Badge preview"]').count()) === 1));
  await preview("Badge").locator("#root span.rounded-full").waitFor({ timeout: 60000 });

  // ── A page of one's own can use them too ─────────────────────────────────
  await page.locator('button[title="New page"]').click();
  await paper.getByLabel("Page title").fill("Buttons in use");
  await paper.getByRole("button", { name: "Add block" }).click();
  await page.getByRole("menuitem", { name: "Component preview" }).click();
  const added = paper.locator(".md-block").nth(1);
  check("a block can be added to any page, for any imported component", (await added.count()) === 1);
  await pick(added, "Repository component", { label: "Alert" });
  await pick(added, "Preview shows", "variants");
  check("and it runs", await settle(async () => (await page.locator('iframe[title="Alert preview"]').count()) === 1));
  await page.screenshot({ path: `${OUT}/docsr-own-page.png` });

  // ── Preview mode and export ──────────────────────────────────────────────
  await page.getByRole("button", { name: "preview" }).click();
  const site = page.frameLocator('iframe[title="Documentation preview"]');
  await site.locator("article").first().waitFor();
  await site.locator("article[id='doc-repo-src/components/Alert.tsx::Alert']").waitFor();
  await site.locator("nav a", { hasText: /^Alert$/ }).first().click();
  check("the site as it will be exported shows the live component", await settle(async () => (await site.frameLocator("article[id='doc-repo-src/components/Alert.tsx::Alert'] iframe[data-md-live]").locator("#root [role]").count()) >= 4, 60000));
  await page.screenshot({ path: `${OUT}/docsr-preview.png` });

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Export HTML/ }).click()]);
  const html = fs.readFileSync(await download.path(), "utf8");
  fs.writeFileSync(`${OUT}/docsr-site.html`, html);
  check("the export has live previews that carry their own runtime", html.includes("data-md-live") && html.includes('sandbox=&quot;') === false && html.includes('sandbox="allow-scripts"') && html.includes("createRegistry") && !/src=&quot;[^&]*motif-preview-runtime/.test(html) && !/<script[^>]*src="[^"]*motif-preview-runtime/.test(html));
  check("and not a script of the page's own besides the one that sizes them", (html.match(/<script>/g) ?? []).length === 1);
  check("it says nothing about Motif's origin, so it works anywhere", !html.includes("localhost:3000"));

  const exported = await context.newPage();
  await exported.goto(`file://${OUT}/docsr-site.html`);
  const live = exported.frameLocator("article[id='doc-repo-src/components/Alert.tsx::Alert'] iframe[data-md-live]");
  await live.locator("#root [role]").first().waitFor({ timeout: 60000 });
  check("the exported file runs the component by itself", (await live.locator("#root [role]").count()) === 4);
  check("and sizes each preview to it", await (async () => { for (let i = 0; i < 60; i++) { const frameH = await exported.locator("article[id='doc-repo-src/components/Alert.tsx::Alert'] iframe[data-md-live]").evaluate((el) => el.getBoundingClientRect().height); const rootH = await live.locator("#root").evaluate((el) => el.getBoundingClientRect().height); if (Math.abs(frameH - Math.max(rootH, 40)) <= 2) return true; await exported.waitForTimeout(100); } return false; })());
  await exported.screenshot({ path: `${OUT}/docsr-export.png` });
  await exported.close();

  const real = errors.filter((e) => !/hydrat|must be used inside/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
