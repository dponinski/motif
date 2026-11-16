const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { OUT } = require("./support/env");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

const L = "theme-l", D = "theme-d";
const color = (name, group, l, d) => ({ id: name, name, group, setId: "set-global", value: l, themeValues: { [L]: l, [D]: d } });
const extra = {
  tokens: {
    sets: [{ id: "set-global", name: "Global", themes: [{ id: L, name: "Light" }, { id: D, name: "Dark" }], activeThemeId: L }],
    colors: [color("background", "semantic", "#ffffff", "#0b0b0f"), color("foreground", "semantic", "#111827", "#f9fafb"), color("brand", "semantic", "#1d4ed8", "#60a5fa")],
    typography: [], spacing: [], radii: [], shadows: [], components: [],
  },
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  await seed(page, "thm00001", { extra });
  await page.goto("http://localhost:3000/editor/thm00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.getByRole("tab", { name: /Colors/ }).waitFor();
  await page.getByRole("button", { name: "List", exact: true }).click();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const bar = page.locator("[data-theme-bar]");
  const segments = () => bar.locator("[data-theme-segment]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  const pressed = () => bar.locator('[role="group"] button[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  const columns = () => page.locator("[data-list-head], div").filter({ hasText: /^Name/ }).first().innerText();
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const redo = () => page.getByRole("button", { name: "Redo", exact: true }).click();
  const menu = async (theme, item) => { await bar.getByLabel(`Theme menu: ${theme}`).click(); await page.getByRole("menuitem", { name: item }).click(); };
  const value = (theme) => page.getByLabel(`${theme} value of background`, { exact: true }).inputValue();

  // ── Where the themes are ──────────────────────────────────────────────────
  check("the themes are in a bar over the colors, with all of them shown", (await segments()).join() === "Light,Dark" && (await pressed()).join() === "All", `${await segments()} | ${await pressed()}`);
  check("and no longer as chips in the sidebar", (await page.getByRole("button", { name: "Add theme" }).count()) === 1 && (await page.locator("div.w-\\[220px\\]").getByText("Themes", { exact: true }).count()) === 0);
  check("with all shown, both themes are columns of the list", (await value("Light")) === "#ffffff" && (await value("Dark")) === "#0b0b0f");

  // ── Showing one ───────────────────────────────────────────────────────────
  await bar.getByRole("button", { name: "Dark", exact: true }).click();
  check("a theme shown alone leaves only its column", await settle(async () => (await page.getByLabel("Light value of background", { exact: true }).count()) === 0 && (await value("Dark")) === "#0b0b0f"));
  check("and is the one pressed", (await pressed()).join() === "Dark");
  await bar.getByRole("button", { name: "All themes", exact: true }).click();
  check("All shows both again", await settle(async () => (await page.getByLabel("Light value of background", { exact: true }).count()) === 1));
  const history = () => page.getByRole("button", { name: "Undo", exact: true }).isDisabled();
  check("switching themes is not an edit to undo", await history());

  // ── Adding ────────────────────────────────────────────────────────────────
  await bar.getByRole("button", { name: "Add theme" }).click();
  await bar.getByLabel("New theme name").fill("Light");
  await bar.getByLabel("New theme name").press("Enter");
  check("a name a theme already has isn't taken", (await bar.locator('[role="alert"]').count()) === 1 && (await segments()).join() === "Light,Dark");
  await bar.getByLabel("New theme name").fill("Sepia");
  await bar.getByLabel("New theme name").press("Enter");
  check("a new theme is added, starts as a copy of the theme that was open (Dark) and is shown", await settle(async () => (await segments()).join() === "Light,Dark,Sepia" && (await pressed()).join() === "Sepia" && (await value("Sepia")) === "#0b0b0f"), `${await segments()} | ${await pressed()}`);
  check("adding is a step of undo", !(await history()));
  await undo();
  check("which takes it back", await settle(async () => (await segments()).join() === "Light,Dark"));
  await redo();
  check("and puts it back", await settle(async () => (await segments()).join() === "Light,Dark,Sepia"));

  // ── Renaming ──────────────────────────────────────────────────────────────
  await menu("Sepia", "Rename");
  await bar.getByLabel("Name of Sepia").fill("Warm");
  await bar.getByLabel("Name of Sepia").press("Enter");
  check("a theme is renamed from its menu", await settle(async () => (await segments()).join() === "Light,Dark,Warm"));
  await bar.getByRole("button", { name: /^Dark$/ }).dblclick();
  await bar.getByLabel("Name of Dark").fill("Night");
  await bar.getByLabel("Name of Dark").press("Escape");
  check("Escape gives a rename up", (await segments()).join() === "Light,Dark,Warm");
  await undo();
  check("renaming is a step of undo", await settle(async () => (await segments()).join() === "Light,Dark,Sepia"));

  // ── Duplicating ───────────────────────────────────────────────────────────
  await menu("Dark", "Duplicate");
  check("a theme is duplicated next to the original, and the copy is shown", await settle(async () => (await segments()).join() === "Light,Dark,Dark copy,Sepia" && (await pressed()).join() === "Dark copy" && (await value("Dark copy")) === "#0b0b0f"), `${await segments()}`);
  await bar.getByRole("button", { name: "All themes", exact: true }).click();

  // ── Deleting ──────────────────────────────────────────────────────────────
  await menu("Dark copy", "Delete");
  check("a theme is deleted from its menu", await settle(async () => (await segments()).join() === "Light,Dark,Sepia"));
  await undo();
  check("and deleting is a step of undo", await settle(async () => (await segments()).join() === "Light,Dark,Dark copy,Sepia"));
  await redo();
  await settle(async () => (await segments()).join() === "Light,Dark,Sepia");
  await segments();
  await page.locator('[data-theme-segment]').filter({ hasText: "Sepia" }).click({ button: "right" });
  check("the right button opens the same menu", (await page.getByRole("menuitem", { name: "Duplicate" }).count()) === 1);
  await page.keyboard.press("Escape");

  // ── The last theme can't be deleted ───────────────────────────────────────
  for (const name of ["Sepia", "Dark"]) await menu(name, "Delete");
  await settle(async () => (await segments()).join() === "Light");
  await bar.getByLabel("Theme menu: Light").click();
  check("a set keeps at least one theme", (await page.getByRole("menuitem", { name: /Delete/ }).getAttribute("data-disabled")) !== null);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/tokens-themes.png` });

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
