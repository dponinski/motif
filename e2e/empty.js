// Starting from an empty repository: land on the build screen, add tokens and Tailwind to the pull request, make the first commit, Sync.
const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { createFake } = require("./support/fake-github");
const { syncNow } = require("./support/sync-helpers");

const { OUT } = require("./support/env");
const APP = "http://localhost:3000";
const gh = createFake({ name: "new", files: {}, empty: true });
const repo = gh.repo;

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates|status of 409|status of 404/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", (r) => gh.handler(r));
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };

  // A project for the empty repository, with two colors made in Motif.
  await seed(page, "empty001", {
    repo: "acme/new", token: "t", name: "New system",
    extra: {
      tokens: {
        sets: [{ id: "set-global", name: "Global", themes: [{ id: "theme-default", name: "Default" }], activeThemeId: "theme-default" }],
        colors: [
          { id: "c1", name: "primary", value: "#3366ff", group: "brand", setId: "set-global", themeValues: { "theme-default": "#3366ff" } },
          { id: "c2", name: "surface", value: "#ffffff", group: "base", setId: "set-global", themeValues: { "theme-default": "#ffffff" } },
        ],
        typography: [], spacing: [], radii: [], shadows: [], components: [],
      },
    },
  });

  // ── Landing ───────────────────────────────────────────────────────────────
  await page.goto(`${APP}/editor/empty001`);
  await page.getByRole("heading", { name: "Start building" }).waitFor({ timeout: 90000 });
  check("a project that was never read reads its repository by itself and lands on the build screen", true);
  check("with no components, it says to start building", (await page.locator("main").innerText()).includes("no components yet"));
  await page.locator("[data-first-commit]").waitFor({ timeout: 10000 });
  check("and says the repository has no commits, offering to make the first one", (await page.locator("[data-first-commit]").innerText()).includes("no commits yet") && await page.getByRole("button", { name: "Create README.md on main" }).isVisible());
  check("the build screen offers tokens and a framework", await page.getByRole("button", { name: /Add tokens/ }).isVisible() && await page.getByRole("button", { name: /Add a framework/ }).isVisible());
  await page.screenshot({ path: `${OUT}/empty-build.png` });

  // ── Tokens go into the pull request before there is a commit: only Sync needs one ─────────────
  await page.getByRole("button", { name: /Add tokens/ }).click();
  await page.getByRole("button", { name: "Repo sync" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add to pull request" }).waitFor({ timeout: 20000 });
  check("adding tokens needs no commit: the button is there, and no first-commit offer in the way", !(await dialog.getByRole("button", { name: "Add to pull request" }).isDisabled()) && (await dialog.locator("[data-first-commit]").count()) === 0);
  await dialog.getByRole("button", { name: "Add to pull request" }).click();
  await dialog.getByText(/Added 2 tokens in src\/styles\/tokens\.css to your pull request/).waitFor({ timeout: 30000 });
  check("and says they are in the pull request, to be sent with Sync", repo.writes.length === 0 && repo.prs.length === 0);
  await page.screenshot({ path: `${OUT}/empty-sync-before.png` });
  await page.keyboard.press("Escape");

  // ── Adding Tailwind goes into the same pull request ───────────────────────
  await nav("Components");
  await page.getByRole("heading", { name: "Start building" }).waitFor();
  await page.getByRole("button", { name: /Add a framework/ }).click();
  await dialog.locator("[data-plan]").waitFor({ timeout: 30000 });
  const planText = await dialog.locator("[data-plan]").innerText();
  check("the framework dialog lists the files before anything is added, including the staged tokens file", planText.includes("package.json") && planText.includes("src/styles/tailwind.css") && planText.includes("src/styles/tokens.css"), planText);
  check("and says Motif does not set up the bundler", planText.includes("bundler"));
  await page.screenshot({ path: `${OUT}/empty-framework.png` });
  await dialog.getByRole("button", { name: "Add to pull request" }).click();
  await dialog.locator("[data-done]").waitFor({ timeout: 30000 });
  check("it is added to the pull request, with nothing sent", repo.prs.length === 0 && repo.writes.length === 0);
  await page.keyboard.press("Escape");
  check("the framework card is gone from the build screen straight away: Tailwind counts as there", await settle(async () => (await page.getByRole("button", { name: /Add a framework/ }).count()) === 0, 20000));

  // ── Sync needs the first commit; it is offered there ──────────────────────
  await page.locator('nav button[aria-label="Sync"]').click();
  await page.getByRole("status", { name: "Sync status" }).waitFor();
  check("the Sync panel counts what is waiting, and offers the first commit", (await page.getByRole("status", { name: "Sync status" }).innerText()).includes("waiting to sync") && await page.locator("[data-first-commit]").first().isVisible());
  check("and Sync is not offered until there is one", await page.getByRole("button", { name: "Sync now" }).isDisabled());
  await page.screenshot({ path: `${OUT}/empty-sync-first.png` });
  await page.locator("[data-first-commit]").first().getByRole("button", { name: "Create README.md on main" }).click();
  check("making the first commit writes a README to main with no branch or sha", await settle(async () => gh.branches().includes("main")) && repo.writes[0]?.file === "README.md" && repo.writes[0]?.first === true, JSON.stringify(repo.writes));
  check("and the panel moves on to sending", await settle(async () => (await page.locator("[data-first-commit]").count()) === 0 && !(await page.getByRole("button", { name: "Sync now" }).isDisabled())));
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.getByRole("status", { name: "Sync status" }).getByText(/In sync with pull request #1/).waitFor({ timeout: 30000 });
  const pr = repo.prs[0];
  check("one pull request holds the tokens and the framework", repo.prs.length === 1 && pr.base === "main" && /^motif\/changes-/.test(pr.head) && pr.title === "Changes from Motif");
  const tree = gh.files(pr.head);
  const changedFiles = [...tree].filter(([p, t]) => t !== gh.files("main").get(p)).map(([p]) => p).sort().join();
  check("and only those files", changedFiles === "package.json,src/styles/tailwind.css,src/styles/tokens.css", changedFiles);
  const tokens = tree.get("src/styles/tokens.css");
  check("the tokens are variables, in the form Tailwind reads", tokens.includes(":root {") && tokens.includes("--primary: #3366ff;") && tokens.includes("--surface: #ffffff;") && tokens.includes("@theme inline") && tokens.includes("--color-primary: var(--primary)"), tokens);
  const pkg = JSON.parse(tree.get("package.json"));
  check("with a package.json that has tailwindcss", pkg.devDependencies.tailwindcss === "^4.0.0" && pkg.private === true);
  check("a stylesheet that starts Tailwind and imports the tokens", tree.get("src/styles/tailwind.css") === '@import "tailwindcss";\n@import "./tokens.css";\n');
  check("the description lists the token and framework steps", pr.body.includes("- Add 2 design tokens from Motif") && pr.body.includes("- Add Tailwind CSS v4") && pr.body.includes("To do: Import src/styles/tailwind.css"), pr.body.slice(0, 700));
  await page.screenshot({ path: `${OUT}/empty-sync-after.png` });

  // ── Merged ────────────────────────────────────────────────────────────────
  gh.merge(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText(/was merged/).first().waitFor({ timeout: 30000 });
  await nav("Git");
  check("once merged and read again, the Git panel reads the repository as using Tailwind", await settle(async () => /Tailwind/i.test(await page.locator("body").innerText({ timeout: 2000 })), 15000));
  await page.screenshot({ path: `${OUT}/empty-after-framework.png` });

  // ── Reloading keeps the project ──────────────────────────────────────────
  await page.goto(`${APP}/editor/empty001`);
  await page.getByRole("heading", { name: "Start building" }).waitFor({ timeout: 60000 });
  check("a reload goes straight to the build screen, with no first-commit prompt now", (await page.locator("[data-first-commit]").count()) === 0);

  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
