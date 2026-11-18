const { chromium } = require("playwright");
const { seed } = require("./support/seed");
const { OUT } = require("./support/env");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

const L = "theme-l", D = "theme-d";
const color = (name, group, l, d, extra = {}) => ({ id: name, name, group, setId: "set-global", value: l, themeValues: { [L]: l, [D]: d }, ...extra });
// In the order a repository might list them: not by step, and one ramp filed under "base".
const colors = [
  color("primary-500", "primary", "#6366f1", "#818cf8"), color("primary-50", "primary", "#eef2ff", "#1e1b4b"), color("primary-900", "primary", "#312e81", "#e0e7ff"), color("primary-100", "primary", "#e0e7ff", "#312e81"),
  color("gray-100", "gray", "#f3f4f6", "#111827"), color("gray-50", "gray", "#f9fafb", "#030712"),
  color("background", "semantic", "#ffffff", "#0b0b0f"), color("foreground", "semantic", "#111827", "#f9fafb"),
  color("brand", "semantic", "#1d4ed8", "#60a5fa", { repoName: "brand" }),
  color("teal-100", "base", "#ccfbf1", "#134e4a"), color("teal-200", "base", "#99f6e4", "#115e59"),
];
const spacing = [["space-4", 16], ["space-1", 4], ["space-2", 8]].map(([name, value]) => ({ id: name, name, value, setId: "set-global" }));
const extra = {
  tokens: {
    sets: [{ id: "set-global", name: "Global", themes: [{ id: L, name: "Light" }, { id: D, name: "Dark" }], activeThemeId: L }],
    colors, typography: [], spacing, radii: [], shadows: [], components: [],
  },
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  await seed(page, "tkn00001", { extra });
  await page.goto("http://localhost:3000/editor/tkn00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.getByRole("tab", { name: /Colors/ }).waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const groupNames = () => page.locator("[data-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
  const cards = (group) => page.locator(`[data-group="${group}"] [data-token-id]`);
  const names = (group) => page.locator(`[data-group="${group}"] [data-token-id]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-token-id")));
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const redo = () => page.getByRole("button", { name: "Redo", exact: true }).click();
  const view = (name) => page.getByRole("button", { name, exact: true }).click();

  // ── Seeing ───────────────────────────────────────────────────────────────
  check("the tabs say how many tokens each kind has", (await page.getByRole("tab", { name: /Colors/ }).innerText()).includes("11") && (await page.getByRole("tab", { name: /Spacing/ }).innerText()).includes("3"));
  check("colors open as a palette, in groups", (await groupNames()).join() === "primary,gray,semantic,base", (await groupNames()).join());
  check("a ramp reads in step order, whatever order it came in", (await names("primary")).join() === "primary-50,primary-100,primary-500,primary-900", (await names("primary")).join());
  check("each swatch shows its hex, Light and Dark", (await page.locator('[data-group="primary"]').innerText()).includes("#6366f1") && (await page.locator('[data-group="primary"]').innerText()).includes("#818cf8"));
  await page.screenshot({ path: `${OUT}/tokens-palette.png` });

  await page.locator('button[aria-label^="primary-500:"]').click();
  const editor = page.locator("[data-color-editor]");
  await editor.waitFor();
  check("a swatch opens its editor with the value for each theme", (await editor.getByLabel("Light value of primary-500").inputValue()) === "#6366f1" && (await editor.getByLabel("Dark value of primary-500").inputValue()) === "#818cf8");
  check("and how it reads on white and black", /white \d+\.\d AA/.test(await editor.innerText()) && /black \d+\.\d/.test(await editor.innerText()), await editor.innerText());
  await page.screenshot({ path: `${OUT}/tokens-editor.png` });
  await editor.getByLabel("Light value of primary-500").fill("not a color");
  await editor.getByLabel("Light value of primary-500").press("Enter");
  check("a value that isn't a color is refused", (await editor.getByLabel("Light value of primary-500").evaluate((e) => e.className.includes("border-danger"))) && (await page.locator('button[aria-label^="primary-500:"]').getAttribute("aria-label")).includes("#6366f1"));
  await editor.getByLabel("Light value of primary-500").fill("rgb(255 0 0)");
  await editor.getByLabel("Light value of primary-500").press("Enter");
  check("one that is a color is taken, in any notation", await settle(async () => (await page.locator('button[aria-label^="primary-500:"]').getAttribute("aria-label")).includes("#ff0000")));
  await page.keyboard.press("Escape");
  await undo();
  check("and undone", await settle(async () => (await page.locator('button[aria-label^="primary-500:"]').getAttribute("aria-label")).includes("#6366f1")));

  // ── The list ─────────────────────────────────────────────────────────────
  await view("List");
  await page.getByLabel("Select gray-100").waitFor();
  check("the list shows a row for each token with the values to edit in place", (await page.getByLabel("Light value of gray-100").inputValue()) === "#f3f4f6" && (await page.getByLabel("Dark value of gray-100").inputValue()) === "#111827");
  await page.reload();
  await page.locator('nav button[title="Tokens"]').click();
  await page.getByRole("tab", { name: /Colors/ }).waitFor();
  check("which view was last used is remembered", (await page.getByRole("button", { name: "List", exact: true }).getAttribute("aria-pressed")) === "true");
  await page.getByLabel("Light value of gray-100").fill("#eeeeee");
  await page.getByLabel("Light value of gray-100").press("Enter");
  check("a value is changed where it stands", await settle(async () => (await page.getByLabel("Light value of gray-100").inputValue()) === "#eeeeee"));

  // ── Names ────────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Rename gray-100" }).click();
  await page.getByLabel("Name of gray-100").fill("gray-150");
  await page.getByLabel("Name of gray-100").press("Enter");
  check("a name is changed where it stands", await page.getByRole("button", { name: "Rename gray-150" }).isVisible());
  check("and a ramp reads in order again", (await page.locator('[data-group="gray"] [data-token-id]').evaluateAll((els) => els.map((e) => e.textContent.match(/gray-\d+/)?.[0]).join())) === "gray-50,gray-150");
  await page.getByRole("button", { name: "Rename gray-50" }).click();
  await page.getByLabel("Name of gray-50").fill("gray-150");
  await page.getByLabel("Name of gray-50").press("Enter");
  check("a name that is taken is refused", await page.getByLabel("Name of gray-50").evaluate((e) => e.className.includes("border-danger")));
  await page.getByLabel("Name of gray-50").press("Escape");
  check("a token the repository names can't be renamed here, and says why", (await page.getByRole("button", { name: "Rename brand" }).count()) === 0 && (await page.locator('[title^="Named by the repository (brand)"]').count()) === 1);

  // ── Finding ──────────────────────────────────────────────────────────────
  await page.getByLabel("Search tokens").fill("primary-500");
  check("the search leaves what matches, by name", await settle(async () => (await page.locator("[data-token-id]").count()) === 1) && (await groupNames()).join() === "primary");
  await page.getByLabel("Search tokens").fill("#030712");
  check("or by value", await settle(async () => (await page.locator("[data-token-id]").count()) === 1) && (await page.locator("[data-token-id]").first().getAttribute("data-token-id")) === "gray-50");
  await page.getByLabel("Search tokens").fill("zzz");
  check("and says when nothing does", await page.locator("[data-no-match]").isVisible());
  await page.getByLabel("Search tokens").fill("");
  await page.getByRole("button", { name: "Read-only", exact: true }).click();
  check("a filter leaves the tokens it names", await page.locator("[data-no-match]").isVisible());
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.locator("body").click({ position: { x: 700, y: 20 } });
  await page.keyboard.press("/");
  check("/ goes to the search", await page.getByLabel("Search tokens").evaluate((e) => e === document.activeElement));
  await page.getByLabel("Search tokens").press("Escape");

  // ── Picking several, and moving them ─────────────────────────────────────
  await page.getByLabel("Select teal-100").check();
  await page.getByLabel("Select teal-200").check();
  const bar = page.locator("[data-bulk-bar]");
  check("picking tokens shows what can be done to them", (await bar.innerText()).includes("2 selected"));
  await page.screenshot({ path: `${OUT}/tokens-bulk.png` });
  await bar.getByRole("button", { name: "Move to group" }).click();
  await page.getByLabel("New group").fill("teal");
  await page.getByLabel("New group").press("Enter");
  check("they move to a group, new if need be", await settle(async () => (await groupNames()).includes("teal") && !(await groupNames()).includes("base")) && (await names("teal")).join() === "teal-100,teal-200");
  await undo();
  check("in one undo", await settle(async () => (await groupNames()).includes("base") && !(await groupNames()).includes("teal")));
  await redo();
  check("and one redo", await settle(async () => (await groupNames()).includes("teal")));
  await page.getByRole("button", { name: "Clear the selection" }).click();
  check("the selection is let go", (await bar.count()) === 0);

  // ── Dragging ─────────────────────────────────────────────────────────────
  const row = page.locator('[data-token-id="foreground"]');
  const head = page.locator('[data-group-drop="primary"]');
  const rb = await row.boundingBox();
  const hb = await head.boundingBox();
  await row.hover();
  const handle = await row.locator("[data-drag-handle]").boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, rb.y - 20, { steps: 4 });
  await page.mouse.move(hb.x + 200, hb.y + hb.height / 2, { steps: 12 });
  check("dragging over a group's header marks it", await settle(async () => (await head.evaluate((e) => e.className.includes("bg-accent"))) === true));
  await page.mouse.up();
  check("dropping on it puts the token in that group", await settle(async () => (await names("primary")).includes("foreground")), (await names("primary")).join());
  await undo();
  check("and undoes", await settle(async () => !(await names("primary")).includes("foreground")));

  // ── Adding ───────────────────────────────────────────────────────────────
  await page.locator('[data-group="semantic"]').hover();
  await page.getByRole("button", { name: "Add to semantic" }).click();
  const add = page.locator("[data-add-row]");
  check("adding opens a row of fields, with a name already suggested", (await add.getByLabel("New color name").inputValue()) === "semantic-1");
  await add.getByLabel("New color value").fill("nope");
  await add.getByLabel("New color value").press("Enter");
  check("a value that isn't a color is not added", (await page.getByLabel("Select semantic-1").count()) === 0);
  await add.getByLabel("New color value").fill("#112233");
  await add.getByLabel("New color value").press("Enter");
  check("Enter adds it", await settle(async () => (await page.getByLabel("Select semantic-1").count()) === 1));
  check("and the row stays, with the next name and the cursor in the value", (await add.getByLabel("New color name").inputValue()) === "semantic-2" && (await add.getByLabel("New color value").evaluate((e) => e === document.activeElement)));
  await page.keyboard.type("#445566");
  await page.keyboard.press("Enter");
  check("so a run of colors is a run of hex codes", await settle(async () => (await page.getByLabel("Select semantic-2").count()) === 1));
  await add.getByLabel("New color name").fill("#778899");
  check("a color pasted where the name goes is taken as the value", (await add.getByLabel("New color value").inputValue()) === "#778899" && (await add.getByLabel("New color name").inputValue()) === "semantic-3");
  await add.getByLabel("New color name").press("Escape");
  check("Esc closes it", (await add.count()) === 0);

  // ── Copying and deleting ─────────────────────────────────────────────────
  await page.getByLabel("Select semantic-1").check();
  await page.getByLabel("Select semantic-2").check();
  await bar.getByRole("button", { name: "Duplicate" }).click();
  check("tokens are copied beside the originals", await settle(async () => (await page.getByLabel("Select semantic-1-copy").count()) === 1 && (await page.getByLabel("Select semantic-2-copy").count()) === 1));
  await bar.getByRole("button", { name: "Delete" }).click();
  check("deleting asks first", (await bar.innerText()).includes("Delete 2?"));
  await bar.getByRole("button", { name: /Delete 2\?/ }).click();
  check("then does it", await settle(async () => (await page.getByLabel("Select semantic-1-copy").count()) === 0));
  await undo();
  check("and it can be undone", await settle(async () => (await page.getByLabel("Select semantic-1-copy").count()) === 1));

  // ── Groups ───────────────────────────────────────────────────────────────
  await page.getByLabel("Select teal-100").waitFor();
  await page.locator('[data-group="teal"]').getByRole("button", { name: "teal", exact: true }).dblclick();
  await page.getByLabel("Name of the teal group").fill("aqua");
  await page.getByLabel("Name of the teal group").press("Enter");
  check("a group is renamed, with its tokens", await settle(async () => (await groupNames()).includes("aqua") && (await names("aqua")).length === 2));
  await page.getByRole("button", { name: /Regroup by name/ }).click();
  check("Regroup by name files a ramp under its own name", await settle(async () => (await names("teal")).join() === "teal-100,teal-200" && !(await groupNames()).includes("aqua")), (await groupNames()).join());

  // ── Other kinds ──────────────────────────────────────────────────────────
  await page.getByRole("tab", { name: /Spacing/ }).click();
  await page.getByLabel("Select space-1").waitFor();
  check("spacing has the same arrangement", (await page.locator("[data-token-id]").count()) === 3 && (await page.getByLabel("Value of space-4").inputValue()) === "16");
  await page.getByLabel("Value of space-4").fill("20");
  await page.getByLabel("Value of space-4").press("Enter");
  check("a value is changed where it stands", await settle(async () => (await page.getByLabel("Value of space-4").inputValue()) === "20"));
  await page.screenshot({ path: `${OUT}/tokens-spacing-screen.png` });
  await undo();
  check("and undone", await settle(async () => (await page.getByLabel("Value of space-4").inputValue()) === "16"));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
