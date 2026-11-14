const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { gitData } = require("./support/git-data");
const { openSync, syncNow } = require("./support/sync-helpers");

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

  await seed(page, "tokpick01");
  await page.goto("http://localhost:3000/editor/tokpick01");
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
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });

  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const valueOf = (label) => field(label).getAttribute("data-value");
  const statusOf = async (label) => { const dot = field(label).locator("xpath=..").locator("[data-token-status]"); return (await dot.count()) ? dot.getAttribute("data-token-status") : null; };
  const search = (label) => page.getByLabel(`${label}: search tokens or type a value`);
  const options = (label) => page.getByRole("listbox", { name: `${label} tokens` }).getByRole("option");
  const hint = (id) => aside.locator(`[data-raw="${id}"]`);
  const flaggedCount = async () => { const el = aside.locator("[data-flagged]"); return (await el.count()) ? Number(await el.getAttribute("data-flagged")) : 0; };
  const layer = (tag) => page.locator("[data-layer]").getByRole("button", { name: new RegExp(`<${tag}>`) });

  // ── A token in use ────────────────────────────────────────────────────────
  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  await editButton.click();
  await stage.locator("#root button").click();
  await aside.getByText("<button>").waitFor({ timeout: 10000 });

  check("a color shows as the token it is, with the color beside it", (await valueOf("Background")) === "primary" && (await field("Background").locator("span[aria-hidden]").evaluate((el) => getComputedStyle(el).backgroundColor)) !== "rgba(0, 0, 0, 0)");
  check("and is marked as one of the repository's tokens", (await statusOf("Background")) === "token");
  const radiusTokens = await field("Radius").locator('optgroup[label="Tokens"] option').allInnerTexts();
  check("a list offers the repository's tokens first, with what each is worth", radiusTokens.join("|") === "sm · 6px|md · 8px|lg · 12px|xl · 16px", radiusTokens.join("|"));
  check("then what Tailwind ships with and the repository has not replaced", (await field("Radius").locator('optgroup[label="Tailwind"] option').allInnerTexts()).join("|") === "none · 0px|xs · 2px|default · 4px|2xl · 16px|3xl · 24px|full · full");
  check("the radius in use is one of them", (await field("Radius").inputValue()) === "md" && (await statusOf("Radius")) === "token");
  check("steps of the spacing scale say how big they are", (await field("Gap").locator("option").allInnerTexts()).includes("4 · 16px") && (await field("Gap").locator("optgroup").count()) === 0 && (await statusOf("Gap")) === null);

  // ── Picking a color ───────────────────────────────────────────────────────
  await field("Background").click();
  await search("Background").waitFor();
  check("the picker lists the repository's color tokens", (await options("Background").count()) === 17);
  const selected = options("Background").and(page.locator('[aria-selected="true"]'));
  check("and starts on the one in use", (await selected.innerText()).startsWith("primary") && (await selected.locator("svg").count()) === 1);
  const primaryHex = await options("Background").filter({ hasText: /^primary#/ }).locator("span.font-mono").innerText();
  check("each with its color in the theme that is showing", /^#[0-9a-f]{6}$/.test(primaryHex), primaryHex);
  await page.screenshot({ path: `${OUT}/tokens-picker.png` });

  await search("Background").fill("dang");
  check("typing narrows the list", (await options("Background").allInnerTexts()).map((t) => t.split("\n")[0]).join("|").startsWith("danger|danger-foreground"), (await options("Background").allInnerTexts()).join("|"));
  await search("Background").press("Enter");
  check("Enter takes the first match", await settle(async () => (await valueOf("Background")) === "danger"));
  check("and the real component is restyled", await settle(async () => (await css("#root button", "backgroundColor")).startsWith("oklch(0.56")), await css("#root button", "backgroundColor"));
  check("the picker closes", (await search("Background").count()) === 0);

  await field("Background").click();
  await page.getByLabel("Background opacity").selectOption("50");
  check("an opacity is set on the same class", await settle(async () => (await valueOf("Background")) === "danger/50"));
  await page.keyboard.press("Escape");
  check("which the preview shows", await settle(async () => /\/ 0\.5\)$/.test(await css("#root button", "backgroundColor"))), await css("#root button", "backgroundColor"));

  await field("Background").click();
  await search("Background").fill(primaryHex);
  const first = options("Background").first();
  check("a color pasted as a value finds the token that is that color", (await first.innerText()).includes("primary") && (await first.innerText()).includes("same color"), await first.innerText());
  await search("Background").press("Enter");
  check("choosing it keeps the opacity", await settle(async () => (await valueOf("Background")) === "primary/50"));

  await field("Background").click();
  await page.getByRole("dialog").getByRole("button", { name: "transparent" }).click();
  check("a word like transparent is one press away, and takes no opacity", await settle(async () => (await valueOf("Background")) === "transparent"));

  await field("Background").click();
  await search("Background").fill("white");
  await search("Background").press("Enter");
  check("a typed word is written as it is, not as a bracketed value", await settle(async () => (await valueOf("Background")) === "white") && (await hint("bg").count()) === 0);
  await page.getByLabel("Undo").click();
  await settle(async () => (await valueOf("Background")) === "transparent");

  await field("Background").click();
  await search("Background").fill("red-500");
  await search("Background").press("Enter");
  await settle(async () => (await valueOf("Background")) === "red-500");
  check("a Tailwind palette color can still be typed, and is pointed out", (await hint("bg").innerText()).includes("Tailwind color, not a token") && (await statusOf("Background")) === "flag");
  check("with a count of what is not a token on the element", (await flaggedCount()) === 1);
  await page.getByLabel("Undo").click();
  check("undo takes it back", await settle(async () => (await valueOf("Background")) === "transparent" && (await hint("bg").count()) === 0));

  // ── Values that are written out ───────────────────────────────────────────
  await rowFor("Promo").click();
  await stage.locator("#root h3").waitFor({ timeout: 60000 });
  await layer("div").click();
  await aside.getByText("<div>").waitFor({ timeout: 10000 });
  check("an element with written-out values says how many are not tokens", await settle(async () => (await flaggedCount()) === 6), await flaggedCount());
  const hints = Object.fromEntries(await Promise.all(["gap", "radius", "bg", "p", "text-size", "shadow"].map(async (id) => [id, (await hint(id).innerText()).replace(/\s+/g, " ").trim()])));
  check("each is offered the token or step that is the same", hints.gap === "Not a token Use 4.5 (18px)" && hints.radius === "Not a token Use md (8px)" && hints.bg === "Not a token Use primary" && hints.p === "Not a token Use 4 (16px)" && hints.shadow === "Not a token Use card", JSON.stringify(hints));
  check("or the closest, said to be only that", hints["text-size"] === "Not a token Closest: sm (14px)", hints["text-size"]);
  await page.screenshot({ path: `${OUT}/tokens-raw.png` });

  const look = async () => ({ radius: await css("#root div.flex", "borderRadius"), gap: await css("#root div.flex", "gap"), padding: await css("#root div.flex", "paddingTop"), bg: await css("#root div.flex", "backgroundColor"), shadow: await css("#root div.flex", "boxShadow") });
  const before = await look();
  for (const [label, name] of [["Radius", "md"], ["Background", "primary"], ["Shadow", "card"], ["Gap", "4.5"], ["Padding", "4"]]) {
    await aside.getByRole("button", { name: `Use ${name} for ${label}` }).click();
    await settle(async () => (await aside.getByRole("button", { name: `Use ${name} for ${label}` }).count()) === 0);
  }
  check("one press each replaces them", (await field("Radius").inputValue()) === "md" && (await valueOf("Background")) === "primary" && (await field("Shadow").inputValue()) === "card" && (await field("Gap").inputValue()) === "4.5" && (await field("Padding").inputValue()) === "4");
  check("and they are tokens now", (await statusOf("Radius")) === "token" && (await statusOf("Background")) === "token" && (await statusOf("Shadow")) === "token" && (await flaggedCount()) === 1);
  await page.waitForTimeout(600);
  const after = await look();
  check("the component looks the same, because each was the same value", before.radius === "8px" && after.radius === "8px" && before.gap === after.gap && before.padding === after.padding && before.bg === after.bg && before.shadow === after.shadow, JSON.stringify({ before, after }));

  await aside.getByRole("button", { name: "Use sm for Text size" }).click();
  check("the closest one changes the value, as it said", await settle(async () => (await css("#root div.flex", "fontSize")) === "14px") && (await flaggedCount()) === 0);

  await layer("p").click();
  await aside.getByText("<p>").waitFor({ timeout: 10000 });
  check("a palette color is pointed out, with nothing offered that isn't the same", (await hint("text-color").innerText()).trim() === "Tailwind color, not a token" && (await hint("text-color").getByRole("button").count()) === 0);

  // ── In the other theme ────────────────────────────────────────────────────
  await layer("div").click();
  await aside.getByText("<div>").waitFor({ timeout: 10000 });
  await page.getByLabel("Dark theme").click();
  await field("Background").click();
  const darkHex = await options("Background").filter({ hasText: /^primary#/ }).locator("span.font-mono").innerText();
  check("in the dark theme the picker shows the tokens' dark colors", /^#[0-9a-f]{6}$/.test(darkHex) && darkHex !== primaryHex, `${primaryHex} ${darkHex}`);
  await page.keyboard.press("Escape");
  await page.getByLabel("Light theme").click();

  // ── What goes to the repository ───────────────────────────────────────────
  await page.locator('main button[aria-label="Sync"]').click();
  await page.getByLabel("Changes to src/components/Promo.tsx", { exact: true }).click();
  const diff = await page.getByLabel("Diff of src/components/Promo.tsx", { exact: true }).innerText();
  check("the pull request has the tokens where the values were", diff.includes('className="flex flex-col gap-4.5 rounded-md bg-primary p-4 text-sm shadow-card"'), diff.slice(0, 600));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
