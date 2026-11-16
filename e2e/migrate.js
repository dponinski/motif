const { chromium } = require("playwright");
const { OUT } = require("./support/env");
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 300) : ""}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.github.com/**", (r) => r.abort());

  await page.goto("http://localhost:3000/");
  // A project as the previous version stored it: with a canvas, its own components and docs about them.
  await page.evaluate(() => {
    const token = (id, name) => ({ id, name, value: "#ff0000", group: "g", setId: "set-global", themeValues: { "theme-default": "#ff0000" } });
    localStorage.setItem("motif-projects", JSON.stringify({
      state: { projects: [{
        id: "old00001", name: "Old DS", createdAt: 1, updatedAt: 2,
        repo: { connection: { owner: "acme", repo: "ds", token: "t", defaultBranch: "main" }, analysis: null, tokenLink: null },
        library: { source: null, components: [] },
        tokens: { sets: [{ id: "set-global", name: "Global", themes: [{ id: "theme-default", name: "Default" }], activeThemeId: "theme-default" }], colors: [token("c1", "brand")], typography: [], spacing: [], radii: [], shadows: [], components: [] },
        content: {
          componentGroups: [],
          components: [{ id: "comp-main", name: "Main", groupId: null, variantProps: [], elements: { a: { id: "a", type: "rectangle", name: "a", x: 0, y: 0, width: 5, height: 5, fill: "#000", opacity: 1, rotation: 0 } }, order: ["a"] }],
          docs: [
            { id: "doc-comp-comp-main", title: "Main", blocks: [{ id: "x", type: "preview", componentId: "comp-main" }] },
            { id: "doc-tokens-colors", title: "Colors", blocks: [{ id: "i", type: "text", text: "Brand colors." }, { id: "t", type: "tokens", kind: "colors" }] },
            { id: "mine", title: "Principles", blocks: [{ id: "h", type: "heading", text: "Voice" }, { id: "p", type: "props", componentId: "comp-main" }] },
          ],
        },
      }] },
      version: 1,
    }));
    localStorage.setItem("motif-theme", JSON.stringify({ state: { mode: "light" }, version: 0 }));
  });
  await page.goto("http://localhost:3000/");
  await page.getByText("Design systems").waitFor();
  check("a project saved by the previous version is still listed", await page.locator('[data-project="old00001"]').isVisible());
  await page.locator('[data-project="old00001"]').click();
  await page.getByText("Layers", { exact: true }).waitFor();
  // The repository is read when a project opens (there is no fake GitHub here, so the read fails): any of these is "opened".
  await page.locator("[data-reading], h1").first().waitFor();
  check("and opens", (await page.locator("h1, [data-reading]").first().isVisible()) && (await page.getByText("Repository components").isVisible()));
  await page.locator('nav button[title="Docs"]').click();
  await page.getByText("Documentation", { exact: true }).waitFor();
  const sidebar = page.locator("div.w-\\[220px\\]");
  const paper = page.locator(".motif-docs");
  check("its docs about components of the old canvas are gone", (await sidebar.getByRole("button", { name: "Main", exact: true }).count()) === 0);
  await sidebar.getByRole("button", { name: "Colors" }).click();
  check("its docs about tokens are kept", (await paper.getByLabel("Text").first().inputValue()) === "Brand colors." && (await paper.locator(".md-swatch").count()) === 1);
  await sidebar.getByRole("button", { name: "Principles" }).click();
  check("and so is a page of its own, without the blocks that showed the old components", (await paper.locator(".md-block").count()) === 1 && (await paper.getByLabel("Heading").inputValue()) === "Voice");
  await page.waitForTimeout(900);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")));
  check("its tokens are saved as tokens and compositions, with the color the old project had", saved.state.projects[0].tokens.tokensVersion === 3 && saved.state.projects[0].tokens.tokens.some((t) => t.type === "color" && t.name === "brand") && saved.state.projects[0].tokens.colors === undefined);
  check("it is saved in the new shape", saved.version === 3 && saved.state.projects[0].content === undefined && Array.isArray(saved.state.projects[0].docs));
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2000)); process.exit(1); });
