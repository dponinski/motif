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

  await seed(page, "edit0001");
  await page.goto("http://localhost:3000/editor/edit0001");
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

  // ── Pick an element and change it ─────────────────────────────────────────
  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  check("a component's gap starts as the repository has it", (await css("#root button", "gap")) === "8px");
  await editButton.click();
  check("the editor says what to do before anything is picked", await aside.getByText("Click an element in the preview").waitFor({ timeout: 10000 }).then(() => true, () => false));
  await stage.locator("#root button").click();
  await aside.getByText("<button>").waitFor({ timeout: 10000 });
  check("clicking an element selects it and shows its source", (await aside.getByText("src/components/Button.tsx").count()) > 0);
  check("the click doesn't reach the component", (await stage.locator("#root button").count()) === 1);
  check("its classes are read from the cva table, base and chosen variant", (await field("Gap").inputValue()) === "2" && (await field("Background").getAttribute("data-value")) === "primary");
  await page.screenshot({ path: `${OUT}/edit-select.png` });

  await field("Gap").selectOption("4");
  await page.waitForFunction(() => true);
  for (let i = 0; i < 40 && (await css("#root button", "gap")) !== "16px"; i++) await page.waitForTimeout(100);
  check("changing the gap restyles the real component", (await css("#root button", "gap")) === "16px");
  check("the control shows the new value and the PR button counts the file", (await field("Gap").inputValue()) === "4" && (await page.locator('main button[aria-label="Sync"]').innerText()).includes("Sync (1)"));

  await setColor("Background", "danger");
  for (let i = 0; i < 40 && !(await css("#root button", "backgroundColor")).startsWith("oklch(0.56"); i++) await page.waitForTimeout(100);
  check("a color token can be typed in", (await css("#root button", "backgroundColor")).startsWith("oklch(0.56"), await css("#root button", "backgroundColor"));
  check("the selection survives the edit", (await aside.getByText("<button>").count()) === 1 && (await field("Background").getAttribute("data-value")) === "danger");
  await page.screenshot({ path: `${OUT}/edit-change.png` });

  // Raw classes of the variant that is showing.
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  const raw = aside.getByLabel("Classes: variant: primary");
  check("the variant's own classes can be read as text", (await raw.inputValue()) === "bg-danger text-primary-foreground hover:bg-primary/90");
  await page.getByRole("tab", { name: "Design", exact: true }).click();

  await page.getByRole("button", { name: "Undo" }).click();
  for (let i = 0; i < 40 && !(await css("#root button", "backgroundColor")).startsWith("oklch(0.52"); i++) await page.waitForTimeout(100);
  check("undo brings the previous look back", (await css("#root button", "backgroundColor")).startsWith("oklch(0.52") && (await css("#root button", "gap")) === "16px", `${await css("#root button", "backgroundColor")} ${await css("#root button", "gap")}`);
  await page.getByRole("button", { name: "Redo" }).click();
  for (let i = 0; i < 40 && !(await css("#root button", "backgroundColor")).startsWith("oklch(0.56"); i++) await page.waitForTimeout(100);
  check("and redo returns it", (await css("#root button", "backgroundColor")).startsWith("oklch(0.56"));

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  check("other modes show the edited component too", (await css("#root button", "gap")) === "16px" && (await css("#root button", "backgroundColor")).startsWith("oklch(0.56"));

  // ── Text and structure ────────────────────────────────────────────────────
  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  await editButton.click();
  await stage.locator("h2").click();
  await aside.getByText("<h2>").waitFor();
  check("an element's text can be read", (await field("Text").inputValue()) === "Hello");
  await field("Text").fill("Welcome");
  await field("Text").press("Enter");
  await stage.getByRole("heading", { name: "Welcome" }).waitFor({ timeout: 10000 });
  check("and changed", true);

  await stage.locator("p").click();
  await aside.getByText("<p>").waitFor();
  await aside.getByRole("button", { name: "Move up" }).click();
  for (let i = 0; i < 40 && (await stage.locator("div.rounded-lg > *").first().evaluate((el) => el.tagName)) !== "P"; i++) await page.waitForTimeout(100);
  check("an element moves up past its sibling and stays selected", (await stage.locator("div.rounded-lg > *").first().evaluate((el) => el.tagName)) === "P" && (await aside.getByText("<p>").count()) === 1);
  await aside.getByRole("button", { name: "Duplicate element" }).click();
  for (let i = 0; i < 40 && (await stage.locator("p").count()) !== 2; i++) await page.waitForTimeout(100);
  check("an element can be duplicated", (await stage.locator("p").count()) === 2);
  await stage.locator("small").click();
  await aside.getByText("<small>").waitFor();
  await aside.getByRole("button", { name: "Delete element" }).click();
  for (let i = 0; i < 40 && (await stage.locator("small").count()) !== 0; i++) await page.waitForTimeout(100);
  check("an element can be deleted", (await stage.locator("small").count()) === 0);
  check("and the editor lets go of it", await aside.getByText("Click an element in the preview").isVisible());
  await stage.locator("div.rounded-lg").click({ position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor();
  check("the root of a component can't be deleted", await aside.getByRole("button", { name: "Delete element" }).isDisabled());
  await aside.getByRole("button", { name: "Direction: row", exact: true }).click();
  for (let i = 0; i < 40 && (await css("div.rounded-lg", "flexDirection")) !== "row"; i++) await page.waitForTimeout(100);
  check("layout is a control: direction row", (await css("div.rounded-lg", "flexDirection")) === "row");
  await page.screenshot({ path: `${OUT}/edit-structure.png` });

  // ── Sync: one working branch, one pull request ────────────────────────────
  await page.locator('main button[aria-label="Sync"]').click();
  await page.getByLabel("Waiting to sync").waitFor();
  check("the Sync panel lists each changed file", (await page.getByText("src/components/Banner.tsx").count()) > 0 && (await page.getByText("src/components/Button.tsx").count()) > 0);
  await page.getByLabel("Changes to src/components/Button.tsx", { exact: true }).click();
  check("with its diff, opened from the file", (await page.getByLabel("Diff of src/components/Button.tsx", { exact: true }).innerText()).includes("gap-4"));
  await page.screenshot({ path: `${OUT}/edit-pr.png` });

  // Someone changes Banner in the repository while this is open: it isn't sent, so the repository's change isn't lost.
  repos["acme/ds"].main.set("src/components/Banner.tsx", repos["acme/ds"].main.get("src/components/Banner.tsx") + "// changed elsewhere\n");
  await page.getByRole("button", { name: "Push" }).click();
  await page.waitForTimeout(2500);
  check("a file changed in the repository meanwhile is left out of the pull request", prs.length === 1 && !prs[0].body.includes("`src/components/Banner.tsx`") && prs[0].body.includes("`src/components/Button.tsx`"), prs.map((p) => p.body).join("|").slice(0, 300));
  check("and the panel says which one", (await page.getByRole("status", { name: "Sync status" }).innerText()).includes("changed in the repository"), await page.getByRole("status", { name: "Sync status" }).innerText());
  repos["acme/ds"].main.set("src/components/Banner.tsx", repos["acme/ds"].main.get("src/components/Banner.tsx").replace("// changed elsewhere\n", ""));
  await page.locator('nav button[title="Components"]').click().catch(() => {});
  await page.locator('nav button[title="Source control"]').click();
  // The editor looks again when the files change; a nudge is a new edit to the same file.
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor({ timeout: 60000 });
  await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("button", { name: "Push" }).waitFor();
  await page.waitForFunction(() => !/changed in the repository/.test(document.querySelector('[aria-label="Sync status"]')?.textContent ?? ""), null, { timeout: 20000 });
  await page.getByRole("button", { name: "Push" }).click();
  await page.waitForFunction(() => /In sync with pull request #1/.test(document.querySelector('[aria-label="Sync status"]')?.textContent ?? ""), null, { timeout: 20000 });
  const pr = prs[prs.length - 1];
  check("one pull request in all, from a working branch, against the branch that was imported", prs.length === 1 && /^motif\/changes-/.test(pr.head) && pr.base === "main" && pr.title === "Changes from Motif");
  const original = repos["acme/ds"].main.get("src/components/Button.tsx").split("\n");
  const edited = repos["acme/ds"][pr.head].get("src/components/Button.tsx").split("\n");
  const diff = edited.flatMap((l, i) => (l === original[i] ? [] : [`${original[i].trim()} => ${l.trim()}`]));
  check("Button changes by exactly the two edited class strings", edited.length === original.length && diff.length === 2 && diff[0].includes("gap-2") && diff[0].includes("gap-4") && diff[1].includes("bg-primary text-primary-foreground") && diff[1].includes("bg-danger text-primary-foreground"), diff.join(" | "));
  const banner = repos["acme/ds"][pr.head].get("src/components/Banner.tsx");
  check("Banner has its text, order and structure changed", banner.includes("Welcome") && banner.indexOf("<p") < banner.indexOf("<h2") && banner.split("<p").length === 3 && !banner.includes("<small>") && banner.includes("flex-row"));
  check("no other file was touched", Object.keys(Object.fromEntries([...repos["acme/ds"][pr.head]].filter(([p, t]) => t !== repos["acme/ds"].main.get(p)))).sort().join() === "src/components/Banner.tsx,src/components/Button.tsx");
  check("the description lists what was done and the files", pr.body.includes("button: gap 2 → 4") && pr.body.includes("h2: text") && pr.body.includes("`src/components/Banner.tsx`"), pr.body.slice(0, 400));
  check("the base branch is untouched", repos["acme/ds"].main.get("src/components/Button.tsx").includes("gap-2 whitespace-nowrap"));
  check("the changes stay in the editor, marked as in the pull request, until it is merged", (await page.getByLabel("In the pull request").innerText()).includes("src/components/Button.tsx"));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
