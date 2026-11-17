// A repository whose tokens are variables in its stylesheet: they come into Motif without a question and without a write to the repository, and
// the first push moves them into design tokens files, takes them out of the stylesheet and says every value comes out the same.
const { chromium } = require("playwright");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");
const { createFake } = require("./support/fake-github");
const { OUT } = require("./support/env");

const APP = "http://localhost:3000";
const CSS = `@import "tailwindcss";

:root {
  --radius: 0.5rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.55 0.2 260);
  --primary-foreground: oklch(0.985 0 0);
  --card: var(--background);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.7 0.15 260);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --radius-sm: calc(var(--radius) - 4px);
}

@theme {
  --color-brand: #4f46e5;
  --spacing-18: 4.5rem;
}

body { background: var(--background); color: var(--foreground); }
`;
const gh = createFake({ name: "ds", files: {
  "README.md": "# ds", "package.json": JSON.stringify({ name: "ds", dependencies: { react: "^19.0.0" }, devDependencies: { tailwindcss: "^4.0.0" } }),
  "src/app.css": CSS,
  "src/components/Badge.tsx": 'export function Badge() {\n  return <span className="rounded-md bg-primary px-2 text-primary-foreground">Badge</span>;\n}\n',
  "src/index.ts": 'export { Badge } from "./components/Badge";\n',
} });
const repo = gh.repo;

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 700) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates|status of 40\d|status of 50\d|status of 422/i.test(m.text())) errors.push(m.text()); });
  await context.addInitScript(() => { try { localStorage.setItem("motif-convert-tokens", "1"); } catch {} });
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

  await seed(page, "dp000001", { repo: "acme/ds", token: "t", name: "DS" });
  await page.goto(`${APP}/editor/dp000001`);
  await page.getByText("Layers", { exact: true }).waitFor();
  await componentsReady(page);
  await page.locator('nav button[title="Source control"]').click();
  await page.locator("[data-token-link][data-dtcg]").waitFor({ timeout: 60000 });
  const note = await page.locator("[data-token-link][data-dtcg]").first().innerText();
  check("the panel says the tokens are in the stylesheet and will move with the first push", /variables in your stylesheets/.test(note) && /first push/.test(note), note);
  check("the first pull wrote nothing to the repository", repo.commitLog.length === 0 && repo.prs.length === 0);
  const project = await saved();
  const link = project.repo.tokenLink;
  check("the link is to design tokens files that don't exist yet", link.format === "dtcg" && !!link.convert && link.convert.converted.includes("primary") && link.convert.converted.includes("color-brand"), JSON.stringify(link.convert).slice(0, 200));
  check("what stays in the stylesheet is listed", link.convert.left.some((l) => l.name === "radius-sm" || /calc/.test(l.reason)) || link.convert.left.length === 0, JSON.stringify(link.convert.left));
  check("the tokens are in Motif under the names the variables have, with light and dark", project.tokens.tokens.some((t) => t.name === "primary" && t.type === "color" && Object.keys(t.values).length === 2) && project.tokens.sets[0].themes.length === 2, JSON.stringify(project.tokens.tokens.map((t) => t.name)));
  check("it counts them as waiting to be sent", await settle(async () => /waiting/.test(await status())), await status());
  await page.screenshot({ path: `${OUT}/tokens-convert-waiting.png` });

  // ── The first push ────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Push" }).click();
  check("Push opens a pull request", await settle(async () => repo.prs.length === 1 && (await status()).includes("In sync with pull request #1")), await status());
  const head = gh.files(repo.prs[0].head);
  const main = gh.files("main");
  const changed = [...head].filter(([p, t]) => t !== main.get(p)).map(([p]) => p).sort();
  check("it adds the files, the build and the generated stylesheet, and edits package.json and the stylesheet", changed.join() === "package.json,src/app.css,src/tokens.css,src/tokens/tokens.config.json,src/tokens/tokens.dark.json,src/tokens/tokens.json,style-dictionary.config.mjs", changed.join());
  const app = head.get("src/app.css");
  check("the converted variables are out of the stylesheet; the aliases Tailwind reads, the calc() and the rules are still there", !app.includes("oklch(0.55 0.2 260)") && !app.includes("--color-brand") && app.includes("--color-primary: var(--primary);") && app.includes("--radius-sm: calc(var(--radius) - 4px);") && app.includes("body { background: var(--background); color: var(--foreground); }"), app);
  check("the generated stylesheet is imported after Tailwind", app.includes('@import "tailwindcss";\n@import "./tokens.css";'), app.slice(0, 120));
  const gen = head.get("src/tokens.css");
  check("the generated stylesheet has the variables with the names they had", gen.includes("--primary: oklch(0.55 0.2 260);") && gen.includes("--radius: 0.5rem;") && gen.includes("--card: var(--background);") && /@theme \{[^}]*--color-brand: #4f46e5;/.test(gen) && /\.dark \{[^}]*--primary: oklch\(0\.7 0\.15 260\);/.test(gen), gen);
  const body = repo.prs[0].body ?? "";
  check("the pull request says every value comes out the same", /Check: \d+ variables, all identical/.test(body), body.slice(0, 600));
  check("and which variables stay where they are", /Left in the stylesheets/.test(body), body.slice(0, 600));
  await page.screenshot({ path: `${OUT}/tokens-convert-pushed.png` });

  // ── Merged: the files are the repository's now ────────────────────────────
  gh.merge(1);
  await focus();
  check("when the pull request is merged nothing is waiting", await settle(async () => (await status()).includes("Nothing to sync")), await status());
  const after = await saved();
  check("the link is to the files now, with nothing staged", after.repo.tokenLink.format === "dtcg" && !after.repo.tokenLink.convert && !after.repo.tokenLink.staged && "src/tokens/tokens.json" in after.repo.tokenLink.base, Object.keys(after.repo.tokenLink.base).join());
  const settled = await page.locator("[data-token-link][data-dtcg]").first().innerText();
  check("the panel talks about the files, not the conversion", /design tokens files in src\/tokens/.test(settled) && !/variables in your stylesheets/.test(settled), settled);

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
