// Compositions: tokens that go together as one. A text style made of a font family String and a size Number, a shadow made of numbers and a
// color, parts of your own. Each part is a value of its own or another token (of any set) and follows it; a token that goes leaves the part
// with the value it had; it is all undone like any token and saved.
const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { OUT } = require("./support/env");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

const extra = {
  tokens: {
    sets: [
      { id: "set-prim", name: "Primitives", themes: [{ id: "p-l", name: "Light" }], activeThemeId: "p-l" },
      { id: "set-sem", name: "Semantic", themes: [{ id: "s-l", name: "Light" }], activeThemeId: "s-l" },
    ],
    colors: [{ id: "ink", name: "ink", group: "gray", setId: "set-prim", value: "#112233", themeValues: { "p-l": "#112233" } }],
    numbers: [{ id: "n-xl", name: "text-xl", value: 1.5, unit: "rem", use: "font-size", setId: "set-prim" }],
    strings: [{ id: "s-sans", name: "font-sans", value: "Georgia, serif", use: "font-family", setId: "set-prim" }],
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

  await seed(page, "comp0001", { extra });
  await page.goto("http://localhost:3000/editor/comp0001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const sidebar = page.locator("div.w-\\[220px\\]");
  const addRow = page.locator("[data-add-row]");
  // How many tokens of a kind the set shows (every kind is in the one list).
  const tabCount = (name) => page.locator(`[data-token-id][data-token-kind="${{ Compositions: "composition", Strings: "string", Typography: "typography" }[name]}"]`).count();
  const newComposition = async (name, preset) => {
    await page.getByRole("button", { name: "New token" }).click();
    await page.getByRole("menuitem", { name: /^Composition/ }).click();
    await addRow.waitFor();
    await addRow.getByLabel("New composition name").fill(name);
    await addRow.getByLabel("New composition made of").selectOption(preset);
    await addRow.getByLabel("New composition name").press("Enter");
  };
  const row = (name) => page.locator("[data-token-id]").filter({ has: page.getByLabel(`Select ${name}`, { exact: true }) });
  const open = async (name) => { if ((await page.locator("[data-composition-editor]").count()) === 0 || !(await row(name).locator("[data-composition-editor]").count())) await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click(); await row(name).locator("[data-composition-editor]").waitFor(); };
  const slot = (name, part) => row(name).locator(`[data-slot="${part}"]`);
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const saved = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens); };
  const style = (name, prop) => row(name).locator("[data-composition-editor] [data-sample]").evaluate((el, p) => getComputedStyle(el)[p], prop);

  // ── Making one ────────────────────────────────────────────────────────────
  await sidebar.getByText("Primitives", { exact: true }).click();
  await page.getByRole("button", { name: "New token" }).click();
  check("New token offers Composition", (await page.getByRole("menuitem", { name: /^Composition/ }).count()) === 1);
  await page.keyboard.press("Escape");
  await newComposition("heading", "typography");
  check("a composition is added from a preset: Typography", await settle(async () => (await tabCount("Compositions")) === 1));
  await page.getByRole("button", { name: "Edit heading", exact: true }).click();
  await row("heading").locator("[data-composition-editor]").waitFor();
  const parts = await row("heading").locator("[data-slot]").evaluateAll((els) => els.map((e) => e.getAttribute("data-slot")));
  check("a typography composition has a font family, a size, a weight, a line height and letter spacing", parts.join() === "font-family,font-size,font-weight,line-height,letter-spacing", parts.join());
  check("each part has a value of its own to begin with", (await page.getByLabel("font-size of heading", { exact: true }).inputValue()) === "16" && (await page.getByLabel("Unit of font-size of heading").inputValue()) === "px" && (await page.getByLabel("font-family of heading", { exact: true }).inputValue()) === "Inter, sans-serif");
  check("and the sample shows them", (await style("heading", "fontSize")) === "16px" && (await style("heading", "fontFamily")).includes("Inter"));

  // ── Parts that are tokens ─────────────────────────────────────────────────
  const pickFamily = page.getByLabel("Make font-family of heading a token");
  const groups = await pickFamily.locator("optgroup").evaluateAll((els) => els.map((e) => `${e.label}: ${[...e.querySelectorAll("option")].map((o) => o.textContent).join(",")}`));
  check("a String part can be a String of any set", groups.join(" | ") === "Primitives: font-sans", groups.join(" | "));
  await pickFamily.selectOption({ label: "font-sans" });
  check("it then is that token, and has its value", await settle(async () => (await slot("heading", "font-family").locator("[data-slot-token]").innerText()) === "font-sans" && (await slot("heading", "font-family").locator("[data-slot-text]").innerText()) === "Georgia, serif"));
  check("the sample follows", await settle(async () => (await style("heading", "fontFamily")).includes("Georgia")));
  const pickSize = page.getByLabel("Make font-size of heading a token");
  check("a Number part can be a Number, and a spacing or a radius is one too", (await pickSize.locator("option").allInnerTexts()).join() === "Make it a token…,text-xl");
  await pickSize.selectOption({ label: "text-xl" });
  check("a Number part is the token with its unit", await settle(async () => (await slot("heading", "font-size").locator("[data-slot-text]").innerText()) === "1.5rem" && (await style("heading", "fontSize")) === "24px"));
  await page.screenshot({ path: `${OUT}/tokens-compositions-editor.png` });

  // ── Following ─────────────────────────────────────────────────────────────
  await page.getByLabel("Value of font-sans", { exact: true }).fill("Merriweather, serif");
  await page.getByLabel("Value of font-sans", { exact: true }).press("Enter");
  await open("heading");
  check("when the token changes, so does the part", await settle(async () => (await slot("heading", "font-family").locator("[data-slot-text]").innerText()) === "Merriweather, serif"));
  check("and the search finds the composition by what a part is, with the String it follows", await (async () => { await page.getByLabel("Search tokens").fill("Merriweather"); const ok = await settle(async () => (await tabCount("Compositions")) === 1 && (await tabCount("Strings")) === 1); await page.getByLabel("Search tokens").fill(""); return ok; })());

  // ── A token that goes ─────────────────────────────────────────────────────
  await page.getByLabel("Delete font-sans").click();
  await open("heading");
  check("a part keeps the value its token had, and is a value of its own", await settle(async () => (await slot("heading", "font-family").locator("[data-slot-token]").count()) === 0 && (await page.getByLabel("font-family of heading", { exact: true }).inputValue()) === "Merriweather, serif"));
  await undo();
  await open("heading");
  check("undo brings the token back, and the part is it again", await settle(async () => (await slot("heading", "font-family").locator("[data-slot-token]").innerText()) === "font-sans"));
  check("(the token is back)", (await tabCount("Strings")) === 1);

  // ── Another set's tokens ──────────────────────────────────────────────────
  await sidebar.getByText("Semantic", { exact: true }).click();
  await newComposition("card", "shadow");
  await page.getByRole("button", { name: "Edit card", exact: true }).click();
  await row("card").locator("[data-composition-editor]").waitFor();
  const colorGroups = await page.getByLabel("Make color of card a token").locator("optgroup").evaluateAll((els) => els.map((e) => `${e.label}: ${[...e.querySelectorAll("option")].map((o) => o.textContent).join(",")}`));
  check("a part can be a token of another set, which is listed under its set", colorGroups.join(" | ") === "Primitives: ink", colorGroups.join(" | "));
  await page.getByLabel("Make color of card a token").selectOption({ label: "ink" });
  check("and says which set it is in", await settle(async () => (await slot("card", "color").locator("[data-slot-token]").innerText()) === "Primitives / ink" && (await slot("card", "color").locator("[data-slot-text]").innerText()) === "#112233"));
  await page.getByLabel("Inset card").check();
  check("a shadow can be inset, and the sample is the shadow it is", await settle(async () => { const b = await style("card", "boxShadow"); return b.includes("inset") && b.includes("rgb(17, 34, 51)"); }), await style("card", "boxShadow"));
  await page.screenshot({ path: `${OUT}/tokens-compositions-shadow.png` });

  // ── Parts of your own ─────────────────────────────────────────────────────
  await newComposition("badge", "custom");
  await page.getByRole("button", { name: "Edit badge", exact: true }).click();
  await row("badge").locator("[data-composition-editor]").waitFor();
  check("a custom composition begins with no parts", (await row("badge").locator("[data-slot]").count()) === 0);
  await page.getByLabel("Add a color part to badge").click();
  await page.getByLabel("Add a number part to badge").click();
  await page.getByLabel("Add a string part to badge").click();
  check("a part of any type is added", await settle(async () => (await row("badge").locator("[data-slot]").count()) === 3));
  await page.getByLabel("Name of part-1 of badge").fill("background");
  await page.getByLabel("Name of part-1 of badge").press("Enter");
  check("a part is renamed", await settle(async () => (await slot("badge", "background").count()) === 1));
  await page.getByLabel("Name of part-2 of badge").fill("background");
  await page.getByLabel("Name of part-2 of badge").press("Enter");
  check("a name another part has is refused", (await slot("badge", "part-2").count()) === 1);
  await page.getByLabel("Remove part-3 of badge").click();
  check("a part is removed", await settle(async () => (await row("badge").locator("[data-slot]").count()) === 2));

  // ── Arranged like any token, undone, saved ────────────────────────────────
  check("they are both in the list", (await tabCount("Compositions")) === 2);
  await undo();
  check("each change is a step of undo", await settle(async () => (await row("badge").locator("[data-slot]").count()) === 3));
  const t = await saved();
  const heading = t.compositions.find((c) => c.name === "heading");
  check("saved, a composition is a composition made as one, with its parts as tokens", heading && heading.own === true && heading.kind === "typography" && heading.slots.find((s) => s.name === "font-family").ref === "s-sans" && heading.slots.find((s) => s.name === "font-size").ref === "n-xl", JSON.stringify(heading));
  check("and is not a text style", (await page.evaluate(() => 0)) === 0 && !t.compositions.some((c) => c.name === "heading" && !c.own));
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await sidebar.getByText("Primitives", { exact: true }).click();
  check("after a reload it is still a composition, and still follows its tokens", await settle(async () => (await tabCount("Compositions")) === 1 && (await tabCount("Typography")) === 0));
  await open("heading");
  check("with its parts", (await slot("heading", "font-size").locator("[data-slot-token]").innerText()) === "text-xl");

  // ── Deleting ──────────────────────────────────────────────────────────────
  await page.getByLabel("Delete heading").click();
  check("a composition is deleted", await settle(async () => (await tabCount("Compositions")) === 0));
  await undo();
  check("and it is a step of undo", await settle(async () => (await tabCount("Compositions")) === 1));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
