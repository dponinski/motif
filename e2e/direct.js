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

  await seed(page, "dire0001");
  await page.goto("http://localhost:3000/editor/dire0001");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
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

  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const handle = (kind) => stage.locator(`[data-motif-handle="${kind}"]`);
  const root = stage.locator("div.rounded-lg");
  const px = async (selector, prop) => Number((await stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop)).replace("px", ""));
  // Moves a handle by a distance, in the page's own pixels (the canvas is at whatever zoom it fitted to).
  const drag = async (kind, dx, dy) => {
    const box = await handle(kind).boundingBox();
    const zoom = Number(await page.locator("[data-zoom]").getAttribute("data-zoom"));
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (dx * zoom) / 2, y + (dy * zoom) / 2, { steps: 4 });
    await page.mouse.move(x + dx * zoom, y + dy * zoom, { steps: 4 });
    await page.mouse.up();
  };
  const classesOf = async () => { await tab("Code").click(); const text = await aside.getByLabel(/^Classes: /).first().inputValue(); await tab("Design").click(); return text; };
  const undo = () => page.getByRole("button", { name: "Undo" }).click();
  // What to print when a check fails, so a failure on another machine says where things stood.
  const where = async () => JSON.stringify({
    focus: await page.evaluate(() => document.activeElement && document.activeElement.tagName + ":" + (document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "").slice(0, 20)),
    aside: (await aside.innerText().catch(() => "")).slice(0, 110).replace(/\n+/g, " | "),
    root: await root.evaluate((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), el.className]; }).catch(() => null),
  });
  // A click on the canvas takes the keyboard from whatever had it; a key is only pressed once it has (the panel can already be showing
  // the same element, so waiting for it to show says nothing about the click having been dealt with).
  const clickCanvas = async (locator, options) => {
    await locator.click(options);
    await page.waitForFunction(() => document.activeElement === document.body || document.activeElement?.tagName === "IFRAME", null, { timeout: 10000 });
  };
  // Undo goes back to what was picked before, which for a first edit is nothing.
  const reselect = async () => { await root.click({ position: { x: 4, y: 4 } }); await aside.getByText("<div>").waitFor({ timeout: 10000 }); };

  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  await root.click({ position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor({ timeout: 10000 });

  // ── What is drawn over the selected element ──────────────────────────────
  const badge = stage.locator("body > div[aria-hidden] div").filter({ hasText: /^\d+ × \d+$/ });
  check("the selected element shows its size", await badge.first().isVisible() && /^\d+ × \d+$/.test(await badge.first().innerText()), await badge.count());
  check("and has handles to resize it, its padding and its gap", (await handle("right").count()) === 1 && (await handle("bottom").count()) === 1 && (await handle("corner").count()) === 1 && (await handle("pad-top").count()) === 1 && (await handle("gap").count()) === 1);
  check("a text element has no gap to change", await (async () => { await stage.locator("h2").click(); await aside.getByText("<h2>").waitFor(); return (await handle("gap").count()) === 0 || !(await handle("gap").isVisible()); })());
  await page.screenshot({ path: `${OUT}/direct-overlay.png` });
  await root.click({ position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor();

  // ── Dragging the gap ─────────────────────────────────────────────────────
  check("the gap starts at 8", (await px("div.rounded-lg", "rowGap")) === 8);
  await drag("gap", 0, 8);
  check("dragging the gap changes it, and lands on the step that is 16", await settle(async () => (await px("div.rounded-lg", "rowGap")) === 16));
  check("written as the repository's own step, not a value", /\bgap-4\b/.test(await classesOf()), await classesOf());
  await undo();
  check("one undo takes the whole drag back", await settle(async () => (await px("div.rounded-lg", "rowGap")) === 8));
  await reselect();

  // ── Dragging padding ─────────────────────────────────────────────────────
  check("padding starts at 16", (await px("div.rounded-lg", "paddingTop")) === 16);
  await drag("pad-top", 0, 8);
  check("dragging a padding dot changes that side", await settle(async () => (await px("div.rounded-lg", "paddingTop")) === 24) && (await px("div.rounded-lg", "paddingBottom")) === 16);
  check("as that side's class", /\bpt-6\b/.test(await classesOf()), await classesOf());
  await undo();
  await settle(async () => (await px("div.rounded-lg", "paddingTop")) === 16);
  await reselect();

  // ── Resizing ─────────────────────────────────────────────────────────────
  const before = await px("div.rounded-lg", "width");
  await drag("right", 100, 0);
  check("dragging the edge resizes the element", await settle(async () => Math.abs((await px("div.rounded-lg", "width")) - (before + 100)) <= 16), `${before} -> ${await px("div.rounded-lg", "width")}`);
  check("and writes a width", /\bw-/.test(await classesOf()), await classesOf());
  await undo();
  await settle(async () => Math.abs((await px("div.rounded-lg", "width")) - before) <= 1);
  await reselect();
  await drag("corner", 60, 20);
  check("the corner changes the width and the height together", await settle(async () => (await px("div.rounded-lg", "width")) > before + 40 && (await px("div.rounded-lg", "height")) > 0));
  const undoable = await page.getByRole("button", { name: "Undo" }).isEnabled();
  await undo();
  const backToStart = await settle(async () => Math.abs((await px("div.rounded-lg", "width")) - before) <= 1);
  await reselect();
  const classesNow = await classesOf();
  check("as one step", undoable && backToStart && !classesNow.match(/\bw-/), JSON.stringify({ undoable, backToStart, classesNow, before, width: await px("div.rounded-lg", "width") }));

  // ── The keyboard ─────────────────────────────────────────────────────────
  await clickCanvas(root, { position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor();
  await page.keyboard.press("Enter");
  const entered = await aside.getByText("<h2>").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("Enter picks the first element inside", entered, entered ? "" : await where());
  await page.keyboard.press("ArrowDown");
  check("the arrows go along its neighbours", await aside.getByText("<p>").waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.keyboard.press("ArrowUp");
  await aside.getByText("<h2>").waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
  check("Escape picks the element around it", await aside.getByText("<div>").waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.keyboard.press("Escape");
  check("and then lets go", await aside.getByText("Click an element in the preview").waitFor({ timeout: 5000 }).then(() => true, () => false));

  await clickCanvas(stage.locator("small"));
  await aside.getByText("<small>").waitFor();
  await page.keyboard.press("Control+d");
  check("Ctrl+D duplicates the element", await settle(async () => (await stage.locator("small").count()) === 2));
  await page.keyboard.press("Delete");
  check("Delete takes it away", await settle(async () => (await stage.locator("small").count()) === 1));
  await clickCanvas(stage.locator("p"));
  await aside.getByText("<p>").waitFor();
  await page.keyboard.press("Control+c");
  await clickCanvas(stage.locator("small"));
  await aside.getByText("<small>").waitFor();
  await page.keyboard.press("Control+v");
  check("copy and paste puts the element after the picked one", await settle(async () => (await stage.locator("div.rounded-lg > *").evaluateAll((els) => els.map((e) => e.tagName).join())) === "H2,P,SMALL,P"));
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await settle(async () => (await stage.locator("div.rounded-lg > *").evaluateAll((els) => els.map((e) => e.tagName).join())) === "H2,P,SMALL");

  // ── The right-click menu ─────────────────────────────────────────────────
  await stage.locator("h2").click({ button: "right" });
  const menu = page.locator("[data-element-menu]");
  check("a right click opens a menu for that element", await menu.waitFor({ timeout: 5000 }).then(() => true, () => false) && await aside.getByText("<h2>").isVisible());
  check("with what can be done to it", await menu.getByText("Duplicate").isVisible() && await menu.getByText("Delete").isVisible() && await menu.getByText("Wrap in a box").isVisible());
  await menu.getByText("Wrap in a box").click();
  check("choosing one does it", await settle(async () => (await stage.locator("div.rounded-lg > div > h2").count()) === 1));
  await page.screenshot({ path: `${OUT}/direct-menu.png` });
  await undo();
  check("and one undo takes it back", await settle(async () => (await stage.locator("div.rounded-lg > h2").count()) === 1));

  // ── Tooltips with the shortcut ───────────────────────────────────────────
  await stage.locator("h2").click();
  await aside.getByText("<h2>").waitFor();
  await aside.getByRole("button", { name: "Duplicate element" }).hover();
  check("buttons say what they do and what key does it", await page.getByRole("tooltip").getByText("Duplicate element").waitFor({ timeout: 5000 }).then(() => true, () => false) && /D/.test(await page.getByRole("tooltip").innerText()));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
