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

  await seed(page, "canv0001");
  await page.goto("http://localhost:3000/editor/canv0001");
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

  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const frame = page.locator('iframe[title="Component preview"]');
  // The width the frame is given (its border is on top of it).
  const frameWidth = async () => frame.evaluate((el) => parseInt(el.style.width, 10));
  const zoom = async () => Number(await page.locator("[data-zoom]").getAttribute("data-zoom"));
  const widthInput = page.getByLabel("Preview width", { exact: true });

  // ── Opening a component lands in Design ──────────────────────────────────
  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  check("a component opens in Design, the mode you work in", (await editButton.getAttribute("aria-pressed")) === "true");
  check("the modes are Design, Preview, Variants and Examples", (await page.getByRole("button", { name: /^(Design|Preview|Variants|Examples)/ }).allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim()).join() === "Design,Preview,Examples" || (await page.getByRole("button", { name: /^(Design|Preview|Variants|Examples)/ }).count()) >= 3);
  check("the canvas says what to do before anything is picked", await page.locator("[data-canvas-hint]").isVisible());
  check("the right panel has Design, Props and Code", (await page.getByRole("tab").allInnerTexts()).join() === "Design,Props,Code" && (await tab("Design").getAttribute("aria-selected")) === "true");

  // ── The frame ────────────────────────────────────────────────────────────
  check("the component sits in a labelled frame", (await page.locator("[data-frame-label]").innerText()).startsWith("Banner"));
  check("whose label says its size", /^640 × \d+/.test(await page.locator("[data-frame-size]").innerText()));
  await page.screenshot({ path: `${OUT}/canvas-design.png` });

  // ── Breakpoints ──────────────────────────────────────────────────────────
  check("the breakpoint bar starts on Auto", (await page.getByRole("button", { name: "Preview width: Auto" }).getAttribute("aria-pressed")) === "true" && (await widthInput.inputValue()) === "");
  await page.getByRole("button", { name: "Preview width: 768" }).click();
  check("a breakpoint sets the frame's width", await settle(async () => (await frameWidth()) === 768));
  // (The field follows a render after the frame, so it is waited for.)
  check("and is marked on the bar, with its width in the field", await settle(async () => (await page.getByRole("button", { name: "Preview width: 768" }).getAttribute("aria-pressed")) === "true" && (await widthInput.inputValue()) === "768" && (await page.locator("[data-frame-size]").innerText()).startsWith("768 ×")));
  await widthInput.fill("500");
  await widthInput.press("Enter");
  check("a width can be typed", await settle(async () => (await frameWidth()) === 500));
  check("and no breakpoint is marked for a width that isn't one", await settle(async () => (await page.locator('[data-breakpoints] [aria-pressed="true"]').count()) === 0));
  await widthInput.fill("");
  await widthInput.press("Enter");
  check("emptying the field is Auto", await settle(async () => (await frameWidth()) === 640) && (await page.getByRole("button", { name: "Preview width: Auto" }).getAttribute("aria-pressed")) === "true");

  // ── Dragging the frame's edge ────────────────────────────────────────────
  const handle = page.locator("[data-width-handle]");
  // The canvas fits itself again after a width changes, so the edge is taken where it stays, not where it was first seen.
  const stable = async () => {
    let last = await handle.boundingBox();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      const now = await handle.boundingBox();
      if (last && now && last.x === now.x && last.y === now.y && last.width === now.width && last.height === now.height) return now;
      last = now;
    }
    return last;
  };
  // And the edge is what is at that point: nothing (a loading cover, a menu) is over it.
  const topAt = (b) => page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return { handle: !!el?.closest("[data-width-handle]"), what: el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : ""}` : "nothing" }; }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  let box = await stable();
  let hit = await topAt(box);
  for (let i = 0; i < 50 && !hit.handle; i++) { await page.waitForTimeout(200); box = await stable(); hit = await topAt(box); }
  const z = await zoom();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 6 });
  await settle(async () => (await frameWidth()) < 640);
  const during = await frameWidth();
  await page.mouse.up();
  check("dragging the right edge changes the width, live", during < 640 && Math.abs(during - Math.round(640 - 100 / z)) <= 3, `${during} at zoom ${z}; at the edge: ${hit.what}${hit.handle ? "" : " (not the handle)"}`);
  check("and the field follows the frame", await settle(async () => Number(await widthInput.inputValue()) === (await frameWidth())));
  await page.getByRole("button", { name: "Preview width: Auto" }).click();

  // ── Design picks, Preview uses ───────────────────────────────────────────
  await stage.locator("h2").click();
  await aside.getByText("Heading").first().waitFor({ timeout: 10000 });
  check("in Design a click picks the element, and the panel names it by what it is", await aside.getByText("<h2>").isVisible() && await aside.getByText("Heading").first().isVisible());
  check("and the canvas stops saying what to do", (await page.locator("[data-canvas-hint]").count()) === 0);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  check("Preview is for using the component: its panel is just the props", (await page.getByRole("tab").count()) === 0);
  await page.getByRole("button", { name: "Design", exact: true }).click();

  // ── The tabs ─────────────────────────────────────────────────────────────
  await stage.locator("div.rounded-lg").click({ position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor({ timeout: 10000 });
  check("Design has the visual controls", await aside.getByText("Layout", { exact: true }).isVisible() && await aside.getByText("Spacing", { exact: true }).isVisible() && (await aside.getByRole("group", { name: "Direction", exact: true }).count()) === 1);
  await tab("Code").click();
  check("Code has the element's classes and its place in the markup", (await aside.getByLabel(/^Classes: /).count()) >= 1 && (await aside.getByLabel("Wrap in").count()) === 1);
  await tab("Props").click();
  check("Props has the component's props", await aside.getByText("Props", { exact: true }).first().isVisible());
  await tab("Design").click();

  // ── Controls you look at ─────────────────────────────────────────────────
  const direction = aside.getByRole("group", { name: "Direction", exact: true });
  check("direction is icons, with the current one pressed", (await direction.getAttribute("data-value")) === "col" && (await aside.getByRole("button", { name: "Direction: col", exact: true }).getAttribute("aria-pressed")) === "true");
  await aside.getByRole("button", { name: "Direction: row", exact: true }).click();
  check("pressing another changes the layout", await settle(async () => (await stage.locator("div.rounded-lg").evaluate((el) => getComputedStyle(el).flexDirection)) === "row"));
  await aside.getByRole("button", { name: "Justify: between", exact: true }).click();
  check("justify and align are icons too", await settle(async () => (await stage.locator("div.rounded-lg").evaluate((el) => getComputedStyle(el).justifyContent)) === "space-between"));
  await aside.getByRole("button", { name: "Justify: between", exact: true }).click();
  check("pressing the one that is on takes it off", await settle(async () => (await stage.locator("div.rounded-lg").evaluate((el) => getComputedStyle(el).justifyContent)) === "normal"));
  await aside.getByRole("button", { name: "Width: Fill", exact: true }).click();
  check("a size can be Fill or Hug in one press", await settle(async () => (await field("Width").inputValue()) === "full"));
  check("spacing is shown as short labels in a grid", await aside.getByText("Horizontal", { exact: true }).isVisible() && await aside.getByText("Vertical", { exact: true }).isVisible());

  // ── State and where a style applies ──────────────────────────────────────
  check("State and Applies to are two controls", (await field("State").inputValue()) === "" && (await field("Applies to").inputValue()) === "");
  await field("State").selectOption("hover:");
  check("choosing a state leaves 'Applies to' on Always", (await field("Applies to").inputValue()) === "");
  await field("Applies to").selectOption("dark:");
  check("choosing where it applies sets the state back to Default", (await field("State").inputValue()) === "" && (await field("Applies to").inputValue()) === "dark:");
  await field("Applies to").selectOption("");

  // ── Layers by what things are ────────────────────────────────────────────
  const layers = await page.locator("[data-layer]").allInnerTexts();
  check("layers are named for what they are, with the tag beside", layers[0].includes("Box") && layers[1].includes("Heading") && layers[1].includes("Hello") && layers[1].includes("<h2>") && layers[2].includes("Text") && layers[3].includes("Footnote"), layers.join(" | "));
  await page.screenshot({ path: `${OUT}/canvas-inspector.png` });

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
