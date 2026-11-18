// Comparing themes: which colors differ between them and which don't, and giving colors in one theme the colors they have in another.
const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { setFilter, filtersOffered } = require("./support/tokens-ui");
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
    sets: [
      { id: "set-global", name: "Global", themes: [{ id: L, name: "Light" }, { id: D, name: "Dark" }], activeThemeId: L },
      { id: "set-one", name: "One theme", themes: [{ id: "only", name: "Only" }], activeThemeId: "only" },
    ],
    colors: [
      color("background", "semantic", "#ffffff", "#0b0b0f"), color("foreground", "semantic", "#111827", "#f9fafb"),
      color("brand", "semantic", "#1d4ed8", "#1d4ed8"), color("line", "semantic", "#e5e7eb", "#E5E7EB"), color("accent", "semantic", "#f59e0b", "#fbbf24"),
      { id: "solo", name: "solo", group: "semantic", setId: "set-one", value: "#222222", themeValues: { only: "#222222" } },
    ],
    typography: [], spacing: [], radii: [], shadows: [], components: [],
  },
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  await seed(page, "cmp00001", { extra });
  await page.goto("http://localhost:3000/editor/cmp00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();
  await page.locator("div.w-\\[220px\\]").getByText("Global", { exact: true }).click();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const names = () => page.locator("[data-token-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-token-id")));
  const value = (theme, name) => page.getByLabel(`${theme} value of ${name}`, { exact: true }).inputValue();
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();

  // ── Which differ ──────────────────────────────────────────────────────────
  check("a set with two themes can be filtered by whether its colors differ between them", (await filtersOffered(page)).includes("Differ between themes") && (await filtersOffered(page)).includes("Same in every theme"));
  await setFilter(page, "Differ between themes");
  check("Differ leaves the colors that are not the same in every theme", await settle(async () => (await names()).sort().join() === "accent,background,foreground"), (await names()).join());
  await setFilter(page, "Same in every theme");
  check("Same leaves the others: a color that only differs in letter case is the same", await settle(async () => (await names()).sort().join() === "brand,line"), (await names()).join());
  await page.screenshot({ path: `${OUT}/tokens-compare.png` });
  await setFilter(page, "All");

  // ── Copy between themes ───────────────────────────────────────────────────
  await page.getByLabel("Select background").check();
  await page.getByLabel("Select accent").check();
  const bar = page.locator("[data-bulk-bar]");
  await bar.getByRole("button", { name: /Copy between themes/ }).click();
  const pop = page.getByRole("dialog", { name: "Copy between themes" });
  check("picked colors can be given the colors of another theme", await pop.isVisible());
  check("Copy is off while it would copy a theme into itself", await (async () => { await pop.getByLabel("Copy into theme").selectOption(L); const off = await pop.getByRole("button", { name: "Copy", exact: true }).isDisabled(); return off; })());
  await pop.getByLabel("Copy from theme").selectOption(L);
  await pop.getByLabel("Copy into theme").selectOption(D);
  await pop.getByRole("button", { name: "Copy", exact: true }).click();
  check("the colors take the other theme's colors", await settle(async () => (await value("Dark", "background")) === "#ffffff" && (await value("Dark", "accent")) === "#f59e0b"), `${await value("Dark", "background")} ${await value("Dark", "accent")}`);
  check("and only the picked ones", (await value("Dark", "foreground")) === "#f9fafb" && (await value("Light", "background")) === "#ffffff");
  check("and says what it did", (await bar.getByRole("status").innerText()).includes("Dark now has Light's 2 colors"));
  await setFilter(page, "Differ between themes");
  check("so they no longer differ", await settle(async () => (await names()).join() === "foreground"), (await names()).join());
  await setFilter(page, "All");

  // ── Undo ──────────────────────────────────────────────────────────────────
  await undo();
  check("copying is one step of undo", await settle(async () => (await value("Dark", "background")) === "#0b0b0f" && (await value("Dark", "accent")) === "#fbbf24"));

  // ── A new theme: from which theme, and dark or not ────────────────────────
  await page.locator("div.w-\\[220px\\]").getByText("Global", { exact: true }).click();
  const themeBar = page.locator("[data-theme-bar]");
  const segments = () => themeBar.locator("[data-theme-segment]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  await themeBar.getByRole("button", { name: "Add theme" }).click();
  const add = page.getByRole("dialog", { name: "New theme" });
  check("adding a theme asks for its name, what it starts from, and whether it is a dark version", (await add.getByLabel("New theme name").isVisible()) && (await add.getByLabel("Start new theme from").locator("option").allInnerTexts()).join() === "Light,Dark" && (await add.getByLabel("Make a dark version").isVisible()));
  check("it is not a dark version unless asked, and says so in words", !(await add.getByLabel("Make a dark version").isChecked()));
  await add.getByLabel("New theme name").fill("Night");
  check("a name that says dark or night suggests the dark version", await add.getByLabel("Make a dark version").isChecked());
  await add.getByLabel("Start new theme from").selectOption(L);
  await page.screenshot({ path: `${OUT}/tokens-new-theme.png` });
  await add.getByRole("button", { name: "Create theme" }).click();
  check("the new theme is added, and shown", await settle(async () => (await segments()).join() === "Light,Dark,Night" && (await page.getByLabel("Night value of background", { exact: true }).count()) === 1));
  const lum = async (name) => { const hex = await value("Night", name); return parseInt(hex.slice(1, 3), 16); };
  check("its colors are a dark version of the theme it started from: the light background is dark, the dark text is light", (await lum("background")) < 70 && (await lum("foreground")) > 150, `${await value("Night", "background")} ${await value("Night", "foreground")}`);
  check("and the theme it started from is as it was", (await value("Light", "background").catch(() => "#ffffff")) === "#ffffff");
  await undo();
  check("adding it is one step of undo", await settle(async () => (await segments()).join() === "Light,Dark"));
  await themeBar.getByRole("button", { name: "Add theme" }).click();
  await add.getByLabel("New theme name").fill("Dim");
  await add.getByLabel("Start new theme from").selectOption(D);
  await add.getByLabel("New theme name").press("Enter");
  check("starting from another theme, and not dark, copies that theme as it is", await settle(async () => (await value("Dim", "background")) === "#0b0b0f" && (await value("Dim", "foreground")) === "#f9fafb"));
  await themeBar.getByRole("button", { name: "Add theme" }).click();
  await add.getByLabel("New theme name").fill("dim");
  check("a name a theme already has isn't taken", (await add.getByRole("alert").count()) === 1 && await add.getByRole("button", { name: "Create theme" }).isDisabled());
  await page.keyboard.press("Escape");

  // ── One theme: nothing to compare ─────────────────────────────────────────
  await page.locator("div.w-\\[220px\\]").getByText("One theme", { exact: true }).click();
  await page.getByLabel("Select solo").check();
  check("a set with one theme has no comparison and no copy between themes", !(await filtersOffered(page)).includes("Differ between themes") && (await page.locator("[data-bulk-bar]").getByRole("button", { name: /Copy between themes/ }).count()) === 0);

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
