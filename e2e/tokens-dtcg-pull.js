// A repository whose tokens are design tokens (DTCG) files: opening the project brings them in (every set, theme and composition), Source
// control says so, Pull takes what the repository changes, and a value changed in both places asks which to keep.
const { chromium } = require("playwright");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady, openSourceControl } = require("./support/git-panel");
const { createFake } = require("./support/fake-github");
const { OUT } = require("./support/env");

const APP = "http://localhost:3000";
const srgb = (hex) => { const n = parseInt(hex.slice(1), 16); return { colorSpace: "srgb", components: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => parseFloat(c.toFixed(4))), hex }; };
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const CONFIG = json({ files: "single", output: "src/styles/tokens.css", tailwind: true, selectors: { dark: ".dark" }, sets: [{ name: "Brand", key: "tokens", themes: [{ key: "light", name: "Light" }, { key: "dark", name: "Dark" }] }] });
const base = (over = {}) => json({
  color: {
    primary: { $type: "color", $value: srgb(over.primary ?? "#3366ff"), $extensions: { "com.motif": { group: "brand" } } },
    surface: { $type: "color", $value: srgb("#ffffff") },
    accent: { $type: "color", $value: "{color.primary}" },
  },
  spacing: { "2": { $type: "dimension", $value: { value: 8, unit: "px" }, $extensions: { "com.motif": { name: "space-2" } } } },
  font: { sans: { $type: "fontFamily", $value: "Inter, sans-serif" } },
  text: { heading: { $type: "typography", $value: { fontFamily: "{font.sans}", fontSize: { value: 2, unit: "rem" }, fontWeight: 700 } } },
});
const DARK = json({ color: { surface: { $value: srgb("#111111") } } });
const gh = createFake({ name: "ds", files: {
  "README.md": "# ds", "package.json": JSON.stringify({ name: "ds", dependencies: { react: "^19.0.0" }, devDependencies: { tailwindcss: "^4.0.0" } }),
  "src/tokens/tokens.config.json": CONFIG, "src/tokens/tokens.json": base(), "src/tokens/tokens.dark.json": DARK,
  "src/components/Badge.tsx": 'export function Badge() {\n  return <span className="rounded-md bg-primary px-2 text-white">Badge</span>;\n}\n',
  "src/index.ts": 'export { Badge } from "./components/Badge";\n',
} });

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 500) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates|status of 40\d|status of 50\d|status of 422/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", (r) => gh.handler(r));
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });
  const settle = async (fn, ms = 20000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const saved = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0]); };

  // ── The first pull ────────────────────────────────────────────────────────
  await seed(page, "dt000001", { repo: "acme/ds", token: "t", name: "DS" });
  await page.goto(`${APP}/editor/dt000001`);
  await page.getByText("Layers", { exact: true }).waitFor();
  await componentsReady(page);
  await openSourceControl(page);
  const note = page.locator("[data-token-link][data-dtcg]");
  check("Source control says the tokens are design tokens files, for every set", (await note.innerText()).includes("src/tokens"), await note.innerText().catch(() => "none"));
  let project = await saved();
  check("the link is to design tokens files, with the files as the repository has them", project.repo.tokenLink.format === "dtcg" && project.repo.tokenLink.dir === "src/tokens" && Object.keys(project.repo.tokenLink.base).includes("src/tokens/tokens.dark.json"), JSON.stringify(Object.keys(project.repo.tokenLink ?? {})));
  const stored = project.tokens;
  check("the sets, themes and tokens came in", stored.sets.length === 1 && stored.sets[0].name === "Brand" && stored.sets[0].themes.map((t) => t.name).join() === "Light,Dark" && stored.tokens.filter((t) => t.type === "color").length === 3, JSON.stringify(stored.sets));
  const accent = stored.tokens.find((t) => t.name === "accent");
  const primary = stored.tokens.find((t) => t.name === "primary");
  check("a color that is another color is it", accent.ref && Object.values(accent.ref).every((id) => id === primary.id));
  check("the dark theme has its own value", stored.tokens.find((t) => t.name === "surface").values[stored.sets[0].themes[1].id] === "#111111");
  check("a composition came in as one, with its parts as tokens", stored.compositions.some((c) => c.name === "heading" && c.kind === "typography" && c.own && c.slots.find((s) => s.name === "font-family").ref));

  await page.locator('nav button[title="Tokens"]').click();
  await page.getByRole("tab", { name: /^Colors/ }).waitFor();
  check("the Tokens screen shows them", (await page.locator('button[aria-label^="primary:"]').count()) === 1 && (await page.getByRole("tab", { name: /^Compositions/ }).innerText()).includes("1"));
  await page.screenshot({ path: `${OUT}/tokens-dtcg-pull.png` });

  // ── The repository changes ────────────────────────────────────────────────
  gh.push("main", "src/tokens/tokens.json", base({ primary: "#ff0000" }));
  await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("button", { name: "Pull", exact: true }).click();
  await page.locator("[data-pull-notice]").getByText(/from the repository/).waitFor({ timeout: 30000 });
  project = await saved();
  const p2 = project.tokens.tokens.find((t) => t.name === "primary");
  check("Pull takes the change in, to the same token", p2.id === primary.id && p2.values[stored.sets[0].themes[0].id] === "#ff0000");
  check("and the color that is it follows", project.tokens.tokens.find((t) => t.name === "accent").values[stored.sets[0].themes[0].id] === "#ff0000");
  check("the link moves on to the files as they are now", project.repo.tokenLink.base["src/tokens/tokens.json"].includes('"#ff0000"'));

  // ── Both change the same value ────────────────────────────────────────────
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("motif-projects"));
    const t = raw.state.projects[0].tokens;
    const x = t.tokens.find((k) => k.name === "primary");
    const light = t.sets[0].themes[0].id;
    x.values[light] = "#00ff00"; x.value = "#00ff00";
    localStorage.setItem("motif-projects", JSON.stringify(raw));
  });
  await page.goto(`${APP}/editor/dt000001`);
  await page.getByText("Layers", { exact: true }).waitFor();
  await componentsReady(page);
  gh.push("main", "src/tokens/tokens.json", base({ primary: "#0000ff" }));
  await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("button", { name: "Pull", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 30000 });
  check("a value changed in both places asks, naming the token", (await dialog.innerText()).includes("color.primary"), await dialog.innerText());
  await page.screenshot({ path: `${OUT}/tokens-dtcg-conflict.png` });
  await dialog.getByRole("button", { name: /Repository/ }).click();
  await dialog.getByRole("button", { name: "Apply my choices" }).click();
  await settle(async () => (await page.getByRole("dialog").count()) === 0);
  project = await saved();
  check("the repository's side, when chosen, is taken", project.tokens.tokens.find((t) => t.name === "primary").values[stored.sets[0].themes[0].id] === "#0000ff");

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
