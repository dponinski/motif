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

  await seed(page, "inspect01");
  await page.goto("http://localhost:3000/editor/inspect01");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());

  await componentsReady(page);

  // The pointer is moved off the preview first: a button under it would show its hover color.
  const css = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const editButton = page.getByRole("button", { name: "Design", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });
  const setColor = async (label, value) => { await field(label).click(); const box = page.getByLabel(`${label}: search tokens or type a value`); await box.fill(value); await box.press("Enter"); };


  // ── What the inspector changes is what the canvas shows ─────────────────────
  // Every control is tried on the element it belongs to, and the canvas (the element's computed style in the preview) is read after.
  const until = async (read, want, ms = 20000) => { const end = Date.now() + ms; let got; while (Date.now() < end) { got = await read(); if (want(got)) return got; await page.waitForTimeout(100); } return got; };
  // Each component says its own name in its text, so a preview that is still the previous component's is not taken for this one.
  const open = async (name, readyFor, text) => { await rowFor(name).click(); await stage.locator(`#root ${readyFor}`).getByText(text, { exact: true }).or(stage.locator(`#root ${readyFor}`).filter({ hasText: new RegExp(`^${text}$`) })).first().waitFor({ timeout: 60000 }); await page.getByRole("button", { name: "Design", exact: true }).click(); };
  // The corner of an element, where no child is (the middle of a box is its content).
  // (The panel is read for the element picked, not for the one picked before it: its controls are there once the element's source has been read.)
  const pick = async (selector, tag) => { await stage.locator(selector).first().click({ position: { x: 3, y: 3 } }); await aside.getByText(`<${tag}>`).waitFor({ timeout: 10000 }); await aside.getByLabel("Display", { exact: true }).waitFor({ timeout: 20000 }); await page.waitForTimeout(300); };
  // Chooses an option and says what the canvas does with it.
  const choose = async (label, option, selector, prop, want) => {
    await field(label).selectOption(option);
    // The control took it, and then the canvas shows it.
    await until(async () => field(label).inputValue(), (v) => v === option);
    return until(() => css(selector, prop), want);
  };

  await componentsReady(page);

  // Tailwind classes
  await open("Card", "h2", "Title");
  await pick("#root h2", "h2");
  check("text size: the class is replaced and the canvas follows", (await choose("Text size", "2xl", "#root h2", "fontSize", (v) => v === "24px")) === "24px");
  check("weight", (await choose("Weight", "bold", "#root h2", "fontWeight", (v) => v === "700")) === "700");
  await setColor("Text color", "#ff0000");
  check("text color", (await until(() => css("#root h2", "color"), (v) => v === "rgb(255, 0, 0)")) === "rgb(255, 0, 0)");
  await pick("#root div[data-motif]", "div");
  check("gap", (await choose("Gap", "4", "#root div[data-motif]", "gap", (v) => v === "16px")) === "16px");
  check("padding", (await choose("Padding", "8", "#root div[data-motif]", "paddingTop", (v) => v === "32px")) === "32px");
  check("direction", await (async () => { await aside.getByRole("button", { name: "Direction: row", exact: true }).click(); return (await until(() => css("#root div[data-motif]", "flexDirection"), (v) => v === "row")) === "row"; })());
  await setColor("Background", "#00ff00");
  check("background", (await until(() => css("#root div[data-motif]", "backgroundColor"), (v) => v === "rgb(0, 255, 0)")) === "rgb(0, 255, 0)");
  const radius = await css("#root div[data-motif]", "borderTopLeftRadius");
  await field("Radius").selectOption("none");
  check("radius", (await until(() => css("#root div[data-motif]", "borderTopLeftRadius"), (v) => v !== radius)) !== radius);
  const shadow = await css("#root div[data-motif]", "boxShadow");
  await field("Shadow").selectOption("xl");
  check("shadow", (await until(() => css("#root div[data-motif]", "boxShadow"), (v) => v !== shadow)) !== shadow);
  await field("Add spacing property").selectOption("pt");
  await field("Padding top").selectOption("16");
  check("a property added from the Add menu", (await until(() => css("#root div[data-motif]", "paddingTop"), (v) => v === "64px")) === "64px");
  await page.screenshot({ path: `${OUT}/inspector-tailwind.png` });
  await page.getByRole("button", { name: "Undo" }).click();
  check("undo takes the last one back", (await until(() => css("#root div[data-motif]", "paddingTop"), (v) => v !== "64px")) !== "64px");

  // A stylesheet rule in a repository that uses Tailwind: the rule outranks any class, so the rule is what is edited
  await open("Plain", ".plain-text", "Plain");
  await pick("#root .plain-box", "div");
  check("an element styled by a stylesheet says where its styles are", (await aside.getByText("Styles in").first().innerText()).includes("Plain.css"));
  check("padding is read from the rule", (await field("Padding").inputValue()) === "8px");
  check("padding in the stylesheet shows on the canvas", (await choose("Padding", "16px", "#root .plain-box", "paddingTop", (v) => v === "16px")) === "16px");
  check("display", (await choose("Display", "block", "#root .plain-box", "display", (v) => v === "block")) === "block");
  const plainRadius = await css("#root .plain-box", "borderTopLeftRadius");
  await field("Radius").selectOption("8px");
  check("radius", (await until(() => css("#root .plain-box", "borderTopLeftRadius"), (v) => v !== plainRadius)) === "8px");
  await pick("#root .plain-text", "span");
  check("text size of the span", (await choose("Text size", "20px", "#root .plain-text", "fontSize", (v) => v === "20px")) === "20px");

  // The element's own style attribute
  await open("Inline", "span", "Inline");
  await pick("#root span", "span");
  check("an inline style is listed as outranking the classes", (await aside.locator("[data-inline-style]").innerText()).includes("font-size"));
  check("text size: the property leaves the style and the class shows", (await choose("Text size", "2xl", "#root span", "fontSize", (v) => v === "24px")) === "24px");
  await aside.locator("[data-inline-style]").waitFor({ timeout: 5000 });
  check("what is left inline is still listed", !(await aside.locator("[data-inline-style]").innerText()).includes("font-size") && (await aside.locator("[data-inline-style]").innerText()).includes("color"));
  await setColor("Text color", "#0000ff");
  check("text color the same way", (await until(() => css("#root span", "color"), (v) => v === "rgb(0, 0, 255)")) === "rgb(0, 0, 255)");
  check("and then nothing is inline", (await aside.locator("[data-inline-style]").count()) === 0);

  // Classes that a condition adds
  await open("Cn", "span", "Cn");
  await pick("#root span", "span");
  check("a weight set by both sides of a condition", (await choose("Weight", "thin", "#root span", "fontWeight", (v) => v === "100")) === "100");
  await setColor("Text color", "#00aa00");
  check("a color the condition would set, the plain way", (await until(() => css("#root span", "color"), (v) => v === "rgb(0, 170, 0)")) === "rgb(0, 170, 0)");

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
