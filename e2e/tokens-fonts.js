// Google Fonts in the font pickers: a String used as a font family, a text style's family, and a composition's font-family part open a list
// of Google Fonts (search, kinds, each shown in its own face); picking one writes the value with a fallback of its kind; and the canvas loads
// (fonts.googleapis.com is answered by the test, so nothing leaves the machine; the canvas side is in tokens-fonts-canvas).
const { chromium } = require("playwright");
const { seed } = require("./support/seed");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const requested = [];
  await context.route(/fonts\.googleapis\.com/, (route) => { requested.push(decodeURIComponent(route.request().url())); route.fulfill({ status: 200, contentType: "text/css", body: "/* fake */" }); });
  await context.route(/fonts\.gstatic\.com/, (route) => route.fulfill({ status: 404, body: "" }));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  await seed(page, "fnt00001");
  await page.goto("http://localhost:3000/editor/fnt00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const addRow = page.locator("[data-add-row]");
  const newToken = async (item) => { await page.getByRole("button", { name: "New token" }).click(); await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click(); await addRow.waitFor(); };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens);
  const token = async (name) => (await saved()).tokens.find((t) => t.name === name);
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const list = page.getByRole("list", { name: "Google Fonts" });

  // ── A String used as a font family ────────────────────────────────────────
  await newToken("String");
  await addRow.getByLabel("New string name").fill("font-body");
  await addRow.getByLabel("New string value").fill("Georgia, serif");
  await addRow.getByLabel("New string used as").selectOption("font-family");
  await addRow.getByLabel("New string value").press("Enter");
  await page.keyboard.press("Escape");
  check("a String used as a font family has a button to browse fonts", await settle(async () => (await page.getByRole("button", { name: "Browse fonts for Value of font-body" }).count()) === 1));
  await page.getByRole("button", { name: "Browse fonts for Value of font-body" }).click();
  await list.waitFor();
  check("it lists Google Fonts, each shown in its own face", (await list.locator("[data-font]").count()) > 20 && await list.locator("[data-font]").first().evaluate((b) => getComputedStyle(b.querySelector("span")).fontFamily.includes(b.getAttribute("data-font"))));
  check("the list loads its fonts from Google", await settle(async () => requested.some((u) => /fonts\.googleapis\.com\/css\?family=/.test(u))), requested.join(" | "));

  await page.getByLabel("Search fonts").fill("playfair");
  check("a search narrows the list to the names that have it", await settle(async () => (await list.locator("[data-font]").count()) >= 1 && (await list.locator("[data-font]").first().getAttribute("data-font")) === "Playfair Display"));
  await page.getByLabel("Search fonts").fill("");
  await page.getByRole("button", { name: "Monospace", exact: true }).click();
  check("a kind narrows it to that kind", await settle(async () => { const n = await list.locator("[data-font]").count(); return n > 3 && (await list.locator("li").allInnerTexts()).every((t) => /monospace/.test(t)); }));
  await page.getByRole("group", { name: "Kind of font" }).getByRole("button", { name: "All", exact: true }).click();
  await page.getByLabel("Search fonts").fill("zzzzzz");
  check("a name nobody has says what to do", await settle(async () => /Type the name into the field/.test(await page.getByRole("dialog").or(page.locator("[aria-label='Fonts for Value of font-body']")).innerText())));
  await page.getByLabel("Search fonts").fill("playfair");
  await list.locator('[data-font="Playfair Display"]').click();
  check("choosing a font writes it with a fallback of its kind", await settle(async () => (await page.getByLabel("Value of font-body", { exact: true }).inputValue()) === '"Playfair Display", serif'));
  check("and it is saved", await settle(async () => (await token("font-body"))?.values["*"] === '"Playfair Display", serif'));

  // ── Undo ──────────────────────────────────────────────────────────────────
  await undo();
  check("choosing a font is a step of undo", await settle(async () => (await token("font-body"))?.values["*"] === "Georgia, serif"));

  // ── A text style and a composition's font-family part ─────────────────────
  await newToken("Composition");
  await addRow.getByLabel("New composition name").fill("heading");
  await addRow.getByLabel("New composition made of").selectOption("typography");
  await addRow.getByLabel("New composition name").press("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit heading", exact: true }).click();
  await page.getByRole("button", { name: "Browse fonts for font-family of heading" }).click();
  await page.getByLabel("Search fonts").fill("lora");
  await list.locator('[data-font="Lora"]').click();
  const slot = async () => (await saved()).compositions.find((c) => c.name === "heading")?.slots.find((s) => s.name === "font-family");
  check("a composition's font-family part picks a font the same way", await settle(async () => (await slot())?.value === "Lora, serif"), JSON.stringify(await slot()));

  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  check("and the choices are there after a reload", await settle(async () => (await slot())?.value === "Lora, serif" && (await token("font-body"))?.values["*"] === "Georgia, serif"));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
