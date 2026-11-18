// A spacing or a radius has a value for every theme, and may have one of its own in a theme: the row has a value for each theme that is shown
// (a theme that has none shows the value it has as a hint), clearing it gives the theme the default again, a length in px with a value of its own
// is a number, and the values go with a theme that is deleted and are saved by theme.
const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { OUT } = require("./support/env");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  await seed(page, "thv00001");
  await page.goto("http://localhost:3000/editor/thv00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const addRow = page.locator("[data-add-row]");
  const bar = page.locator("[data-theme-bar]");
  const newToken = async (item) => { await page.getByRole("button", { name: "New token" }).click(); await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click(); await addRow.waitFor(); };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens);
  const themeId = async (name) => { for (let i = 0; i < 60; i++) { const t = (await saved()).sets[0].themes.find((x) => x.name === name); if (t) return t.id; await page.waitForTimeout(100); } };
  const token = async (name) => (await saved()).tokens.find((t) => t.name === name);
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const field = (theme, name) => page.getByLabel(`${theme} value of ${name}`, { exact: true });

  // ── One theme: as before ──────────────────────────────────────────────────
  await newToken("Spacing");
  await addRow.getByLabel("New spacing name").fill("text-xl");
  await addRow.getByLabel("New spacing value").fill("12");
  await addRow.getByLabel("New spacing value").press("Enter");
  await page.keyboard.press("Escape");
  check("with one theme a spacing has one value, as before", await settle(async () => (await page.getByLabel("Value of text-xl", { exact: true }).inputValue()) === "12"));

  // ── A second theme: a value for each ──────────────────────────────────────
  await bar.getByRole("button", { name: "Add theme" }).click();
  await page.getByLabel("New theme name").fill("Dark");
  await page.getByLabel("New theme name").press("Enter");
  // (A theme that was just added is the one shown; all of them side by side is one press.)
  const first = (await saved()).sets[0].themes[0].name;
  check("with two themes a spacing has a value for each, the second showing the first's as its hint", await settle(async () => (await field(first, "text-xl").inputValue()) === "12" && (await field("Dark", "text-xl").inputValue()) === "" && (await field("Dark", "text-xl").getAttribute("placeholder")) === "12"));
  await field("Dark", "text-xl").fill("18");
  await field("Dark", "text-xl").press("Enter");
  const dark = await themeId("Dark");
  check("a value in a theme is saved by theme, next to the one every theme has", await settle(async () => { const t = await token("text-xl"); return t?.values["*"] === "12" && t.values[dark] === "18"; }), JSON.stringify((await token("text-xl"))?.values));
  await page.screenshot({ path: `${OUT}/tokens-theme-values.png` });
  await field("Dark", "text-xl").fill("");
  await field("Dark", "text-xl").press("Enter");
  check("clearing it gives the theme the default again", await settle(async () => { const t = await token("text-xl"); return Object.keys(t.values).join() === "*"; }), JSON.stringify((await token("text-xl"))?.values));
  await field("Dark", "text-xl").fill("abc");
  await field("Dark", "text-xl").press("Enter");
  check("what isn't a number isn't taken", (await field("Dark", "text-xl").evaluate((e) => e.title)) === "A number");
  await page.keyboard.press("Escape");
  await field("Dark", "text-xl").fill("20");
  await field("Dark", "text-xl").press("Enter");
  check("the first theme's value changes the default", await (async () => { await field(first, "text-xl").fill("14"); await field(first, "text-xl").press("Enter"); return settle(async () => { const t = await token("text-xl"); return t.values["*"] === "14" && t.values[dark] === "20"; }); })());

  // ── Every theme is a column ───────────────────────────────────────────────
  check("every theme has its own column of values, side by side", (await field(first, "text-xl").count()) === 1 && (await field("Dark", "text-xl").inputValue()) === "20");

  // ── A radius in pixels ────────────────────────────────────────────────────
  await newToken("Radius");
  await addRow.getByLabel("New radius name").fill("gutter");
  await addRow.getByLabel("New radius value").fill("16");
  await addRow.getByLabel("New radius value").press("Enter");
  await page.keyboard.press("Escape");
  check("a radius in pixels is a radius", await settle(async () => (await page.locator('[data-token-id][data-token-kind="radius"]').count()) === 1));
  await field("Dark", "gutter").fill("24");
  await field("Dark", "gutter").press("Enter");
  check("with a value in a theme it is a number used as a radius, with the unit it had", await settle(async () => { const t = await token("gutter"); return t?.type === "number" && t.use === "radius" && t.unit === "px" && t.values["*"] === "16" && t.values[dark] === "24"; }), JSON.stringify(await token("gutter")));

  // ── Undo, a copy of a theme, a theme that goes ────────────────────────────
  await undo();
  check("setting a value in a theme is a step of undo", await settle(async () => { const t = await token("gutter"); return !t || Object.keys(t.values).join() === "*"; }));
  await field("Dark", "gutter").fill("24");
  await field("Dark", "gutter").press("Enter");
  await bar.getByLabel("Theme menu: Dark", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  check("a copy of a theme has the values the theme had", await settle(async () => { const t = await token("text-xl"); const dark2 = (await saved()).sets[0].themes.find((x) => /copy/i.test(x.name)); return !!dark2 && t.values[dark2.id] === "20"; }));
  await bar.getByLabel("Theme menu: Dark", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete theme" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  check("a deleted theme takes its values with it", await settle(async () => { const t = await token("text-xl"); const g = await token("gutter"); return !(dark in t.values) && !(dark in g.values); }));

  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  check("and what is left is there after a reload", await settle(async () => (await field(first, "text-xl").inputValue()) === "14"));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
