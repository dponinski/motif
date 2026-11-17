// Making a token by what it is: a Color, a Number (with its unit and what it is used as), a String. New token asks first; the Numbers and
// Strings tabs hold what is made; they are arranged like any other token, undone, and saved as typed tokens.
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

  await seed(page, "typ00001");
  await page.goto("http://localhost:3000/editor/typ00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.getByRole("tab", { name: /^Colors/ }).waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const tabs = () => page.getByRole("tablist").getByRole("tab").evaluateAll((els) => els.map((e) => e.textContent.replace(/\d+$/, "").trim()));
  const tabCount = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) }).evaluate((e) => Number(e.textContent.match(/(\d+)$/)?.[1]));
  const addRow = page.locator("[data-add-row]");
  const newToken = async (item) => { await page.getByRole("button", { name: "New token" }).click(); await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click(); };
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const saved = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens); };

  // ── What there is to make ─────────────────────────────────────────────────
  check("the tabs are the three types, then the kinds that have their own", (await tabs()).join() === "Colors,Numbers,Strings,Typography,Spacing,Radii,Shadows", (await tabs()).join());
  await page.getByRole("button", { name: "New token" }).click();
  const items = await page.getByRole("menuitem").allInnerTexts();
  check("New token asks what it is: Color, Number or String, then Spacing, Radius, Shadow or Text style", items.map((t) => t.split("\n")[0].trim()).join() === "Color,Number,String,Spacing,Radius,Shadow,Text style", items.join("|"));
  await page.keyboard.press("Escape");

  // ── A Number ──────────────────────────────────────────────────────────────
  await newToken("Number");
  await addRow.waitFor();
  check("a Number opens the Numbers tab with its add row: name, value, unit and what it is used as", (await page.getByRole("tab", { name: /^Numbers/ }).getAttribute("aria-selected")) === "true"
    && (await addRow.getByLabel("New number name").isVisible()) && (await addRow.getByLabel("New number value").isVisible()) && (await addRow.getByLabel("New number unit").isVisible()) && (await addRow.getByLabel("New number used as").isVisible()));
  check("the unit starts as px and the use as not said", (await addRow.getByLabel("New number unit").inputValue()) === "px" && (await addRow.getByLabel("New number used as").inputValue()) === "");
  await addRow.getByLabel("New number name").fill("text-lg");
  await addRow.getByLabel("New number value").fill("abc");
  await addRow.getByLabel("New number value").press("Enter");
  check("a value that isn't a number isn't taken", (await tabCount("Numbers")) === 0 && (await page.getByLabel("Value of text-lg").count()) === 0);
  await addRow.getByLabel("New number value").fill("1.125");
  await addRow.getByLabel("New number unit").selectOption("rem");
  await addRow.getByLabel("New number used as").selectOption("font-size");
  await addRow.getByLabel("New number value").press("Enter");
  check("a Number is added with its unit and use, and the row stays for the next", await settle(async () => (await tabCount("Numbers")) === 1) && (await addRow.count()) === 1);
  check("its row shows the value, the unit and what it is used as", (await page.getByLabel("Value of text-lg").inputValue()) === "1.125" && (await page.getByLabel("Unit of text-lg").inputValue()) === "rem" && (await page.getByLabel("Used as of text-lg").inputValue()) === "font-size");
  await addRow.getByLabel("New number name").fill("ratio");
  await addRow.getByLabel("New number value").fill("1.25");
  await addRow.getByLabel("New number unit").selectOption("");
  await addRow.getByLabel("New number value").press("Enter");
  await settle(async () => (await tabCount("Numbers")) === 2);
  await page.getByRole("button", { name: "Done" }).click();
  check("a number with no unit is a bare number", (await page.getByLabel("Unit of ratio").inputValue()) === "");
  await page.screenshot({ path: `${OUT}/tokens-numbers.png` });

  // ── Editing, copying, undo ────────────────────────────────────────────────
  await page.getByLabel("Unit of text-lg").selectOption("em");
  await page.getByLabel("Used as of text-lg").selectOption("line-height");
  await page.getByLabel("Value of text-lg").fill("1.5");
  await page.getByLabel("Value of text-lg").press("Enter");
  check("the unit, the use and the value are changed in the row", await settle(async () => (await page.getByLabel("Unit of text-lg").inputValue()) === "em" && (await page.getByLabel("Used as of text-lg").inputValue()) === "line-height" && (await page.getByLabel("Value of text-lg").inputValue()) === "1.5"));
  await page.getByLabel("Duplicate ratio").click();
  check("a number is copied like any token", await settle(async () => (await tabCount("Numbers")) === 3));
  await page.getByLabel("Delete ratio-copy").click();
  check("and taken away", await settle(async () => (await tabCount("Numbers")) === 2));
  await undo();
  check("which is one step of undo", await settle(async () => (await tabCount("Numbers")) === 3));

  // ── A String ──────────────────────────────────────────────────────────────
  await newToken("String");
  await addRow.waitFor();
  check("a String opens the Strings tab with its add row: name, value and what it is used as", (await page.getByRole("tab", { name: /^Strings/ }).getAttribute("aria-selected")) === "true"
    && (await addRow.getByLabel("New string name").isVisible()) && (await addRow.getByLabel("New string value").isVisible()) && (await addRow.getByLabel("New string used as").isVisible()));
  await addRow.getByLabel("New string name").fill("font-sans");
  await addRow.getByLabel("New string value").fill("Inter, sans-serif");
  await addRow.getByLabel("New string used as").selectOption("font-family");
  await addRow.getByLabel("New string value").press("Enter");
  check("a String is added", await settle(async () => (await tabCount("Strings")) === 1) && (await page.getByLabel("Value of font-sans").inputValue()) === "Inter, sans-serif" && (await page.getByLabel("Used as of font-sans").inputValue()) === "font-family");
  await addRow.getByLabel("New string name").fill("empty");
  await addRow.getByLabel("New string value").fill("  ");
  await addRow.getByLabel("New string value").press("Enter");
  check("a string with nothing in it isn't taken", (await tabCount("Strings")) === 1);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Value of font-sans").fill("Inter, system-ui");
  await page.getByLabel("Value of font-sans").press("Enter");
  check("its value is changed in the row", await settle(async () => (await page.getByLabel("Value of font-sans").inputValue()) === "Inter, system-ui"));
  await page.screenshot({ path: `${OUT}/tokens-strings.png` });

  // ── The kinds that have their own place ───────────────────────────────────
  await newToken("Spacing");
  await addRow.waitFor();
  check("Spacing opens the Spacing tab with its add row", (await page.getByRole("tab", { name: /^Spacing/ }).getAttribute("aria-selected")) === "true" && (await addRow.getByLabel("New spacing value").isVisible()));
  await page.keyboard.press("Escape");

  // ── Saved as typed tokens ─────────────────────────────────────────────────
  const tokens = await saved();
  const byName = (n) => tokens.tokens.find((t) => t.name === n);
  check("they are saved as typed tokens with their unit and use", byName("text-lg")?.type === "number" && byName("text-lg").unit === "em" && byName("text-lg").use === "line-height" && byName("text-lg").values["*"] === "1.5"
    && byName("ratio")?.unit === "" && byName("font-sans")?.type === "string" && byName("font-sans").use === "font-family" && byName("font-sans").values["*"] === "Inter, system-ui", JSON.stringify(tokens.tokens.map((t) => [t.name, t.type, t.unit, t.use])));
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.getByRole("tab", { name: /^Numbers/ }).click();
  check("and are there after a reload", (await tabCount("Numbers")) === 3 && (await tabCount("Strings")) === 1 && (await page.getByLabel("Unit of text-lg").inputValue()) === "em");
  await page.getByRole("button", { name: /^Select ratio$/ }).waitFor().catch(() => {});
  await page.getByLabel("Select ratio", { exact: true }).check();
  await page.getByLabel("Select text-lg", { exact: true }).check();
  const bar = page.locator("[data-bulk-bar]");
  check("picked numbers can be moved to a group like any other tokens", (await bar.innerText()).includes("2 selected"));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
