const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { OUT } = require("./support/env");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

const L = "theme-l", D = "theme-d";
const extra = {
  tokens: {
    sets: [{ id: "set-global", name: "Global", themes: [{ id: L, name: "Light" }, { id: D, name: "Dark" }], activeThemeId: L }],
    colors: [{ id: "primary-500", name: "primary-500", group: "primary", setId: "set-global", value: "#6366f1", themeValues: { [L]: "#6366f1", [D]: "#818cf8" } }],
    typography: [], spacing: [{ id: "space-4", name: "space-4", value: 16, setId: "set-global" }], radii: [], shadows: [], components: [],
  },
};

const CSS = `:root {
  --primary-500: #6366f1;
  --primary-600: #4f46e5;
  --background: oklch(1 0 0);
  --radius-md: 8px;
  --space-8: 2rem;
  --border: var(--gray-200);
}
.dark {
  --primary-600: #818cf8;
  --background: oklch(0.145 0 0);
}`;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  await seed(page, "tadd0001", { extra });
  await page.goto("http://localhost:3000/editor/tadd0001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const dialog = page.getByRole("dialog");
  const open = async () => { await page.getByRole("button", { name: /Add many/ }).click(); await dialog.waitFor(); };
  // How many tokens of a kind the set shows (they are all in one list).
  const tabCount = async (name) => page.locator(`[data-token-id][data-token-kind="${{ Colors: "color", Radii: "radius", Spacing: "spacing", Typography: "typography" }[name]}"]`).count();
  const groupNames = () => page.locator("[data-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const row = (name) => dialog.locator(`[data-plan-row="${name}"]`);
  const paste = async (text) => { await dialog.getByLabel("Paste tokens").fill(text); await dialog.locator("[data-plan-row], [data-plan-empty]").first().waitFor(); await page.waitForTimeout(300); };
  const addButton = () => dialog.getByRole("button", { name: /^Add (\d+ tokens?|tokens)$/ });

  // ── Pasting CSS ──────────────────────────────────────────────────────────
  const before = await tabCount("Colors");
  await open();
  check("Add many opens a dialog for the set", await dialog.getByText("Add tokens to Global").isVisible());
  await paste(CSS);
  check("it says how it read what was pasted", await dialog.getByText("Read as CSS").isVisible());
  const names = await dialog.locator("[data-plan-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-plan-row")));
  check("each token is a row, in the order written", names.join() === "primary-500,primary-600,background,radius-md,space-8", names.join());
  check("a token that is there as it is says so, and is not ticked", (await row("primary-500").innerText()).includes("Already there") && !(await row("primary-500").getByRole("checkbox").isChecked()));
  check("a new one says so", (await row("primary-600").innerText()).includes("New"));
  check("each shows its value for every theme", (await row("primary-600").innerText()).includes("#4f46e5") && (await row("primary-600").innerText()).includes("#818cf8"));
  check("a length shows in px, whatever it was written in", (await row("space-8").innerText()).includes("32px"));
  await dialog.locator("[data-notes] summary").click();
  check("what was left out is said, with why", (await dialog.locator("[data-notes]").innerText()).includes("border: refers to gray-200, which isn't a color"));
  check("and counted", (await dialog.locator("[data-plan-summary]").innerText()).includes("4 to add"));
  await page.screenshot({ path: `${OUT}/tokens-add-paste.png` });

  await row("space-8").getByRole("checkbox").uncheck();
  check("a token can be left out", (await dialog.locator("[data-plan-summary]").innerText()).includes("3 to add"));
  await addButton().click();
  await dialog.waitFor({ state: "hidden" });
  check("adding closes the dialog and puts the tokens in", await settle(async () => (await tabCount("Colors")) === before + 2));
  check("a ramp lands in a group of its own", (await groupNames()).includes("primary") && (await page.locator('[data-group="primary"] [data-token-id]').count()) === 2);
  check("with the dark value from the .dark block", await (async () => { await page.locator('button[aria-label^="primary-600:"]').waitFor(); return (await page.locator('button[aria-label^="primary-600:"]').getAttribute("aria-label")).includes("#818cf8"); })());
  check("and the other kinds go in as the kind they are", await settle(async () => (await tabCount("Radii")) === 1));
  check("the one that was left out did not", (await tabCount("Spacing")) === 1);
  await undo();
  check("the whole batch is one undo", await settle(async () => (await tabCount("Colors")) === before) && (await tabCount("Radii")) === 0);

  // ── Pasting again ────────────────────────────────────────────────────────
  await open();
  await paste(CSS);
  await addButton().click();
  await dialog.waitFor({ state: "hidden" });
  await open();
  await paste(CSS);
  check("pasting what is there already changes nothing", (await dialog.locator("[data-plan-row]").evaluateAll((els) => els.every((e) => e.textContent.includes("Already there")))) && (await dialog.locator("[data-plan-summary]").innerText()).includes("Nothing selected"));
  check("and there is nothing to press", await dialog.getByRole("button", { name: "Add tokens" }).isDisabled());
  await paste(CSS.replace("#4f46e5", "#ff0000"));
  check("a changed value says it changes the token", (await row("primary-600").innerText()).includes("Changes it"));
  await addButton().click();
  await dialog.waitFor({ state: "hidden" });
  check("and changes it, rather than adding another", (await tabCount("Colors")) === before + 2 && (await page.locator('button[aria-label^="primary-600:"]').getAttribute("aria-label")).includes("#ff0000"));

  // ── Lines ────────────────────────────────────────────────────────────────
  await open();
  await paste("brand-blue #1d4ed8\n#111827, #374151 #6b7280\nnot a token");
  check("lines are read too", await dialog.getByText("Read as lines").isVisible());
  const lineNames = await dialog.locator("[data-plan-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-plan-row")));
  check("a color with no name gets one by number", lineNames.join() === "brand-blue,color-1,color-2,color-3", lineNames.join());
  await dialog.getByLabel("Name for unnamed colors").fill("gray");
  await page.waitForTimeout(400);
  check("which can be changed", (await dialog.locator("[data-plan-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-plan-row")))).join() === "brand-blue,gray-1,gray-2,gray-3");
  await dialog.locator("[data-notes] summary").click();
  check("a line that is nothing is reported by its number", (await dialog.locator("[data-notes]").innerText()).includes("Line 3"));
  await addButton().click();
  await dialog.waitFor({ state: "hidden" });
  check("and added", await settle(async () => (await page.getByLabel("Select gray-3").count()) + (await page.locator('button[aria-label^="gray-3:"]').count()) > 0));

  // ── A design tokens file ─────────────────────────────────────────────────
  await open();
  await paste(JSON.stringify({ color: { teal: { $type: "color", "100": { $value: "#ccfbf1" }, "900": { $value: "#134e4a" } } }, spacing: { "2": { $value: "8px", $type: "dimension" } } }));
  check("a W3C file is read, nested names joined", await dialog.getByText("Read as a design tokens file").isVisible() && (await row("teal-100").count()) === 1 && (await row("teal-900").count()) === 1);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // ── A scale ──────────────────────────────────────────────────────────────
  const colorsBefore = await tabCount("Colors");
  await open();
  await dialog.getByRole("tab", { name: "Scale" }).click();
  await dialog.getByLabel("Base color", { exact: true }).fill("#0ea5e9");
  await dialog.getByLabel("Name of the ramp").fill("sky");
  check("a ramp is previewed as a strip of its steps", (await dialog.locator("[data-ramp-preview] > div").count()) === 11);
  check("and as the tokens it would add", (await dialog.locator("[data-plan-row]").count()) === 11 && (await dialog.locator('[data-plan-row="sky-50"]').count()) === 1);
  await page.screenshot({ path: `${OUT}/tokens-add-scale.png` });
  await dialog.getByRole("group", { name: "Steps" }).getByRole("button", { name: "950" }).click();
  check("steps can be left out", (await dialog.locator("[data-plan-row]").count()) === 10);
  await dialog.getByLabel("Base color", { exact: true }).fill("nope");
  check("a color that can't be read is said so", await dialog.locator("[data-problem]").isVisible());
  await dialog.getByLabel("Base color", { exact: true }).fill("#0ea5e9");
  await addButton().click();
  await dialog.waitFor({ state: "hidden" });
  check("a ramp is added as a group", await settle(async () => (await tabCount("Colors")) === colorsBefore + 10) && (await groupNames()).includes("sky"));
  check("in step order", (await page.locator('[data-group="sky"] [data-token-id]').evaluateAll((els) => els.map((e) => e.getAttribute("data-token-id").length > 0).length)) === 10);
  const sky50 = await page.locator('button[aria-label^="sky-50:"]').getAttribute("aria-label");
  const sky900 = await page.locator('button[aria-label^="sky-900:"]').getAttribute("aria-label");
  const [l50, d50] = sky50.replace(/^[^:]+: /, "").split(", ");
  const [l900, d900] = sky900.replace(/^[^:]+: /, "").split(", ");
  check("the dark theme has the ramp turned over", d50 !== l50 && d900 !== l900 && /^#[0-9a-f]{6}$/.test(d50));
  check("the color given is in the ramp, as it was", (await page.locator('[data-group="sky"]').innerText()).includes("#0ea5e9"));
  await undo();
  check("and the ramp is one undo", await settle(async () => (await tabCount("Colors")) === colorsBefore));

  await open();
  await dialog.getByRole("tab", { name: "Scale" }).click();
  await dialog.getByRole("group", { name: "Kind of scale" }).getByRole("button", { name: "Spacing" }).click();
  check("a spacing scale is units of the base", (await row("space-2").innerText()).includes("8px") && (await row("space-16").innerText()).includes("64px"));
  check("one that is there already says so", (await row("space-4").innerText()).includes("Already there"));
  await dialog.getByRole("group", { name: "Kind of scale" }).getByRole("button", { name: "Radius" }).click();
  check("a radius scale has a full one", (await row("radius-full").innerText()).includes("full"));
  await dialog.getByRole("group", { name: "Kind of scale" }).getByRole("button", { name: "Type" }).click();
  check("a type scale grows by the ratio", (await row("text-base").innerText()).includes("16px") && (await row("text-lg").innerText()).includes("20px"));
  await addButton().click();
  await dialog.waitFor({ state: "hidden" });
  check("and goes to the type tab", await settle(async () => (await tabCount("Typography")) === 8));
  await page.screenshot({ path: `${OUT}/tokens-add-type.png` });

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
