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

  await seed(page, "state001");
  await page.goto("http://localhost:3000/editor/state001");
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
  const setColor = async (label, value) => { await field(label).click(); const box = page.getByLabel(`${label}: search tokens or type a value`); await box.fill(value); await box.press("Enter"); };

  const widthOf = () => page.getByLabel("Preview width").inputValue();
  const iframeWidth = () => page.locator('iframe[title="Component preview"]').evaluate((el) => el.getBoundingClientRect().width);
  const hoverBg = async () => { await stage.locator("#root button").hover(); await page.waitForTimeout(300); return stage.locator("#root button").evaluate((el) => getComputedStyle(el).backgroundColor); };

  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  await editButton.click();
  await stage.locator("#root button").click();
  await aside.getByText("<button>").waitFor({ timeout: 10000 });

  // ── Hover ────────────────────────────────────────────────────────────────
  check("the plain state is the default", (await field("State").inputValue()) === "");
  await field("State").selectOption("hover:");
  check("hover shows the hover class of the variant that is showing", (await field("Background").getAttribute("data-value")) === "primary/90");
  check("and says how to see it", await aside.getByText("Hover the element in the preview").isVisible());
  const before = await hoverBg();
  // Typing an opacity sets it; without one the hover class would keep its /90.
  await setColor("Background", "muted/100");
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) after = await hoverBg();
  await page.mouse.move(720, 12);
  await page.waitForTimeout(500);
  const plain = await stage.locator("#root button").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("editing the hover color changes what hovering shows", after !== before && after.startsWith("oklch(0.96"), `${before} -> ${after}`);
  check("and leaves the resting color alone", plain.startsWith("oklch(0.52"), plain);
  await field("State").selectOption("");
  check("back on the plain state the plain color is still primary", (await field("Background").getAttribute("data-value")) === "primary");
  const raw = aside.getByLabel("Classes: variant: primary");
  check("only the hover class changed in the source", (await raw.inputValue()) === "bg-primary text-primary-foreground hover:bg-muted", await raw.inputValue());
  await page.screenshot({ path: `${OUT}/states-hover.png` });

  // ── Breakpoint ───────────────────────────────────────────────────────────
  await field("State").selectOption("md:");
  check("choosing a breakpoint puts the preview at that width", (await widthOf()) === "768");
  check("a property that only the plain class sets shows as inherited", (await field("Gap").inputValue()) === "" && (await field("Gap").locator("option").first().innerText()).includes("inherits 2"));
  await field("Gap").selectOption("6");
  for (let i = 0; i < 40 && (await stage.locator("#root button").evaluate((el) => getComputedStyle(el).gap)) !== "24px"; i++) await page.waitForTimeout(100);
  check("an md: class applies at 768 wide", (await stage.locator("#root button").evaluate((el) => getComputedStyle(el).gap)) === "24px", `${await stage.locator("html").evaluate(() => innerWidth)}px wide, gap ${await stage.locator("#root button").evaluate((el) => getComputedStyle(el).gap)}`);
  await page.getByLabel("Preview width").selectOption("375");
  for (let i = 0; i < 40 && (await stage.locator("#root button").evaluate((el) => getComputedStyle(el).gap)) !== "8px"; i++) await page.waitForTimeout(100);
  check("and not below it", (await stage.locator("#root button").evaluate((el) => getComputedStyle(el).gap)) === "8px");
  const rawBase = aside.getByLabel("Classes: buttonVariants base");
  check("the source has md:gap-6 next to the plain gap-2", (await rawBase.inputValue()).includes("gap-2") && (await rawBase.inputValue()).includes("md:gap-6"), await rawBase.inputValue());

  // ── Dark ─────────────────────────────────────────────────────────────────
  await field("State").selectOption("dark:");
  check("the dark state turns the dark theme on", await page.getByRole("button", { name: "Light theme" }).isVisible());
  await setColor("Background", "danger");
  for (let i = 0; i < 40 && !(await css("#root button", "backgroundColor")).startsWith("oklch(0.66 0.19 25)") === false; i++) await page.waitForTimeout(100);
  // The repository's own dark danger color, not the light one.
  await page.waitForTimeout(500);
  check("a dark: class applies in the dark theme", (await css("#root button", "backgroundColor")).startsWith("oklch(0.66 0.19 25)"), await css("#root button", "backgroundColor"));
  await field("State").selectOption("");
  check("leaving dark puts the light theme back", await page.getByRole("button", { name: "Dark theme" }).isVisible());
  check("and the plain background is unchanged", (await field("Background").getAttribute("data-value")) === "primary");

  // ── Pull request ─────────────────────────────────────────────────────────
  await page.locator('main button[aria-label="Sync"]').click();
  await syncNow(page, 1);
  const pr = prs[prs.length - 1];
  const original = repos["acme/ds"].main.get("src/components/Button.tsx").split("\n");
  const edited = repos["acme/ds"][pr.head].get("src/components/Button.tsx").split("\n");
  const diff = edited.flatMap((l, i) => (l === original[i] ? [] : [`${original[i].trim()} => ${l.trim()}`]));
  check("the pull request changes the base string and the variant, and nothing else", edited.length === original.length && diff.length === 2 && diff[0].includes("md:gap-6") && !diff[0].includes("dark:") && diff[1].includes("hover:bg-muted") && diff[1].includes("dark:bg-danger"), diff.join(" | "));
  check("the description names the states", pr.body.includes("hover background primary/90 → muted") && pr.body.includes("md gap none → 6") && pr.body.includes("dark background none → danger"), pr.body.slice(0, 300));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
