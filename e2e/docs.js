const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const { seed } = require("./support/seed");

const { OUT } = require("./support/env");
const blobSha = (text) => {
  const body = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};

// ── Fake GitHub (single branch) ──────────────────────────────────────────────
const tree = new Map();
const blobs = new Map();
const commit = (path, text) => { tree.set(path, text); blobs.set(blobSha(text), text); };
async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (status, body) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  const path = decodeURIComponent(url.pathname.replace("/repos/acme/web", ""));
  if (path === "") return json(200, { default_branch: "main", permissions: { push: true } });
  if (path === "/branches") return json(200, [{ name: "main" }]);
  if (path.startsWith("/git/blobs/")) {
    const text = blobs.get(path.slice(11));
    return text === undefined ? json(404, {}) : json(200, { content: Buffer.from(text).toString("base64"), encoding: "base64" });
  }
  if (path.startsWith("/contents/")) {
    const file = path.slice(10);
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      const current = tree.get(file);
      if ((current === undefined ? undefined : blobSha(current)) !== body.sha) return json(409, { message: "sha mismatch" });
      const text = Buffer.from(body.content, "base64").toString("utf8");
      commit(file, text);
      return json(200, { content: { sha: blobSha(text) }, commit: { html_url: "https://github.com/acme/web/commit/abc" } });
    }
    if (!tree.has(file)) return json(404, { message: "Not Found" });
    const text = tree.get(file);
    return json(200, { sha: blobSha(text), content: Buffer.from(text).toString("base64"), encoding: "base64" });
  }
  return json(404, { message: "Not Found" });
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 300) : ""}`);
};

const EVIL = '<img src=x onerror="window.__xss=1">';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.github.com/**", github);

  const EVIL = '<img src=x onerror="window.__xss=1">';
  const tokens = {
    sets: [{ id: "set-global", name: "Global", themes: [{ id: "theme-default", name: "Default" }], activeThemeId: "theme-default" }],
    colors: Array.from({ length: 8 }, (_, i) => ({ id: "c" + i, name: "primary-" + (i + 1) * 100, value: "#6366f1", group: "primary", setId: "set-global", themeValues: { "theme-default": "#6366f1" } })),
    typography: [{ id: "t1", name: "body", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20, setId: "set-global" }],
    spacing: [4, 8, 12, 16].map((v, i) => ({ id: "sp" + i, name: "space-" + (i + 1), value: v, setId: "set-global" })),
    radii: [{ id: "r1", name: "radius-md", value: 4, setId: "set-global" }],
    shadows: [{ id: "sh1", name: "shadow-sm", x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0,0,0,0.05)", group: "default", setId: "set-global" }],
    components: [],
  };
  await seed(page, "docs0001", { repo: "acme/web", name: "Acme DS", extra: { tokens, docs: [{ id: "evil", title: EVIL, blocks: [{ id: "e1", type: "text", text: EVIL }] }] } });
  await page.goto("http://localhost:3000/editor/docs0001");
  await page.getByText("Layers", { exact: true }).waitFor();
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stored = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].docs); };

  await nav("Docs");
  await page.getByText("Documentation", { exact: true }).waitFor();
  const paper = page.locator(".motif-docs");
  const sidebar = page.locator("div.w-\\[220px\\]");

  check("a project opens with a page for every token kind", (await sidebar.getByRole("button", { name: "Colors" }).isVisible()) && (await sidebar.getByRole("button", { name: "Shadows" }).isVisible()));
  check("and none for components until a repository's are imported", (await sidebar.getByText("Repository components").count()) === 0 && (await sidebar.getByText("Components", { exact: true }).count()) === 0);
  await sidebar.getByRole("button", { name: "Colors" }).click();
  check("colors page shows token swatches", (await paper.locator(".md-swatch").count()) > 5, await paper.locator(".md-swatch").count());
  for (const kind of ["Typography", "Spacing", "Radius", "Shadows"]) {
    await sidebar.getByRole("button", { name: kind }).click();
    await paper.locator("h1", { hasText: kind }).waitFor();
  }
  check("every foundations page renders", (await paper.locator(".md-swatch.md-card").count()) > 0);

  // XSS: hostile page title and text
  await sidebar.getByRole("button", { name: EVIL }).click();
  await paper.locator("h1").waitFor();
  check("hostile titles and text are shown as text", (await page.evaluate(() => window.__xss)) === undefined && (await sidebar.innerText()).includes("<img src=x"));

  // Write on a built-in page
  await sidebar.getByRole("button", { name: "Colors" }).click();
  await paper.getByLabel("Text").first().fill("Colors carry meaning.\n\nUse the semantic ones for state.");
  let docs = await stored();
  check("editing a built-in page stores it with a derived id", docs.some((d) => d.id === "doc-tokens-colors" && d.blocks[0].text.startsWith("Colors carry meaning")), JSON.stringify(docs.map((d) => d.id)));
  await page.screenshot({ path: `${OUT}/docs-tokens.png` });

  // Own page with blocks
  await page.locator('button[title="New page"]').click();
  await paper.getByLabel("Page title").fill("Principles");
  await paper.getByLabel("Text").fill("Clarity over cleverness.");
  const add = async (label) => {
    await paper.getByRole("button", { name: "Add block", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  };
  await add("Heading");
  await paper.getByLabel("Heading").fill("Writing");
  await add("Do / Don't");
  await paper.getByLabel("Do", { exact: true }).fill("Use verbs on buttons");
  await paper.getByLabel("Don't").fill("Say “Click here”");
  await add("Tokens");
  const blocks = paper.locator(".md-block");
  check("blocks are added in order", (await blocks.count()) === 4);
  check("the block menu offers component blocks only for repository components", (await (async () => { await paper.getByRole("button", { name: "Add block", exact: true }).click(); const items = await page.getByRole("menuitem").allInnerTexts(); await page.keyboard.press("Escape"); return items; })()).join("|") === ["Heading", "Text", "Do / Don't", "Component preview", "Component props", "Component usage", "Tokens"].join("|"));

  await blocks.nth(3).hover();
  await blocks.nth(3).getByLabel("Token type").selectOption({ label: "Spacing" });
  check("token picker switches the specimen", (await blocks.nth(3).locator(".md-bar").count()) > 3);
  await blocks.nth(1).hover();
  await blocks.nth(1).getByRole("button", { name: "Move up" }).click();
  check("blocks reorder", (await blocks.nth(0).locator("h2").count()) === 1);
  await blocks.nth(3).hover();
  await blocks.nth(3).getByRole("button", { name: "Delete block" }).click();
  check("blocks delete", (await blocks.count()) === 3);
  await blocks.nth(0).hover();
  await blocks.nth(0).getByRole("button", { name: "Add block below" }).click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click();
  check("blocks insert below a chosen block", (await blocks.count()) === 4 && (await blocks.nth(1).getByLabel("Text").count()) === 1);
  await blocks.nth(1).hover();
  await blocks.nth(1).getByRole("button", { name: "Delete block" }).click();

  docs = await stored();
  check("own page is saved with the project", docs.some((d) => d.title === "Principles" && d.blocks.length === 3), JSON.stringify(docs.map((d) => [d.title, d.blocks.length])));

  // Persist across reload
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await nav("Docs");
  await sidebar.getByRole("button", { name: "Principles" }).waitFor();
  check("docs survive a reload and own pages open first", (await paper.locator("h1 textarea").inputValue()) === EVIL || (await paper.locator("h1 textarea").inputValue()) === "Principles");

  // Second own page + page ordering
  await page.locator('button[title="New page"]').click();
  await paper.getByLabel("Page title").fill("Changelog");
  const row = sidebar.locator("div.group", { hasText: "Changelog" });
  await row.hover();
  await row.getByTitle("Move up").click();
  const order = await sidebar.locator("div.group button.truncate").allInnerTexts();
  check("own pages reorder", order.indexOf("Changelog") < order.indexOf("Principles"), order.slice(0, 4).join(","));

  // Preview
  await page.getByRole("button", { name: "preview" }).click();
  const frame = page.frameLocator('iframe[title="Documentation preview"]');
  await frame.locator("article").first().waitFor();
  const articles = await frame.locator("article").count();
  check("preview shows every page as one site", articles === 3 + 5, articles);
  check("preview escapes titles", (await frame.locator("nav").innerText()).includes("<img src=x"));
  await frame.locator('nav a[href="#doc-tokens-spacing"]').click();
  await page.waitForTimeout(700);
  const inView = await frame.locator("article#doc-tokens-spacing h1").evaluate((n) => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
  check("preview navigation jumps to the page", inView);
  await page.screenshot({ path: `${OUT}/docs-preview.png` });

  // Export
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export HTML" }).click()]);
  const html = fs.readFileSync(await download.path(), "utf8");
  check("export downloads a standalone site", download.suggestedFilename() === "acme-ds-docs.html" && html.startsWith("<!doctype html>") && html.includes("Use verbs on buttons") && !html.includes("<img src=x"));
  fs.writeFileSync(`${OUT}/acme-ds-docs.html`, html);
  const site = await context.newPage();
  await site.goto(`file://${OUT}/acme-ds-docs.html`);
  await site.locator('nav a[href="#doc-tokens-colors"]').click();
  await site.waitForTimeout(700);
  await site.screenshot({ path: `${OUT}/docs-export.png` });
  check("exported file renders on its own", (await site.locator("article#doc-tokens-colors .md-swatch").count()) > 5);
  await site.close();

  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 1500)); process.exit(1); });
