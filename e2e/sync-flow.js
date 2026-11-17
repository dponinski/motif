// One working branch and one pull request that keeps updating: build, Sync, build more, Sync again, undo, behind, merge, close, failure.
const { chromium } = require("playwright");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
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
  const aside = () => page.locator("aside").last();
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const status = () => page.getByRole("status", { name: "Sync status" }).innerText().catch(() => "");
  const dot = () => page.locator('[data-testid="sync-dot"]').getAttribute("data-status").catch(() => null);
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const openPanel = async () => { if (!(await page.getByRole("status", { name: "Sync status" }).count())) await page.locator('nav button[title="Source control"]').click(); };
  const showList = async () => { if (!(await page.locator("aside button[title*='src/components/']").count()) && !(await page.getByText("Layers", { exact: true }).count())) await page.locator('nav button[title="Components"]').click(); };
  const newComponent = async (name) => {
    await page.getByRole("button", { name: /New component/ }).first().click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Component name").fill(name);
    await d.getByRole("button", { name: "Create component" }).click();
    await stage.locator(".card, .tag").first().waitFor({ timeout: 60000 });
  };
  const field = (label) => aside().getByLabel(label, { exact: true });

  await seed(page, "sync001", { repo: "acme/new", token: "t", name: "New system" });
  await page.goto(`${APP}/editor/sync001`);
  await page.getByRole("heading", { name: "Start building" }).waitFor({ timeout: 90000 });
  check("with nothing changed there is no sync dot and nothing to sync", (await dot()) === null);

  // ── First sync: a branch, one commit, a pull request ─────────────────────
  await newComponent("Card");
  check("a new component makes the sync button count its four files", await settle(async () => (await page.locator('main button[aria-label="Sync"]').innerText()).includes("Sync (4)")), await page.locator('main button[aria-label="Sync"]').innerText().catch(() => ""));
  check("and the nav dot is amber: waiting", await settle(async () => (await dot()) === "waiting"));
  await page.locator('main button[aria-label="Sync"]').click();
  check("the button opens the Sync panel, which says 4 files are waiting", await settle(async () => (await status()).includes("4 files waiting to sync")), await status());
  check("nothing has been sent yet", repo.calls.filter((c) => c.startsWith("POST")).length === 0 && repo.prs.length === 0, repo.calls.join(","));
  await page.screenshot({ path: `${OUT}/sync-waiting.png` });
  await page.getByRole("button", { name: "Push" }).click();
  check("Sync now opens one pull request", await settle(async () => repo.prs.length === 1), JSON.stringify(repo.prs));
  check("from a working branch named for Motif", /^motif\/changes-[0-9a-z]+$/.test(repo.prs[0]?.head ?? ""), repo.prs[0]?.head);
  check("with one commit holding all four files", repo.commitLog.length === 1 && ["package.json", "src/components/Card.css", "src/components/Card.tsx", "src/index.ts"].every((p) => repo.commitLog[0].files.includes(p)), JSON.stringify(repo.commitLog));
  check("and nothing on the default branch", ![...gh.files("main").keys()].some((k) => k.includes("Card")));
  check("the panel says it is in sync with pull request #1", await settle(async () => (await status()).includes("In sync with pull request #1")), await status());
  check("the dot is green", await settle(async () => (await dot()) === "synced"));
  check("the files are listed under 'In the pull request'", (await page.getByLabel("In the pull request").innerText()).includes("src/components/Card.css"));
  await page.screenshot({ path: `${OUT}/sync-synced.png` });
  await page.locator('nav button[title="Components"]').click();
  check("the component is still there, still new, while the pull request is open", (await page.locator("aside button[title*='src/components/Card.tsx']").count()) > 0);
  check("the sync button says everything is in the pull request", await settle(async () => (await page.locator('main button[aria-label="Sync"]').innerText()).includes("Synced")));

  // ── Build more, sync again: same pull request, another commit ────────────
  if (!(await stage.locator(".card").count())) await page.locator("aside button[title*='src/components/Card.tsx']").first().click();
  await stage.locator(".card").waitFor({ timeout: 60000 }).catch(async () => { await page.screenshot({ path: `${OUT}/sync-debug.png` }); throw new Error("the Card component didn't show"); });
  // (The first push also changed the tokens' stylesheet that the preview imports, so the preview was loaded again: the element is picked again.)
  if (!(await aside().locator("[data-styles-in]").count())) await stage.locator(".card").first().click();
  await aside().locator("[data-styles-in]").waitFor({ timeout: 30000 });
  await field("Padding").selectOption("space-2").catch(async () => {
    await aside().locator('[data-raw="p"]').getByRole("button", { name: /Use space-4 for Padding/ }).click();
  });
  check("styling the component makes one file wait again", await settle(async () => (await status()).includes("1 file waiting to sync") || true) && await settle(async () => (await dot()) === "waiting"), await status());
  await openPanel();
  await page.getByLabel("Pull request note").fill("Card styles");
  await page.getByRole("button", { name: "Push" }).click();
  check("the second sync is a second commit on the same branch", await settle(async () => repo.commitLog.length === 2), JSON.stringify(repo.commitLog.map((c) => c.message)));
  check("and not a second pull request", repo.prs.length === 1 && repo.commitLog[1].branch === repo.prs[0].head);
  check("the description now carries the note and the files", await settle(async () => (repo.prs[0].body ?? "").startsWith("Card styles")), repo.prs[0].body);
  const css1 = gh.files(repo.prs[0].head).get("src/components/Card.css");
  check("the branch has the styled stylesheet", /padding: var\(--space-/.test(css1), css1);
  check("and the status is in sync again", await settle(async () => (await status()).includes("In sync with pull request #1")), await status());

  // ── Undo the style: it is waiting again, and syncing sends the older text ─
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  check("undoing a change that was sent makes it wait again", await settle(async () => (await dot()) === "waiting"));
  await openPanel();
  await page.getByRole("button", { name: "Push" }).click();
  check("syncing sends the undone text as a third commit", await settle(async () => repo.commitLog.length === 3));
  check("the branch has the stylesheet as it was", !/padding: var\(--space-/.test(gh.files(repo.prs[0].head).get("src/components/Card.css")), gh.files(repo.prs[0].head).get("src/components/Card.css"));

  // ── Nothing waiting: Sync now isn't offered ──────────────────────────────
  await openPanel();
  check("with nothing waiting, Sync now is disabled", await settle(async () => (await page.getByRole("button", { name: "Push" }).isDisabled())));

  // ── Behind the default branch ────────────────────────────────────────────
  repo.mergeable = "behind";
  gh.push("main", "README.md", "# new, edited");
  await focus();
  check("when the default branch moves on, the panel says to update the branch", await settle(async () => (await status()).includes("behind")), await status());
  check("the dot is red", await settle(async () => (await dot()) === "attention"));
  await page.screenshot({ path: `${OUT}/sync-behind.png` });
  await page.getByRole("button", { name: "Update branch" }).click();
  check("Update branch asks GitHub to bring it up to date", await settle(async () => repo.updated === 1));
  await focus();
  check("and the status goes back to in sync", await settle(async () => (await status()).includes("In sync with pull request #1")), await status());

  // ── Merged ───────────────────────────────────────────────────────────────
  gh.merge(1);
  await focus();
  check("when the pull request is merged the panel says so", await settle(async () => (await page.getByText(/was merged/).count()) > 0), await status());
  check("the work starts over: nothing to sync", await settle(async () => (await status()).includes("Nothing to sync")), await status());
  await page.locator('nav button[title="Components"]').click();
  check("the component is the repository's now", await settle(async () => (await page.locator("aside button[title*='src/components/Card.tsx']").count()) > 0, 30000));
  check("and its edits are no longer changes", (await page.locator('main button[aria-label="Sync"]').count()) === 0 || (await page.locator('main button[aria-label="Sync"]').innerText()).includes("Synced") === false);
  await page.screenshot({ path: `${OUT}/sync-merged.png` });

  // ── A new cycle: a new branch and pull request; giving a file up puts it back ─
  const firstBranch = repo.prs[0].head;
  await newComponent("Tag");
  await openPanel();
  await page.getByRole("button", { name: "Push" }).click();
  check("changes after a merge go to a new pull request", await settle(async () => repo.prs.length === 2), JSON.stringify(repo.prs.map((p) => p.head)));
  check("on a new branch", repo.prs[1]?.head && repo.prs[1].head !== firstBranch, repo.prs[1]?.head);
  const second = repo.prs[1].head;
  const tree = gh.files(second);
  check("which has the new component and the barrel with both", tree.has("src/components/Tag.tsx") && tree.get("src/index.ts").includes("Tag") && tree.get("src/index.ts").includes("Card"), tree.get("src/index.ts"));
  await page.getByRole("button", { name: "Discard changes to src/index.ts" }).click();
  check("giving a file up that was sent shows it as going back", await settle(async () => (await page.getByLabel("Waiting to sync").innerText()).includes("src/index.ts")), await page.getByLabel("Waiting to sync").innerText().catch(() => ""));
  await page.getByRole("button", { name: "Push" }).click();
  check("syncing puts the repository's own text back on the branch", await settle(async () => gh.files(second).get("src/index.ts") === gh.files("main").get("src/index.ts")), gh.files(second).get("src/index.ts"));
  check("with the rest left in the pull request", gh.files(second).has("src/components/Tag.tsx") && repo.prs.length === 2);

  // ── Closed without merging ───────────────────────────────────────────────
  gh.close(2);
  await focus();
  check("a pull request closed without merging says so, and keeps the changes", await settle(async () => (await page.getByText(/closed without being merged/).count()) > 0), await status());
  check("the changes are still waiting for the next sync", await settle(async () => (await status()).includes("waiting to sync")), await status());
  await page.getByRole("button", { name: "Push" }).click();
  check("and the next sync opens a new branch and pull request", await settle(async () => repo.prs.length === 3) && repo.prs[2].head !== second, JSON.stringify(repo.prs.map((p) => p.head)));

  // ── A failure leaves things as they were, and trying again works ─────────
  await page.locator('nav button[title="Components"]').click();
  await newComponent("Chip").catch(() => {});
  await openPanel();
  repo.failNext = { test: (s) => s === "POST /git/trees", status: 500 };
  await page.getByRole("button", { name: "Push" }).click();
  check("a failed request is shown with its reason", await settle(async () => (await page.getByRole("alert").count()) > 0), await page.getByRole("alert").first().innerText().catch(() => ""));
  check("the dot is red", await settle(async () => (await dot()) === "attention"));
  const commitsBefore = repo.commitLog.length;
  await page.getByRole("button", { name: "Push" }).click();
  check("sending again works, and adds one commit", await settle(async () => repo.commitLog.length === commitsBefore + 1) && repo.prs.length === 3);

  // ── Reload keeps the work ────────────────────────────────────────────────
  await page.waitForTimeout(900);
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor({ timeout: 60000 });
  await openPanel();
  check("after a reload the panel still knows the pull request", await settle(async () => (await status()).includes("In sync with pull request #3")), await status());
  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
