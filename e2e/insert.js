const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");

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

  await seed(page, "inse0001");
  await page.goto("http://localhost:3000/editor/inse0001");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());

  await componentsReady(page);

  // The pointer is moved off the preview first: a button under it would show its hover color.
  const css = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const editButton = page.getByRole("button", { name: "Design", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });

  const root = stage.locator("div.rounded-lg");
  const order = () => stage.locator("div.rounded-lg > *").evaluateAll((els) => els.map((e) => e.tagName).join());
  const undo = () => page.getByRole("button", { name: "Undo" }).click();
  const palette = page.locator("[data-insert-palette]");
  const openPalette = async () => { await page.getByRole("button", { name: "Add element", exact: true }).click(); await palette.waitFor(); };
  const item = (name) => palette.locator(`[data-palette-item="${name}"]`);

  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  check("Design has an Add button", await page.getByRole("button", { name: "Add element", exact: true }).isVisible());
  check("and its order is the component's own", (await order()) === "H2,P,SMALL");

  // ── Adding from the palette: a press ─────────────────────────────────────
  await openPalette();
  const names = await palette.locator("[data-palette-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-palette-item")));
  check("the palette offers the elements a designer reaches for, then the repository's components", ["Box", "Row", "Column", "Text", "Heading", "Image", "Button", "Link", "List"].every((n) => names.includes(n)) && names.includes("Badge"), names.join());
  await page.screenshot({ path: `${OUT}/insert-palette.png` });
  await item("Heading").click();
  check("a press adds it to the component when nothing is picked", await settle(async () => (await order()) === "H2,P,SMALL,H2"));
  check("and picks the new element", await aside.getByText("<h2>").waitFor({ timeout: 5000 }).then(() => true, () => false));
  check("the panel is closed again", (await palette.count()) === 0);
  await undo();
  check("one undo takes it away", await settle(async () => (await order()) === "H2,P,SMALL"));

  // ── …to the picked element ───────────────────────────────────────────────
  await root.click({ position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor();
  await openPalette();
  await item("Row").click();
  check("added inside the picked element", await settle(async () => (await order()) === "H2,P,SMALL,DIV"));
  await openPalette();
  await item("Text").click();
  check("and inside the new one when that is picked", await settle(async () => (await stage.locator("div.rounded-lg > div > span").count()) === 1));
  await undo();
  await undo();
  await settle(async () => (await order()) === "H2,P,SMALL");

  // ── A repository component ───────────────────────────────────────────────
  await root.click({ position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor();
  await openPalette();
  await item("Badge").click();
  check("a repository component is added, and renders", await settle(async () => (await stage.locator("div.rounded-lg > span").count()) === 1));
  check("with its import", await (async () => { await page.getByRole("tab", { name: "Code", exact: true }).click(); await page.getByRole("tab", { name: "Design", exact: true }).click(); return true; })());
  await undo();
  await settle(async () => (await order()) === "H2,P,SMALL");

  // ── Dragging from the palette onto the canvas ────────────────────────────
  await openPalette();
  const from = await item("Heading").boundingBox();
  const small = await stage.locator("small").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 4 });
  await page.mouse.move(small.x + small.width / 2, small.y + 2, { steps: 8 });
  const line = stage.locator("[data-motif-drop]");
  check("a line shows where it would go", await line.first().waitFor({ timeout: 5000 }).then(() => true, () => false) && (await line.first().getAttribute("data-motif-drop")) === "before");
  await page.screenshot({ path: `${OUT}/insert-drop.png` });
  await page.mouse.up();
  check("letting go puts it there", await settle(async () => (await order()) === "H2,P,H2,SMALL"));
  check("and the line goes", await settle(async () => (await line.count()) === 0 || !(await line.first().isVisible())));
  await undo();
  await settle(async () => (await order()) === "H2,P,SMALL");

  // ── Moving an element by its grip ────────────────────────────────────────
  await stage.locator("small").click();
  await aside.getByText("<small>").waitFor();
  const grip = stage.locator('[data-motif-handle="move"]');
  await grip.waitFor();
  const g = await grip.boundingBox();
  const h2 = await stage.locator("h2").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 10, g.y + g.height / 2 - 10, { steps: 4 });
  await page.mouse.move(h2.x + h2.width / 2, h2.y + 2, { steps: 10 });
  check("dragging the grip shows where it would go", await line.first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.mouse.up();
  check("and moves the element", await settle(async () => (await order()) === "SMALL,H2,P"));
  check("it stays picked", await aside.getByText("<small>").isVisible());
  await undo();
  check("one undo puts it back", await settle(async () => (await order()) === "H2,P,SMALL"));

  // ── Reordering in the layers ─────────────────────────────────────────────
  const layerOf = (tag) => page.locator("[data-layer]", { hasText: `<${tag}>` }).first();
  const rowP = await layerOf("p").boundingBox();
  const rowH2 = await layerOf("h2").boundingBox();
  await page.mouse.move(rowP.x + 60, rowP.y + rowP.height / 2);
  await page.mouse.down();
  await page.mouse.move(rowP.x + 60, rowP.y + rowP.height / 2 - 8, { steps: 3 });
  await page.mouse.move(rowH2.x + 60, rowH2.y + 2, { steps: 6 });
  check("dragging a layer shows where it goes", await settle(async () => (await page.locator("[data-layer][data-drop]").count()) === 1) && (await page.locator("[data-layer][data-drop]").first().getAttribute("data-drop")) === "before");
  await page.mouse.up();
  check("and moves it", await settle(async () => (await order()) === "P,H2,SMALL"));
  await undo();
  await settle(async () => (await order()) === "H2,P,SMALL");

  // ── Typing in the text ───────────────────────────────────────────────────
  await stage.locator("h2").dblclick();
  const editing = stage.locator("h2[contenteditable]");
  check("a double click turns the text into a field", await editing.waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.keyboard.type("Hi there");
  await page.keyboard.press("Enter");
  check("Enter keeps what was typed", await settle(async () => (await stage.locator("h2").first().innerText()) === "Hi there"));
  check("and it is in the source", await (async () => { await page.getByRole("tab", { name: "Design", exact: true }).click(); return (await aside.getByLabel("Text", { exact: true }).inputValue()) === "Hi there"; })());
  check("the field is gone", (await stage.locator("h2[contenteditable]").count()) === 0);
  await undo();
  check("one undo brings the old text back", await settle(async () => (await stage.locator("h2").first().innerText()) === "Hello"));

  await stage.locator("p").dblclick();
  await stage.locator("p[contenteditable]").waitFor({ timeout: 5000 });
  await page.keyboard.type("Nope");
  await page.keyboard.press("Escape");
  check("Escape puts the text back as it was", await settle(async () => (await stage.locator("p").first().innerText()) === "World"));
  check("and nothing was changed", await settle(async () => (await order()) === "H2,P,SMALL") && (await page.getByRole("button", { name: "Undo" }).isDisabled()));

  // The element can be changed again after typing in it (the page was rebuilt around it).
  await stage.locator("h2").dblclick();
  await stage.locator("h2[contenteditable]").waitFor({ timeout: 5000 });
  await page.keyboard.type("Again");
  await page.keyboard.press("Enter");
  check("and typed in again", await settle(async () => (await stage.locator("h2").first().innerText()) === "Again"));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
