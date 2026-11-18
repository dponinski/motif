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
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const bar = page.locator("[data-theme-bar]");
  const segments = () => bar.locator("[data-theme-segment]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  // The theme the editor shows.
  const pressed = () => bar.locator("[data-theme-open]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const redo = () => page.getByRole("button", { name: "Redo", exact: true }).click();
  const menu = async (theme, item) => { await bar.getByLabel(`Theme menu: ${theme}`).click(); await page.getByRole("menuitem", { name: item }).click(); };
  // Deleting a theme asks first.
  const remove = async (theme) => { await menu(theme, "Delete"); await page.getByRole("dialog").getByRole("button", { name: "Delete theme" }).click(); await page.getByRole("dialog").waitFor({ state: "detached" }); };
  const value = (theme) => page.getByLabel(`${theme} value of background`, { exact: true }).inputValue();

  // ── Where the themes are ──────────────────────────────────────────────────
  check("the themes are the columns of the table, with the one the editor shows marked", (await segments()).join() === "Light,Dark" && (await pressed()).join() === "Light", `${await segments()} | ${await pressed()}`);
  check("and no longer chips in the sidebar or a bar over the table", (await page.getByRole("button", { name: "Add theme" }).count()) === 1 && (await page.locator("div.w-\\[220px\\]").getByText("Themes", { exact: true }).count()) === 0 && (await page.getByRole("button", { name: "All themes" }).count()) === 0);
  check("every theme is shown, a value for each", (await value("Light")) === "#ffffff" && (await value("Dark")) === "#0b0b0f");

  // ── The theme the editor shows ────────────────────────────────────────────
  await menu("Dark", "Show in the editor");
  check("a theme is shown in the editor from its menu", await settle(async () => (await pressed()).join() === "Dark"));
  const history = () => page.getByRole("button", { name: "Undo", exact: true }).isDisabled();
  check("which is not an edit to undo", await history());

  // ── Adding ────────────────────────────────────────────────────────────────
  await bar.getByRole("button", { name: "Add theme" }).click();
  await page.getByLabel("New theme name").fill("Light");
  await page.getByLabel("New theme name").press("Enter");
  check("a name a theme already has isn't taken", (await page.getByRole("dialog", { name: "New theme" }).locator('[role="alert"]').count()) === 1 && (await segments()).join() === "Light,Dark");
  await page.getByLabel("New theme name").fill("Sepia");
  await page.getByLabel("New theme name").press("Enter");
  check("a new theme is added, starts as a copy of the theme the editor showed (Dark) and is the one it shows", await settle(async () => (await segments()).join() === "Light,Dark,Sepia" && (await pressed()).join() === "Sepia" && (await value("Sepia")) === "#0b0b0f"), `${await segments()} | ${await pressed()}`);
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
  check("a theme is duplicated next to the original, and the copy is the one the editor shows", await settle(async () => (await segments()).join() === "Light,Dark,Dark copy,Sepia" && (await pressed()).join() === "Dark copy" && (await value("Dark copy")) === "#0b0b0f"), `${await segments()}`);

  // ── Deleting ──────────────────────────────────────────────────────────────
  await menu("Dark copy", "Delete");
  check("it asks first, and Cancel leaves the theme", (await page.getByRole("dialog").innerText()).includes("Delete the Dark copy theme?") && await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click().then(() => true) && (await segments()).join() === "Light,Dark,Dark copy,Sepia");
  await remove("Dark copy");
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
  for (const name of ["Sepia", "Dark"]) await remove(name);
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
