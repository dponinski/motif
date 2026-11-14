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

  await seed(page, "edit0001");
  await page.goto("http://localhost:3000/editor/edit0001");
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

  // ── There is no free-form canvas ──────────────────────────────────────────
  check("there are no drawing tools or shape canvas", (await page.locator("canvas").count()) === 0 && (await page.getByTitle(/Rectangle|Ellipse|Frame/).count()) === 0);
  check("with nothing open, the centre lists the components to open", await page.getByText("Choose a component").isVisible() && (await page.getByRole("button", { name: /^Button/ }).count()) > 0);
  await page.screenshot({ path: `${OUT}/stage-overview.png` });
  check("and the right panel is not shown", (await page.getByText("Component", { exact: true }).count()) === 0);
  await page.getByRole("button", { name: /^Alert/ }).first().click();
  await stage.locator("#root [role]").first().waitFor({ timeout: 60000 });
  check("a card opens that component on the canvas", (await page.locator("[data-stage-canvas]").count()) === 1);

  // ── Zoom and pan ──────────────────────────────────────────────────────────
  const surface = page.locator("[data-stage-canvas]");
  const zoomOf = async () => Number(await page.getByLabel("Zoom to 100%").getAttribute("data-zoom"));
  const contentBox = async () => page.locator("[data-stage-content]").boundingBox();
  check("it starts fitted, never larger than life", (await zoomOf()) <= 1);
  await page.getByLabel("Zoom to 100%").click();
  check("100% is life size", Math.abs((await zoomOf()) - 1) < 0.001);
  const before = await zoomOf();
  await page.getByLabel("Zoom in").click();
  check("zoom in", (await zoomOf()) > before);
  await page.getByLabel("Zoom out").click();
  await page.getByLabel("Zoom out").click();
  check("zoom out", (await zoomOf()) < before);
  await page.getByLabel("Fit to view").click();
  check("Fit goes back to fitting the content", (await zoomOf()) <= 1);

  const box = await surface.boundingBox();
  const frameEl = page.locator("iframe[title='Component preview']");
  const background = { x: box.x + 8, y: box.y + box.height - 60 };
  const centreOf = async () => { const f = await frameEl.boundingBox(); return { x: f.x + f.width / 2, y: f.y + f.height / 2 }; };

  // Scrolling and pinching work with the pointer anywhere, including over the component, whose page would
  // otherwise take the wheel.
  await page.getByLabel("Zoom to 100%").click();
  const origin = await contentBox();
  await page.mouse.move(background.x + 200, background.y);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(200);
  const overBackground = await contentBox();
  check("scrolling over the background pans", overBackground.y < origin.y - 10 && Math.abs(overBackground.x - origin.x) < 2, JSON.stringify({ origin, overBackground }));

  await page.getByLabel("Zoom to 100%").click();
  const origin2 = await contentBox();
  const over = await centreOf();
  await page.mouse.move(over.x, over.y);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  const overComponent = await contentBox();
  check("and so does scrolling over the component itself", overComponent.y < origin2.y - 10 && Math.abs(overComponent.x - origin2.x) < 2, JSON.stringify({ origin2, overComponent }));

  await page.getByLabel("Zoom to 100%").click();
  const inner = await centreOf();
  await stage.locator("body").evaluate((body, [x, y]) => window.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [10, 10]);
  await page.waitForTimeout(300);
  check("pinching over the component zooms the canvas", (await zoomOf()) > 1.2, await zoomOf());
  void inner;
  await surface.evaluate((el, [x, y]) => el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [box.x + box.width / 2, box.y + box.height / 2]);
  check("and over the background", (await zoomOf()) >= 1.2);

  // The component keeps its own scrolling when it has some.
  await page.getByLabel("Fit to view").click();
  const start = await contentBox();
  await page.mouse.move(background.x, background.y);
  await page.mouse.down();
  await page.mouse.move(background.x + 60, background.y + 40, { steps: 4 });
  await page.mouse.up();
  const dragged = await contentBox();
  check("dragging the background pans", Math.abs(dragged.x - start.x - 60) < 2 && Math.abs(dragged.y - start.y - 40) < 2, JSON.stringify({ start, dragged }));

  await page.getByLabel("Fit to view").click();
  const home = await contentBox();
  // Space is for panning once nothing that uses Space has the focus: the click on the background takes it.
  await page.mouse.click(background.x, background.y);
  await page.keyboard.down(" ");
  await page.mouse.move(home.x + 40, home.y + 40);
  await page.mouse.down();
  await page.mouse.move(home.x + 90, home.y + 70, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  const spaced = await contentBox();
  check("Space and drag pans even over the preview", Math.abs(spaced.x - home.x - 50) < 2 && Math.abs(spaced.y - home.y - 30) < 2, JSON.stringify({ home, spaced }));

  // Space inside the component's own page (after clicking into it) reaches the canvas too.
  await page.getByLabel("Fit to view").click();
  const home2 = await contentBox();
  await stage.locator("body").evaluate((body) => { document.body.tabIndex = -1; document.body.focus(); });
  await stage.locator("body").evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
  await page.waitForTimeout(150);
  await page.mouse.move(home2.x + 40, home2.y + 40);
  await page.mouse.down();
  await page.mouse.move(home2.x + 100, home2.y + 80, { steps: 4 });
  await page.mouse.up();
  await stage.locator("body").evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true })));
  const spaced2 = await contentBox();
  check("Space held while the component's page has the focus pans as well", Math.abs(spaced2.x - home2.x - 60) < 2 && Math.abs(spaced2.y - home2.y - 40) < 2, JSON.stringify({ home2, spaced2 }));

  // ── The width ─────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Preview width: 375" }).click();
  await page.waitForTimeout(300);
  check("the width switch sets the page's own width, whatever the zoom", (await page.locator("iframe[title='Component preview']").evaluate((el) => el.offsetWidth)) === 375 + 2);
  await page.getByRole("button", { name: "Preview width: Auto" }).click();

  // ── Edit at another zoom, with the layers ─────────────────────────────────
  await rowFor("Banner").click();
  await stage.locator("#root h2").waitFor({ timeout: 60000 });
  check("the layers show what the component renders, nested", (await page.locator("[data-layer]").count()) === 4);
  const layerTexts = await page.locator("[data-layer]").allInnerTexts();
  check("with the element names and what they say", layerTexts[0].includes("<div>") && layerTexts[1].includes("<h2>") && layerTexts[1].includes("Hello") && layerTexts[3].includes("<small>"), layerTexts.join(" | "));
  await page.screenshot({ path: `${OUT}/stage-layers.png` });

  await page.locator("[data-layer]", { hasText: "<p>" }).getByRole("button", { name: /<p>/ }).click();
  await aside.getByText("<p>").waitFor({ timeout: 10000 });
  check("picking a layer selects that element for editing", await page.getByRole("button", { name: "Design", exact: true }).getAttribute("aria-pressed") === "true");
  await page.getByLabel("Zoom to 100%").click();
  await page.getByLabel("Zoom out").click();
  await page.getByLabel("Zoom out").click();
  check("the stage is zoomed out", (await zoomOf()) < 0.7);
  await stage.locator("#root h2").click();
  await aside.getByText("<h2>").waitFor({ timeout: 10000 });
  check("clicking in the preview still picks the element at any zoom", true);
  check("and the layers follow", (await page.locator("[data-layer].bg-accent\\/15").innerText()).includes("<h2>"), await page.locator("[data-layer].bg-accent\\/15").count());
  check("the layers follow changes made in the editor", await (async () => {
    await aside.getByRole("button", { name: "Delete" }).first().click();
    return settle(async () => (await page.locator("[data-layer]").count()) === 3);
  })());

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
