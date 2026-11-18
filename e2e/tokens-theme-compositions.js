// A composition has a value for each of its parts in every theme, and a part can have a value (or a token) of its own in a theme: the editor shows the
// parts in one theme at a time, a part that has nothing of its own there says it is the default and offers to use it again, and what is chosen
// is saved by theme and goes with the theme that is copied or deleted.
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

  await seed(page, "thc00001");
  await page.goto("http://localhost:3000/editor/thc00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const addRow = page.locator("[data-add-row]");
  const bar = page.locator("[data-theme-bar]");
  const newToken = async (item) => { await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click(); await addRow.waitFor(); };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens);
  const heading = async () => (await saved()).compositions.find((c) => c.name === "heading");
  const slotOf = async (name) => (await heading())?.slots.find((s) => s.name === name);
  const themeId = async (name) => { for (let i = 0; i < 60; i++) { const t = (await saved()).sets[0].themes.find((x) => x.name === name); if (t) return t.id; await page.waitForTimeout(100); } };
  const row = page.locator('[data-token-id][data-token-kind="composition"]');

  // A Number that is a token in a theme of its own, and a text style.
  await page.getByRole("button", { name: "New token" }).click();
  await newToken("Number");
  await addRow.getByLabel("New number name").fill("text-xl");
  await addRow.getByLabel("New number value").fill("1.5");
  await addRow.getByLabel("New number unit").selectOption("rem");
  await addRow.getByLabel("New number value").press("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New token" }).click();
  await newToken("Composition");
  await addRow.getByLabel("New composition name").fill("heading");
  await addRow.getByLabel("New composition made of").selectOption("typography");
  await addRow.getByLabel("New composition name").press("Enter");
  await page.keyboard.press("Escape");
  await row.waitFor();
  await page.getByRole("button", { name: "Edit heading", exact: true }).click();
  check("with one theme there is no choice of theme", (await page.locator("[data-composition-themes]").count()) === 0);

  // A second theme.
  await bar.getByRole("button", { name: "Add theme" }).click();
  await page.getByLabel("New theme name").fill("Dark");
  await page.getByLabel("New theme name").press("Enter");
  const dark = await themeId("Dark");
  const group = page.locator("[data-composition-themes]");
  check("with two, the parts are shown in one theme at a time, the first to begin with", await settle(async () => (await group.locator('button[aria-pressed="true"]').innerText()) === (await saved()).sets[0].themes[0].name));
  await group.getByRole("button", { name: "Dark", exact: true }).click();
  check("a part that has nothing of its own there says it is the default", (await page.locator('[data-slot="font-size"] [data-slot-inherits]').count()) === 1);
  await page.getByLabel("font-size of heading", { exact: true }).fill("20");
  await page.getByLabel("font-size of heading", { exact: true }).press("Enter");
  check("a value chosen in a theme is that theme's own, saved by theme", await settle(async () => { const s = await slotOf("font-size"); return s.value === "16" && s.themes?.[dark]?.value === "20" && s.themes[dark].unit === "px"; }), JSON.stringify(await slotOf("font-size")));
  check("and the part says it has one, and offers the default again", (await page.getByRole("button", { name: "Use the default for font-size of heading" }).count()) === 1);
  await page.screenshot({ path: `${OUT}/tokens-theme-compositions.png` });
  await group.getByRole("button", { name: /^(?!Dark$)/ }).first().click();
  check("in the first theme it is the value every theme has", (await page.getByLabel("font-size of heading", { exact: true }).inputValue()) === "16");
  await group.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Use the default for font-size of heading" }).click();
  check("using the default takes the theme's own value away", await settle(async () => !(await slotOf("font-size")).themes));

  // A token of its own in a theme.
  await page.getByLabel("Make font-size of heading a token", { exact: true }).selectOption({ label: "text-xl" });
  check("a part can be another token in a theme", await settle(async () => { const s = await slotOf("font-size"); const n = (await saved()).tokens.find((t) => t.name === "text-xl"); return !!n && s.themes?.[dark]?.ref === n.id && s.value === "16"; }), JSON.stringify(await slotOf("font-size")));
  check("and the other themes keep the value they had", await (async () => { await group.getByRole("button", { name: /^(?!Dark$)/ }).first().click(); return (await page.getByLabel("font-size of heading", { exact: true }).inputValue()) === "16"; })());

  // A copy of the theme, and a theme that goes.
  await bar.getByLabel("Theme menu: Dark", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  check("a copy of a theme has the parts' values of the theme", await settle(async () => { const s = await slotOf("font-size"); return Object.keys(s.themes ?? {}).length === 2; }));
  await bar.getByLabel("Theme menu: Dark", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete theme" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  check("a theme that is deleted takes the parts' values with it", await settle(async () => { const s = await slotOf("font-size"); return !(dark in (s.themes ?? {})); }));

  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  check("and the composition is there after a reload", await settle(async () => (await row.count()) === 1));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
