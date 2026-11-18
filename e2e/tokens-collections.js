// Sets that work together: a primitive set, and a semantic one whose colors are colors of the primitive set. The picker offers the colors
// of every set, the semantic color follows, says where it is used, keeps being the color when either moves, and keeps its color when the
// set it was a color of is deleted.
const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { OUT } = require("./support/env");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

const color = (id, name, group, setId, values) => ({ id, name, group, setId, value: Object.values(values)[0], themeValues: values });
const extra = {
  tokens: {
    sets: [
      { id: "set-prim", name: "Primitives", themes: [{ id: "p-l", name: "Light" }, { id: "p-d", name: "Dark" }], activeThemeId: "p-l" },
      { id: "set-sem", name: "Semantic", themes: [{ id: "s-l", name: "Light" }, { id: "s-d", name: "Dark" }], activeThemeId: "s-l" },
    ],
    colors: [
      color("g50", "gray-50", "gray", "set-prim", { "p-l": "#f9fafb", "p-d": "#1f2937" }),
      color("g900", "gray-900", "gray", "set-prim", { "p-l": "#111827", "p-d": "#f3f4f6" }),
      color("surface", "surface", "semantic", "set-sem", { "s-l": "#ffffff", "s-d": "#000000" }),
      color("text", "text", "semantic", "set-sem", { "s-l": "#000000", "s-d": "#ffffff" }),
    ],
    typography: [], spacing: [], radii: [], shadows: [], components: [],
  },
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  await seed(page, "coll0001", { extra });
  await page.goto("http://localhost:3000/editor/coll0001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const sidebar = page.locator("div.w-\\[220px\\]");
  const openSet = async (name) => { await sidebar.getByText(name, { exact: true }).click(); await page.waitForTimeout(250); };
  const swatch = (name) => page.locator(`button[aria-label^="${name}:"]`);
  const label = async (name) => (await swatch(name).getAttribute("aria-label")) ?? "";
  const editor = page.locator("[data-color-editor]");
  const openEditor = async (name) => { await page.keyboard.press("Escape"); await swatch(name).click(); await editor.waitFor(); };
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const saved = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens); };

  // ── The picker offers the colors of every set ─────────────────────────────
  await openSet("Semantic");
  await openEditor("surface");
  const pick = editor.getByLabel("Make surface (Light) another token");
  const groups = await pick.locator("optgroup").evaluateAll((els) => els.map((e) => `${e.label}: ${[...e.querySelectorAll("option")].map((o) => o.textContent).join(",")}`));
  check("a color of one set can be a color of another: the picker lists those of its own set, then those of each other set", groups.join(" | ") === "Semantic: text | Primitives: gray-50,gray-900", groups.join(" | "));
  await pick.selectOption({ label: "gray-50" });
  check("it then shows as that color, with the name of its set, and has its color", await settle(async () => (await editor.locator('[data-alias-field="s-l"] [data-alias-chip]').innerText()).includes("Primitives / gray-50") && (await editor.getByLabel("Light value of surface").inputValue()) === "#f9fafb"));
  await editor.getByLabel("Make surface (Dark) another token").selectOption({ label: "gray-50" });
  check("in the theme of its own set that has the same name: Dark is Dark", await settle(async () => (await editor.getByLabel("Dark value of surface").inputValue()) === "#1f2937"));
  await page.screenshot({ path: `${OUT}/tokens-collections-editor.png` });
  await openEditor("text");
  await editor.getByLabel("Make text (Light) another token").selectOption({ label: "gray-900" });
  check("each color can be a different one", await settle(async () => (await label("text")).includes("#111827")), await label("text"));

  // ── Used by, and following ────────────────────────────────────────────────
  await openSet("Primitives");
  await openEditor("gray-50");
  check("a color says which colors of other sets are it, with their sets", (await editor.locator("[data-used-by]").innerText()).includes("Semantic / surface"), await editor.locator("[data-used-by]").innerText().catch(() => "none"));
  const own = await editor.getByLabel("Make gray-50 (Light) another token").locator("optgroup").evaluateAll((els) => els.map((e) => `${e.label}: ${[...e.querySelectorAll("option")].map((o) => o.textContent).join(",")}`));
  check("and isn't offered a color that is it, in any set", own.join(" | ") === "Primitives: gray-900 | Semantic: text", own.join(" | "));
  await editor.getByLabel("Light value of gray-50").fill("#eeeeee");
  await editor.getByLabel("Light value of gray-50").press("Enter");
  await openSet("Semantic");
  check("when the color changes, so does the color of the other set that is it", await settle(async () => (await label("surface")).includes("#eeeeee")), await label("surface"));
  await undo();
  check("and undo takes it back", await settle(async () => (await label("surface")).includes("#f9fafb")));

  // ── Moving ────────────────────────────────────────────────────────────────
  await openSet("Primitives");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Select gray-50", { exact: true }).check();
  await page.locator("[data-bulk-bar]").getByRole("button", { name: /Move to set/ }).click();
  await page.getByRole("button", { name: "Semantic", exact: true }).last().click();
  await page.getByRole("button", { name: "Palette", exact: true }).click();
  await openSet("Semantic");
  check("a color that is moved to another set is still the color the colors that were it are", await settle(async () => (await swatch("gray-50").count()) === 1 && (await label("surface")).includes("#f9fafb")));
  await openEditor("surface");
  check("which is now one of its own set", (await editor.locator('[data-alias-field="s-l"] [data-alias-chip]').innerText()).trim() === "gray-50", await editor.locator('[data-alias-field="s-l"] [data-alias-chip]').innerText());
  await openEditor("text");
  check("and the color of the set it left is shown with that set's name", (await editor.locator('[data-alias-field="s-l"] [data-alias-chip]').innerText()).includes("Primitives / gray-900"));

  // ── Saved ─────────────────────────────────────────────────────────────────
  const tokens = await saved();
  const surface = tokens.tokens.find((t) => t.name === "surface");
  const text = tokens.tokens.find((t) => t.name === "text");
  check("an alias across sets is saved as the id of the other color", surface.ref["s-l"] === "g50" && text.ref["s-l"] === "g900", JSON.stringify([surface.ref, text.ref]));

  // ── Deleting the set a color was a color of ───────────────────────────────
  await sidebar.locator(".group").filter({ hasText: "Primitives" }).hover();
  await sidebar.locator(".group").filter({ hasText: "Primitives" }).locator('button[title="Delete set"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete set" }).click();
  await settle(async () => (await sidebar.getByText("Primitives", { exact: true }).count()) === 0);
  await openSet("Semantic");
  check("a color that was a color of a set that is deleted keeps the color it came to", await settle(async () => (await label("text")).includes("#111827")) && (await label("surface")).includes("#f9fafb"), await label("text"));
  await openEditor("text");
  check("and is not an alias any more", (await editor.locator('[data-alias-field="s-l"] [data-alias-chip]').count()) === 0 && (await editor.getByLabel("Make text (Light) another token").count()) === 1);

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
