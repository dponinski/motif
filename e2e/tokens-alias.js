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
    colors: [
      color("gray-50", "gray", "#f9fafb", "#030712"), color("gray-900", "gray", "#111827", "#e5e7eb"),
      color("background", "semantic", "#ffffff", "#0b0b0f"), color("foreground", "semantic", "#000000", "#ffffff"),
    ],
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

  await seed(page, "talias01", { extra });
  await page.goto("http://localhost:3000/editor/talias01");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.getByRole("tab", { name: /Colors/ }).waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const swatch = (name) => page.locator(`button[aria-label^="${name}:"]`);
  const label = async (name) => (await swatch(name).getAttribute("aria-label")) ?? "";
  const editor = page.locator("[data-color-editor]");
  const openEditor = async (name) => { await page.keyboard.press("Escape"); await swatch(name).click(); await editor.waitFor(); };
  // A token added in the browser has an id of its own, so it is found by its name.
  const card = (name) => page.locator("[data-token-id]").filter({ has: page.locator(`button[aria-label^="${name}:"]`) });
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();

  // ── Making a color another token ─────────────────────────────────────────
  await openEditor("background");
  check("a color offers to be another token, in each theme", (await editor.getByLabel("Make background (Light) another token").count()) === 1 && (await editor.getByLabel("Make background (Dark) another token").count()) === 1);
  const options = await editor.getByLabel("Make background (Light) another token").locator("option").allInnerTexts();
  check("the choices are the other colors of the set, not itself", options.join() === "Make it another token…,gray-50,gray-900,foreground", options.join());
  await editor.getByLabel("Make background (Light) another token").selectOption({ label: "gray-50" });
  check("it then shows as that token, with that token's color", await settle(async () => (await editor.locator('[data-alias-field="theme-l"] [data-alias-chip]').innerText()).includes("gray-50") && (await editor.getByLabel("Light value of background").inputValue()) === "#f9fafb"));
  check("the other theme is left as it was", (await editor.getByLabel("Dark value of background").inputValue()) === "#0b0b0f");
  await editor.getByLabel("Make background (Dark) another token").selectOption({ label: "gray-900" });
  check("each theme can be a different token", await settle(async () => (await label("background")).includes("#f9fafb") && (await label("background")).includes("#e5e7eb")), await label("background"));
  check("the palette marks a color that is another token", await card("background").locator("[data-alias-mark]").isVisible());
  await page.screenshot({ path: `${OUT}/tokens-alias-editor.png` });

  // ── A loop is not offered ────────────────────────────────────────────────
  await openEditor("gray-50");
  const grayOptions = await editor.getByLabel("Make gray-50 (Light) another token").locator("option").allInnerTexts();
  check("a token that is this one is not offered to it", !grayOptions.includes("background"), grayOptions.join());
  check("it says what uses it", (await editor.locator("[data-used-by]").innerText()).includes("background"));

  // ── It follows the token ─────────────────────────────────────────────────
  await editor.getByLabel("Light value of gray-50").fill("#eeeeee");
  await editor.getByLabel("Light value of gray-50").press("Enter");
  check("when the token's color changes, so does what is that token", await settle(async () => (await label("background")).includes("#eeeeee")), await label("background"));
  await undo();
  check("and undo takes it back, both", await settle(async () => (await label("background")).includes("#f9fafb") && (await label("gray-50")).includes("#f9fafb")));

  // ── Typing a color detaches ──────────────────────────────────────────────
  await openEditor("background");
  await editor.getByLabel("Dark value of background").fill("#222222");
  await editor.getByLabel("Dark value of background").press("Enter");
  check("a color typed over an alias is that color from then on", await settle(async () => (await editor.locator('[data-alias-field="theme-d"] [data-alias-chip]').count()) === 0 && (await label("background")).includes("#222222")));
  check("the other theme still follows its token", (await editor.locator('[data-alias-field="theme-l"] [data-alias-chip]').count()) === 1);

  // ── Detach, keeping the color ────────────────────────────────────────────
  await editor.getByRole("button", { name: /Detach background \(Light\)/ }).click();
  check("detaching keeps the color and stops following", await settle(async () => (await editor.locator("[data-alias-chip]").count()) === 0 && (await editor.getByLabel("Light value of background").inputValue()) === "#f9fafb"));
  check("no mark is left on the palette", (await card("background").locator("[data-alias-mark]").count()) === 0);

  // ── Pasting aliases ──────────────────────────────────────────────────────
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Add many/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByLabel("Paste tokens").fill(":root {\n  --surface: var(--gray-900);\n  --muted: var(--nowhere);\n}");
  await dialog.locator("[data-plan-row]").first().waitFor();
  await page.waitForTimeout(300);
  check("a pasted color that is a color of the set is an alias", (await dialog.locator('[data-plan-row="surface"] [data-alias-chip]').innerText()).includes("gray-900") && (await dialog.locator('[data-plan-row="surface"]').innerText()).includes("#111827"));
  await dialog.locator("[data-notes] summary").click();
  check("one that is nowhere is left out, with why", (await dialog.locator("[data-notes]").innerText()).includes("muted: refers to nowhere"));
  await page.screenshot({ path: `${OUT}/tokens-alias-paste.png` });
  await dialog.getByRole("button", { name: /^Add (\d+ tokens?|tokens)$/ }).click();
  await dialog.waitFor({ state: "hidden" });
  check("and is added as one", await settle(async () => await card("surface").locator("[data-alias-mark]").isVisible()));

  // ── Deleting what others are ─────────────────────────────────────────────
  await openEditor("gray-900");
  check("the used one warns what happens", (await editor.locator("[data-used-by]").innerText()).includes("keep the color"));
  await editor.getByRole("button", { name: "Delete gray-900" }).click();
  check("those that were it keep their color and stop following", await settle(async () => (await swatch("gray-900").count()) === 0 && (await label("surface")).includes("#111827") && (await card("surface").locator("[data-alias-mark]").count()) === 0));
  await undo();
  check("undo brings both back", await settle(async () => (await swatch("gray-900").count()) === 1 && (await card("surface").locator("[data-alias-mark]").isVisible())));

  // ── The list ─────────────────────────────────────────────────────────────
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Select surface").waitFor();
  check("the list says which token a color is", (await page.locator("[data-token-id]").filter({ has: page.getByLabel("Select surface") }).locator("[data-alias-chip]").first().innerText()).includes("gray-900"));
  await page.screenshot({ path: `${OUT}/tokens-alias-list.png` });
  await page.getByLabel("Search tokens").fill("gray-900");
  check("search finds the colors that are a token by its name", await settle(async () => (await page.locator("[data-token-id]").count()) >= 2));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
