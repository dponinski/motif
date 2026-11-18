// Sets as collections: a name and a note of what each is for, an order of their own, asking before a set or a theme goes (and what goes),
// and where each theme of the set that is synced with the repository is in the repository.
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
  repo: {
    connection: { owner: "acme", repo: "ds", token: "t", defaultBranch: "main" },
    analysis: null,
    tokenLink: { repo: "acme/ds", branch: "main", setId: "set-prim", themes: { light: "p-l" }, baseTheme: "light", base: {}, staged: null, syncedAt: 1 },
  },
  tokens: {
    sets: [
      { id: "set-prim", name: "Primitives", themes: [{ id: "p-l", name: "Light" }, { id: "p-d", name: "Dark" }], activeThemeId: "p-l" },
      { id: "set-sem", name: "Semantic", themes: [{ id: "s-l", name: "Light" }, { id: "s-d", name: "Dark" }], activeThemeId: "s-l" },
      { id: "set-extra", name: "Extra", themes: [{ id: "x-d", name: "Default" }], activeThemeId: "x-d" },
    ],
    colors: [
      color("g50", "gray-50", "gray", "set-prim", { "p-l": "#f9fafb", "p-d": "#1f2937" }),
      color("g900", "gray-900", "gray", "set-prim", { "p-l": "#111827", "p-d": "#f3f4f6" }),
      { ...color("surface", "surface", "semantic", "set-sem", { "s-l": "#f9fafb", "s-d": "#1f2937" }), themeAlias: { "s-l": "set-prim/gray-50", "s-d": "set-prim/gray-50" } },
      color("e1", "accent", "extra", "set-extra", { "x-d": "#ff0000" }),
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
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates|net::ERR/i.test(m.text())) errors.push(m.text()); });
  await page.route(/api\.github\.com|raw\.githubusercontent\.com/, (r) => r.abort());

  await seed(page, "sets0001", { extra });
  await page.goto("http://localhost:3000/editor/sets0001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const sidebar = page.locator("div.w-\\[220px\\]");
  const rows = () => sidebar.locator("[data-set-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-set-row")));
  const row = (id) => sidebar.locator(`[data-set-row="${id}"]`);
  const hover = (id) => row(id).hover();
  const undo = () => page.getByRole("button", { name: "Undo", exact: true }).click();
  const saved = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens); };

  check("the sets are collections", (await sidebar.getByText("Collections", { exact: true }).count()) === 1 && (await sidebar.getByText("Sets", { exact: true }).count()) === 0);
  check("in the order they were made", (await rows()).join() === "set-prim,set-sem,set-extra");

  // ── A note of what a set is for ───────────────────────────────────────────
  await hover("set-prim");
  await page.getByLabel("Edit Primitives").click();
  await page.getByLabel("What this set is for").fill("Raw colors, never used directly");
  await page.getByLabel("What this set is for").press("Enter");
  check("a set can say what it is for, under its name", await settle(async () => (await row("set-prim").locator("[data-set-description]").innerText()) === "Raw colors, never used directly"));
  await hover("set-sem");
  await page.getByLabel("Edit Semantic").click();
  await page.getByLabel("Name of set").fill("Semantic colors");
  await page.getByLabel("What this set is for").fill("Follow the primitives");
  await page.getByLabel("Name of set").click();
  await page.locator("body").click({ position: { x: 900, y: 600 } });
  check("the name and the note are changed together, and leaving the fields takes them", await settle(async () => (await row("set-sem").innerText()).includes("Semantic colors") && (await row("set-sem").locator("[data-set-description]").innerText()) === "Follow the primitives"), await row("set-sem").innerText());
  await page.screenshot({ path: `${OUT}/tokens-sets-sidebar.png` });
  await undo();
  check("each is a step of undo", await settle(async () => !(await row("set-sem").innerText()).includes("Follow the primitives")) && (await row("set-sem").innerText()).includes("Semantic"));
  await undo();
  check("the note goes with undo too", await settle(async () => (await row("set-prim").locator("[data-set-description]").count()) === 0));
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();

  // ── Order ─────────────────────────────────────────────────────────────────
  await hover("set-prim");
  check("the first set can't move up, nor the last down", (await page.getByLabel("Move Primitives up").isDisabled()) && (await row("set-extra").hover().then(() => page.getByLabel("Move Extra down").isDisabled())));
  await hover("set-extra");
  await page.getByLabel("Move Extra up").click();
  check("a set moves a place up", await settle(async () => (await rows()).join() === "set-prim,set-extra,set-sem"), (await rows()).join());
  await hover("set-prim");
  await page.getByLabel("Move Primitives down").click();
  check("and down", await settle(async () => (await rows()).join() === "set-extra,set-prim,set-sem"));
  const order = (await saved()).sets.map((s) => s.id).join();
  check("the order is saved with the project, and so is the note", order === "set-extra,set-prim,set-sem" && (await saved()).sets.find((s) => s.id === "set-prim").description === "Raw colors, never used directly", order);
  await undo();
  await undo();
  check("both are undone", await settle(async () => (await rows()).join() === "set-prim,set-sem,set-extra"));

  // ── Deleting a set asks first ─────────────────────────────────────────────
  await hover("set-extra");
  await page.getByLabel("Delete Extra").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  check("deleting a set says what goes", (await dialog.locator("[data-delete-contents]").innerText()).includes("1 color") && (await dialog.getByRole("heading", { name: "Delete Extra?" }).count()) === 1, await dialog.innerText());
  check("and, when nothing leads into it, nothing about aliases", (await dialog.locator("[data-delete-detached]").count()) === 0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  check("Cancel leaves it", (await rows()).includes("set-extra") && (await page.getByRole("dialog").count()) === 0);
  await hover("set-extra");
  await page.getByLabel("Delete Extra").click();
  await page.keyboard.press("Escape");
  check("so does Escape", (await rows()).includes("set-extra") && (await page.getByRole("dialog").count()) === 0);

  // A set that colors of other sets are colors of says how many aliases end.
  await hover("set-sem");
  await page.getByLabel("Delete Semantic").click();
  check("a set no color is a color of has no aliases to end", (await page.getByRole("dialog").locator("[data-delete-detached]").count()) === 0);
  await page.keyboard.press("Escape");
  await hover("set-prim");
  await page.getByLabel("Delete Primitives").click();
  check("the set that is synced with the repository can't be deleted", (await page.getByRole("dialog").innerText()).includes("synced with the repository") && (await page.getByRole("dialog").getByRole("button", { name: "Delete set" }).count()) === 0, await page.getByRole("dialog").innerText());
  await page.keyboard.press("Escape");
  await hover("set-extra");
  await page.getByLabel("Delete Extra").click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete set" }).click();
  check("Delete set deletes it", await settle(async () => !(await rows()).includes("set-extra")));
  await undo();
  check("and it is one undo", await settle(async () => (await rows()).includes("set-extra")));

  // Another set whose colors are the set's.
  await page.evaluate(() => 0);
  await sidebar.getByText("Semantic colors", { exact: true }).click();
  await hover("set-sem");

  // ── Themes ────────────────────────────────────────────────────────────────
  await sidebar.getByText("Primitives", { exact: true }).click();
  const bar = page.locator("[data-theme-bar]");
  check("the themes of the synced set say where they are in the repository", (await bar.locator('[data-theme-segment="p-l"] [data-theme-repo]').innerText()) === "light" && (await bar.locator('[data-theme-segment="p-d"] [data-theme-repo]').innerText()) === "Motif only", await bar.innerText());
  await page.screenshot({ path: `${OUT}/tokens-sets-themes.png` });
  await sidebar.getByText("Semantic colors", { exact: true }).click();
  check("a set that isn't synced has no such marks", (await bar.locator("[data-theme-repo]").count()) === 0);

  await sidebar.getByText("Primitives", { exact: true }).click();
  await bar.locator('[data-theme-segment="p-d"]').hover();
  await bar.getByLabel("Theme menu: Dark").click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  const tdialog = page.getByRole("dialog");
  await tdialog.waitFor();
  check("deleting a theme says what goes", (await tdialog.locator("[data-delete-contents]").innerText()).includes("2 colors") && (await tdialog.getByRole("heading", { name: "Delete the Dark theme?" }).count()) === 1, await tdialog.innerText());
  check("and that colors of other sets that follow it by name will follow another theme", (await tdialog.innerText()).includes("follow the theme it has open"));
  await tdialog.getByRole("button", { name: "Cancel" }).click();
  check("Cancel leaves the theme", (await bar.locator('[data-theme-segment="p-d"]').count()) === 1);

  await bar.locator('[data-theme-segment="p-l"]').hover();
  await bar.getByLabel("Theme menu: Light").click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  check("a theme the repository has says it will come back", (await page.getByRole("dialog").locator("[data-delete-repo]").innerText()).includes('"light"'), await page.getByRole("dialog").innerText());
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await bar.locator('[data-theme-segment="p-d"]').hover();
  await bar.getByLabel("Theme menu: Dark").click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete theme" }).click();
  check("Delete theme deletes it", await settle(async () => (await bar.locator('[data-theme-segment="p-d"]').count()) === 0));
  await sidebar.getByText("Semantic colors", { exact: true }).click();
  await page.getByRole("button", { name: "Palette", exact: true }).click().catch(() => {});
  const t = await saved();
  const surface = t.tokens.find((x) => x.name === "surface");
  check("the colors that followed it by name follow the theme the set has open", surface.values["s-d"] === "#f9fafb", JSON.stringify(surface.values));
  await undo();
  await sidebar.getByText("Primitives", { exact: true }).click();
  check("and it is one undo", await settle(async () => (await bar.locator('[data-theme-segment="p-d"]').count()) === 1));

  // ── Deleting a set that colors are colors of ─────────────────────────────
  // (Primitives is the synced set above, so this is the same project with no repository linked.)
  const { repo: _, ...unlinkedExtra } = extra;
  await seed(page, "sets0002", { extra: unlinkedExtra });
  await page.goto("http://localhost:3000/editor/sets0002");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Tokens"]').click();
  await page.locator("[data-token-groups]").waitFor();
  await hover("set-prim");
  await page.getByLabel("Delete Primitives").click();
  const d2 = page.getByRole("dialog");
  check("a set that colors of other sets are colors of says how many aliases end", (await d2.locator("[data-delete-detached]").innerText()).startsWith("2 aliases"), await d2.innerText());
  await d2.getByRole("button", { name: "Delete set" }).click();
  await sidebar.getByText("Semantic", { exact: true }).click();
  check("and those colors keep the colors they had", await settle(async () => { const x = (await saved()).tokens.find((y) => y.name === "surface"); return x.ref === undefined && x.values["s-l"] === "#f9fafb"; }));
  await undo();
  check("and undo brings the set and the aliases back", await settle(async () => (await rows()).includes("set-prim") && (await saved()).tokens.find((y) => y.name === "surface").ref !== undefined));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
