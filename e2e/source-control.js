// One Source control panel: Pull and Push side by side, what is waiting, the repository's details kept closed, and the sign-in block
// only for someone who can't send.
const { chromium } = require("playwright");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { openSourceControl, openDetails, componentsReady } = require("./support/git-panel");
const { syncNow } = require("./support/sync-helpers");
const { createFake } = require("./support/fake-github");

const { OUT } = require("./support/env");
const APP = "http://localhost:3000";
const TOKENS = ["/* Design tokens, kept in sync with Motif. */", "", ":root {", "  --primary: #3366ff;", "  --surface: #ffffff;", "  --space-2: 8px;", "  --radius-md: 6px;", "}", ""].join("\n");
const gh = createFake({ name: "ds", files: {
  "README.md": "# ds", "package.json": JSON.stringify({ name: "ds", dependencies: { react: "^19.0.0" }, devDependencies: { tailwindcss: "^4.0.0" } }),
  "src/styles/tokens.css": TOKENS,
  "src/components/Badge.tsx": 'export function Badge() {\n  return <span className="rounded-md bg-[#3366ff] px-2 text-white">Badge</span>;\n}\n',
  "src/index.ts": 'export { Badge } from "./components/Badge";\n',
} });

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 500) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates|status of 40\d|status of 50\d|status of 422/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", (r) => gh.handler(r));
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });
  const status = () => page.getByRole("status", { name: "Sync status" });
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const editMotif = async (fn) => {
    await page.waitForTimeout(1500);
    await page.evaluate((src) => {
      const raw = JSON.parse(localStorage.getItem("motif-projects"));
      new Function("state", src)(raw.state.projects[0].tokens);
      localStorage.setItem("motif-projects", JSON.stringify(raw));
    }, `(${fn.toString()})(state)`);
    await page.goto(`${APP}/editor/sc000001`);
    await page.getByText("Layers", { exact: true }).waitFor();
  };

  // ── The rail: one icon ────────────────────────────────────────────────────
  await seed(page, "sc000001", { repo: "acme/ds", token: "t", name: "DS" });
  await page.goto(`${APP}/editor/sc000001`);
  await page.getByText("Layers", { exact: true }).waitFor();
  await componentsReady(page);
  check("the rail has one Source control icon, in place of Git and Sync", (await page.locator('nav button[title="Source control"]').count()) === 1 && (await page.locator('nav button[title="Git"], nav button[title="Sync"], nav button[aria-label="Sync"]').count()) === 0);

  // ── Connected: read with nothing pressed, nothing to send ─────────────────
  await openSourceControl(page);
  check("the repository is linked and its link is said", (await page.locator("[data-token-link]").innerText()).includes("linked to this repository"));
  check("the repository and its branch are shown", (await page.getByRole("link", { name: "acme/ds" }).isVisible()) && (await page.getByText("main", { exact: true }).first().isVisible()));
  check("Pull and Push sit side by side", (await page.getByRole("button", { name: "Pull", exact: true }).isVisible()) && (await page.getByRole("button", { name: "Push" }).isVisible()));
  check("there is nothing to push, so Push is off", (await page.getByRole("button", { name: "Push" }).isDisabled()) && (await status().innerText()).includes("Nothing to sync"));
  check("no token is asked for when the account can send", (await page.getByLabel("Access token").count()) === 0);
  check("the details of the repository are kept closed", (await page.locator("[data-details]").getAttribute("open")) === null);
  await page.screenshot({ path: `${OUT}/source-control-idle.png` });
  await openDetails(page);
  check("opening them shows the scan, the branch to scan and the report", (await page.getByText(/tokens · \d+ components/).isVisible()) && (await page.getByLabel("Branch to scan").isVisible()) && (await page.getByRole("button", { name: "Open report" }).isVisible()));
  await page.locator("[data-details] summary").click();

  // ── A token made here is waiting, and goes out with Push ──────────────────
  await editMotif((state) => {
    const set = state.sets[0];
    const light = set.themes[0].id;
    const c = state.tokens.find((x) => x.type === "color" && x.setId === set.id && x.name === "primary");
    c.values[light] = "#ff0000";
    c.value = "#ff0000";
  });
  await openSourceControl(page);
  await status().getByText(/1 token change waiting to sync/).waitFor({ timeout: 30000 });
  check("the change is listed under Token changes, and Push counts it", (await page.getByLabel("Token changes").locator("li").count()) === 1 && (await page.getByRole("button", { name: "Push" }).isEnabled()) && (await page.getByRole("button", { name: "Push" }).innerText()).includes("(1)"));
  check("the rail dot says something is waiting", (await page.locator('nav [data-testid="sync-dot"]').getAttribute("data-status")) === "waiting");
  await page.screenshot({ path: `${OUT}/source-control-waiting.png` });
  await syncNow(page, 1);
  check("Push opens one pull request, and the panel links it", gh.repo.prs.length === 1 && (await page.getByRole("link", { name: /#1/ }).first().isVisible()));
  check("the status says it is in sync with it", (await status().innerText()).includes("In sync with pull request #1"));
  check("the pull request carries the token's new value", gh.files(gh.repo.prs[0].head).get("src/styles/tokens.css").includes("--primary: #ff0000;"));
  await page.screenshot({ path: `${OUT}/source-control-sent.png` });

  // ── The repository moves: Pull brings it in ───────────────────────────────
  gh.push("main", "src/styles/tokens.css", TOKENS.replace("--surface: #ffffff;", "--surface: #fafafa;"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator("[data-behind-note]").waitFor({ timeout: 30000 });
  check("when the repository has changed, the panel and the rail say so", (await page.locator("[data-behind]").count()) === 1 && (await page.locator('nav [data-testid="behind-dot"]').count()) === 1);
  await page.getByRole("button", { name: "Pull", exact: true }).click();
  await page.locator("[data-pull-notice]").getByText(/from the repository/).waitFor({ timeout: 30000 });
  check("Pull takes the change in without asking, and the notes go", (await page.locator("[data-behind-note]").count()) === 0 && (await page.locator('nav [data-testid="behind-dot"]').count()) === 0);
  await page.waitForTimeout(1800);
  const surface = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens;
    const c = p.tokens.find((x) => x.type === "color" && x.name === "surface");
    return Object.values(c.values)[0];
  });
  check("the token in Motif has the repository's value", surface === "#fafafa", surface);
  await page.screenshot({ path: `${OUT}/source-control-pulled.png` });

  // ── Signed out: the token block is there, and only then ───────────────────
  await seed(page, "sc000002", { repo: "acme/ds", token: "", name: "Signed out" });
  await page.goto(`${APP}/editor/sc000002`);
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Source control"]').click();
  await page.getByLabel("Access token").waitFor({ timeout: 30000 });
  check("someone who can't send is asked to sign in or add a token", await page.getByRole("button", { name: "Add token" }).isVisible());
  check("and Push is off for them", await page.getByRole("button", { name: "Push" }).isDisabled());
  await page.screenshot({ path: `${OUT}/source-control-signed-out.png` });

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
