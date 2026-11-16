// A component and a token change in one pull request, one commit; then merged.
const { chromium } = require("playwright");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { tokensLinked } = require("./support/git-panel");
const { createFake } = require("./support/fake-github");

const { OUT } = require("./support/env");
const APP = "http://localhost:3000";
const TOKENS = ["/* Design tokens, kept in sync with Motif. */", "", ":root {", "  --primary: #3366ff;", "  --surface: #ffffff;", "  --space-2: 8px;", "  --space-4: 16px;", "  --radius-md: 6px;", "}", ""].join("\n");
const gh = createFake({ name: "new", files: { "README.md": "# new", "src/styles/tokens.css": TOKENS } });
const repo = gh.repo;

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
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const status = () => page.getByRole("status", { name: "Sync status" }).innerText().catch(() => "");
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const dialog = page.getByRole("dialog");

  await seed(page, "mixed001", { repo: "acme/new", token: "t", name: "New system" });
  await page.goto(`${APP}/editor/mixed001`);
  await page.getByRole("heading", { name: "Start building" }).waitFor({ timeout: 90000 });

  // Link the repository's tokens to a Motif set.
  await nav("Source control");
  await tokensLinked(page);

  // A component made here, and a token edited in Motif.
  await nav("Components");
  await page.getByRole("button", { name: /New component/ }).first().click();
  await dialog.getByLabel("Component name").fill("Card");
  await dialog.getByRole("button", { name: "Create component" }).click();
  await stage.locator(".card").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("motif-projects"));
    const t = raw.state.projects[0].tokens;
    const set = t.sets.find((s) => s.name === "acme/new");
    const light = set.themes[0].id;
    const c = t.colors.find((x) => x.setId === set.id && x.name === "primary");
    c.themeValues[light] = "#ff0000";
    c.value = "#ff0000";
    localStorage.setItem("motif-projects", JSON.stringify(raw));
  });
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor({ timeout: 60000 });
  await page.locator('nav button[title="Source control"]').click();
  check("the Sync panel counts both: the component's files and the token change", await settle(async () => (await status()).includes("4 files and 1 token change waiting to sync")), await status());
  check("nothing has been sent", repo.prs.length === 0 && repo.commitLog.length === 0);
  await page.screenshot({ path: `${OUT}/sync-mixed.png` });
  await page.getByRole("button", { name: "Push" }).click();
  await page.getByRole("status", { name: "Sync status" }).getByText(/In sync with pull request #1/).waitFor({ timeout: 30000 });
  check("one pull request, with one commit holding the component and the token change", repo.prs.length === 1 && repo.commitLog.length === 1, JSON.stringify(repo.commitLog.map((c) => c.message)));
  const tree = gh.files(repo.prs[0].head);
  const changed = [...tree].filter(([p, t]) => t !== gh.files("main").get(p)).map(([p]) => p).sort().join();
  check("the files are the component's and the tokens file", changed === "package.json,src/components/Card.css,src/components/Card.tsx,src/index.ts,src/styles/tokens.css", changed);
  check("the token is changed in the tokens file", /--primary:\s*#ff0000/i.test(tree.get("src/styles/tokens.css")), tree.get("src/styles/tokens.css"));
  const body = repo.prs[0].body;
  check("the description has both steps", body.includes("- Create the Card component") && body.includes("- Update 1 design token from Motif") && body.includes("  - `primary`"), body.slice(0, 500));

  // Merged: the token badge goes, the link moves on.
  gh.merge(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText(/was merged/).first().waitFor({ timeout: 30000 });
  check("when merged, nothing is left to send", await settle(async () => (await status()).includes("Nothing to sync")), await status());
  await page.waitForTimeout(1800);
  const link = await page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].repo.tokenLink);
  check("the link has moved on to the merged tokens, with nothing staged", link.staged === null && link.base.primary.values.default === "#ff0000", JSON.stringify(link.base.primary));
  await nav("Source control");
  await page.getByRole("button", { name: "Sync tokens" }).click();
  check("the Tokens dialog says the two sides agree", await dialog.getByText("Motif and the repository have the same tokens.").waitFor({ timeout: 30000 }).then(() => true, async () => { console.log((await dialog.innerText()).slice(0, 400)); return false; }));

  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
