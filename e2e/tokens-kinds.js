// The kinds of token the Tokens screen edits are Color, Spacing, Typography, Radius and Shadow, with nothing to pick in the table's rows. A
// project can still hold numbers, strings and compositions of parts of their own (from the repository's files, or made before): they are not
// shown, and they are kept as they are.
const { chromium } = require("playwright");
const { seed } = require("./support/seed");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

const L = "theme-l";
const extra = {
  tokens: {
    sets: [{ id: "set-global", name: "Global", themes: [{ id: L, name: "Light" }], activeThemeId: L }],
    colors: [], typography: [], spacing: [], radii: [], shadows: [], components: [],
    numbers: [{ id: "n1", name: "weight-bold", value: 700, unit: "", use: "font-weight", setId: "set-global" }],
    strings: [{ id: "g1", name: "font-sans", value: "Inter, sans-serif", use: "font-family", setId: "set-global" }],
    compositions: [{ id: "c1", name: "badge", kind: "custom", setId: "set-global", slots: [{ name: "label", type: "string", value: "New" }] }],
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

  await seed(page, "knd00001", { extra });
  await page.goto("http://localhost:3000/editor/knd00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens);
  const addRow = page.locator("[data-add-row]");
  const newToken = async (item) => { await page.getByRole("button", { name: "New token" }).click(); await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click(); await addRow.waitFor(); };
  const kinds = () => page.locator("[data-token-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-token-kind")));

  // ── What a new token can be ───────────────────────────────────────────────
  await page.getByRole("button", { name: "New token" }).click();
  const items = await page.getByRole("menuitem").allInnerTexts();
  check("New token offers Color, Spacing, Typography, Radius and Shadow, and nothing else", items.map((t) => t.split("\n")[0].trim()).join() === "Color,Spacing,Typography,Radius,Shadow", items.join("|"));
  await page.keyboard.press("Escape");

  check("numbers, strings and compositions of parts of their own are not shown", (await page.locator("[data-token-id]").count()) === 0 && (await page.locator("[data-empty]").count()) === 1);

  // ── Making one of each ────────────────────────────────────────────────────
  await newToken("Color");
  await addRow.getByLabel("New color name").fill("brand");
  await addRow.getByLabel("New color value").fill("#1d4ed8");
  await addRow.getByLabel("New color value").press("Enter");
  await page.keyboard.press("Escape");
  await newToken("Spacing");
  await addRow.getByLabel("New spacing name").fill("gap");
  await addRow.getByLabel("New spacing value").fill("16");
  await addRow.getByLabel("New spacing value").press("Enter");
  await page.keyboard.press("Escape");
  await newToken("Radius");
  await addRow.getByLabel("New radius name").fill("round");
  await addRow.getByLabel("New radius value").fill("8");
  await addRow.getByLabel("New radius value").press("Enter");
  await page.keyboard.press("Escape");
  await newToken("Typography");
  await addRow.getByLabel("New text style name").fill("heading");
  await addRow.getByLabel("New text style size").fill("24");
  await addRow.getByLabel("New text style size").press("Enter");
  await page.keyboard.press("Escape");
  await newToken("Shadow");
  await addRow.getByLabel("New shadow name").fill("raised");
  await addRow.getByLabel("New shadow name").press("Enter");
  await page.keyboard.press("Escape");
  check("a color, a spacing, a radius, a text style and a shadow are made, each as its own kind", await settle(async () => (await kinds()).sort().join() === "color,radius,shadow,spacing,typography"), (await kinds()).join());

  // ── The table ─────────────────────────────────────────────────────────────
  check("there is no Type column, and nothing to pick in a row", !/type/i.test(await page.locator("[data-table-head]").innerText()) && (await page.locator("[data-token-id] select").count()) === 0);

  // ── What isn't shown is kept ──────────────────────────────────────────────
  const stored = await saved();
  check("the numbers, strings and compositions that were not shown are kept in the project", stored.tokens.some((t) => t.name === "weight-bold") && stored.tokens.some((t) => t.name === "font-sans") && stored.compositions.some((c) => c.name === "badge"), JSON.stringify(stored.tokens.map((t) => t.name)));

  // ── Bulk Add ──────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Bulk Add" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Scale" }).click();
  const scaleKinds = await dialog.getByRole("button", { pressed: false }).or(dialog.getByRole("button", { pressed: true })).allInnerTexts();
  check("Bulk Add makes color ramps, spacing, radius and type scales, and no numbers", ["Color ramp", "Spacing", "Radius", "Type"].every((k) => scaleKinds.includes(k)) && !scaleKinds.includes("Numbers"), scaleKinds.join());
  await dialog.getByRole("tab", { name: "Paste" }).click();
  await dialog.getByRole("textbox").first().fill("accent #6366f1\nweight-bold: 700\nfont-sans: Inter, sans-serif");
  check("a pasted value that is not one of those kinds is left out, and the note says so", await settle(async () => /left out/.test(await dialog.innerText())), await dialog.innerText());
  await page.keyboard.press("Escape");

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
