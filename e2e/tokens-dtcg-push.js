// A repository whose tokens are design tokens files, pushed: a token changed in Motif goes into the pull request as a change to the files
// (only that value, in the text they have) and to the stylesheet they come to; merged, nothing is waiting any more.
const { chromium } = require("playwright");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");
const { createFake } = require("./support/fake-github");
const { OUT } = require("./support/env");

const APP = "http://localhost:3000";
const srgb = (hex) => { const n = parseInt(hex.slice(1), 16); return { colorSpace: "srgb", components: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => parseFloat(c.toFixed(4))) }; };
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const CONFIG = json({ files: "single", output: "src/styles/tokens.css", tailwind: true, selectors: { dark: ".dark" }, sets: [{ name: "Brand", key: "tokens", themes: [{ key: "light", name: "Light" }, { key: "dark", name: "Dark" }] }] });
// The repository's own files: no hex on the colors, a description, a group deeper than Motif would nest it.
const TOKENS = json({
  color: {
    $type: "color",
    brand: { "500": { $value: srgb("#3366ff"), $description: "The brand blue" } },
    surface: { $value: srgb("#ffffff") },
  },
  spacing: { "2": { $type: "dimension", $value: { value: 8, unit: "px" } } },
});
const DARK = json({ color: { surface: { $value: srgb("#111111") } } });
const CSS = "/**\n * Generated from the design tokens files by `npm run tokens:build`. Do not edit directly.\n */\n\n@theme {\n  --color-brand-500: #3366ff;\n  --color-surface: #ffffff;\n  --spacing-2: 8px;\n}\n\n.dark {\n  --color-surface: #111111;\n}\n";
const gh = createFake({ name: "ds", files: {
  "README.md": "# ds", "package.json": JSON.stringify({ name: "ds", dependencies: { react: "^19.0.0" }, devDependencies: { tailwindcss: "^4.0.0" } }),
  "src/tokens/tokens.config.json": CONFIG, "src/tokens/tokens.json": TOKENS, "src/tokens/tokens.dark.json": DARK, "src/styles/tokens.css": CSS,
  "src/components/Badge.tsx": 'export function Badge() {\n  return <span className="rounded-md bg-brand-500 px-2 text-white">Badge</span>;\n}\n',
  "src/index.ts": 'export { Badge } from "./components/Badge";\n',
} });
const repo = gh.repo;

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 600) : ""}`);
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
  const settle = async (fn, ms = 30000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const status = () => page.getByRole("status", { name: "Sync status" }).innerText().catch(() => "");
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const saved = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0]); };
  const editMotif = async (fn) => {
    await page.waitForTimeout(1500);
    await page.evaluate((src) => {
      const raw = JSON.parse(localStorage.getItem("motif-projects"));
      new Function("state", src)(raw.state.projects[0].tokens);
      localStorage.setItem("motif-projects", JSON.stringify(raw));
    }, `(${fn.toString()})(state)`);
    await page.goto(`${APP}/editor/dp000001`);
    await page.getByText("Layers", { exact: true }).waitFor();
    await componentsReady(page);
  };

  await seed(page, "dp000001", { repo: "acme/ds", token: "t", name: "DS" });
  await page.goto(`${APP}/editor/dp000001`);
  await page.getByText("Layers", { exact: true }).waitFor();
  await componentsReady(page);
  await page.locator('nav button[title="Source control"]').click();
  await page.locator("[data-token-link][data-dtcg]").waitFor({ timeout: 60000 });
  check("the tokens came in and nothing is waiting, though the repository's files aren't in Motif's own form", await settle(async () => !(await status()).includes("waiting")), await status());

  // ── A token changed in Motif ──────────────────────────────────────────────
  await editMotif((t) => {
    const x = t.tokens.find((k) => k.name === "surface");
    const light = t.sets[0].themes[0].id;
    x.values[light] = "#fafafa"; x.value = "#fafafa";
  });
  await page.locator('nav button[title="Source control"]').click();
  check("it is counted as waiting to be sent", await settle(async () => /1 .*waiting/.test(await status())), await status());
  await page.screenshot({ path: `${OUT}/tokens-dtcg-waiting.png` });
  await page.getByRole("button", { name: "Push" }).click();
  check("Push opens a pull request", await settle(async () => repo.prs.length === 1 && (await status()).includes("In sync with pull request #1")), await status());
  const pr = repo.prs[0];
  const head = gh.files(pr.head);
  const main = gh.files("main");
  const changed = [...head].filter(([p, t]) => t !== main.get(p)).map(([p]) => p).sort();
  check("it changes the tokens file and the stylesheet, and nothing else", changed.join() === "src/styles/tokens.css,src/tokens/tokens.json", changed.join());
  const tokens = JSON.parse(head.get("src/tokens/tokens.json"));
  check("the value that changed is changed in the file", tokens.color.surface.$value.hex === "#fafafa" || tokens.color.surface.$value.components[0] === 0.9804, JSON.stringify(tokens.color.surface));
  check("the rest of the file is as the repository wrote it: its group, its description, no hex added", tokens.color.$type === "color" && tokens.color.brand["500"].$description === "The brand blue" && !("hex" in tokens.color.brand["500"].$value), JSON.stringify(tokens.color.brand));
  check("the stylesheet is generated from the files", head.get("src/styles/tokens.css").includes("--color-surface: #fafafa;") && head.get("src/styles/tokens.css").includes("--color-brand-500: #3366ff;"), head.get("src/styles/tokens.css"));
  check("the dark theme's file is untouched", head.get("src/tokens/tokens.dark.json") === main.get("src/tokens/tokens.dark.json"));
  check("the pull request says which token changed", (repo.prs[0].body ?? "").includes("color.surface"), repo.prs[0].body);
  await page.screenshot({ path: `${OUT}/tokens-dtcg-pushed.png` });

  // ── A change in the dark theme goes to its file ───────────────────────────
  await editMotif((t) => {
    const x = t.tokens.find((k) => k.name === "surface");
    const dark = t.sets[0].themes[1].id;
    x.values[dark] = "#0a0a0a";
  });
  await page.locator('nav button[title="Source control"]').click();
  await settle(async () => /waiting/.test(await status()));
  await page.getByRole("button", { name: "Push" }).click();
  check("a change in another theme goes in that theme's file, in the same pull request", await settle(async () => JSON.parse(gh.files(repo.prs[0].head).get("src/tokens/tokens.dark.json")).color.surface.$value.hex === "#0a0a0a" && repo.prs.length === 1), gh.files(repo.prs[0].head).get("src/tokens/tokens.dark.json"));
  check("and the stylesheet follows", gh.files(repo.prs[0].head).get("src/styles/tokens.css").includes("--color-surface: #0a0a0a;"));

  // ── A token deleted in Motif is taken out of the files ────────────────────
  await editMotif((t) => { t.tokens = t.tokens.filter((k) => !k.name.includes("500")); });
  await page.locator('nav button[title="Source control"]').click();
  check("deleting a token is counted as waiting, and doesn't ask for a pull first", await settle(async () => /waiting/.test(await status()) && !/Pull/.test(await status())), await status());
  await page.getByRole("button", { name: "Push" }).click();
  check("the token is removed from the file and the stylesheet, in the same pull request", await settle(async () => { const f = gh.files(repo.prs[0].head); return !JSON.stringify(JSON.parse(f.get("src/tokens/tokens.json")).color).includes("#3366ff") && !f.get("src/styles/tokens.css").includes("--color-brand-500") && repo.prs.length === 1; }), gh.files(repo.prs[0].head).get("src/styles/tokens.css"));
  check("and the rest is as it was", gh.files(repo.prs[0].head).get("src/styles/tokens.css").includes("--color-surface: #0a0a0a;") && JSON.parse(gh.files(repo.prs[0].head).get("src/tokens/tokens.json")).spacing["2"] !== undefined);

  // ── Merged ────────────────────────────────────────────────────────────────
  gh.merge(1);
  await focus();
  check("when the pull request is merged the panel says so", await settle(async () => (await page.getByText(/was merged/).count()) > 0), await status());
  check("and nothing is waiting", await settle(async () => (await status()).includes("Nothing to sync")), await status());
  const project = await saved();
  const baseTokens = project.repo.tokenLink.base["src/tokens/tokens.json"];
  check("the link's files are what the pull request carried, with nothing staged", project.repo.tokenLink.format === "dtcg" && !project.repo.tokenLink.staged && (baseTokens.includes("#fafafa") || baseTokens.includes("0.9804")), baseTokens.slice(0, 300));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
