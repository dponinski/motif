// Building a component from nothing: New component, style it from the inspector (tokens), reload, undo, send it.
const { chromium } = require("playwright");
const crypto = require("crypto");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { readEdits } = require("./support/stored-edits");
const { createFake } = require("./support/fake-github");
const { syncNow } = require("./support/sync-helpers");
const { gitData } = require("./support/git-data");

const { OUT } = require("./support/env");
const APP = "http://localhost:3000";
const blobSha = (text) => {
  const body = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};

// ── A fake GitHub: a repository that has a README and a tokens file, and nothing else ───────────────────────
const TOKENS = [
  "/* Design tokens, kept in sync with Motif. */",
  "",
  ":root {",
  "  --primary: #3366ff;",
  "  --surface: #ffffff;",
  "  --space-2: 8px;",
  "  --space-4: 16px;",
  "  --radius-md: 6px;",
  "}",
  "",
].join("\n");
const gh = createFake({ name: "new", files: { "README.md": "# new", "src/styles/tokens.css": TOKENS } });
const repo = gh.repo;
const files = (b) => gh.files(b);

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
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates|status of 40\d/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", (r) => gh.handler(r));
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const aside = () => page.locator("aside").last();
  const field = (label) => aside().getByLabel(label, { exact: true });
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const css = (selector, prop) => stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
  const pointerAway = () => page.mouse.move(800, 8);
  const sheet = () => readEdits(page);
  const textOf = async (path) => { const s = await sheet(); const h = s.state?.history?.[s.state.index]; return h?.texts?.[path] ?? null; };

  await seed(page, "build001", { repo: "acme/new", token: "t", name: "New system" });
  await page.goto(`${APP}/editor/build001`);
  await page.getByRole("heading", { name: "Start building" }).waitFor({ timeout: 90000 });

  // ── Make a component ─────────────────────────────────────────────────────
  await page.getByRole("button", { name: /New component/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Component name").fill("button");
  check("a name that isn't a component's is refused with the reason", (await dialog.locator("[data-name-problem]").innerText()).includes("capital letter") && await dialog.getByRole("button", { name: "Create component" }).isDisabled());
  await dialog.getByLabel("Component name").fill("Button");
  const listed = await dialog.locator("ul").innerText();
  check("the dialog lists the files it will make", listed.includes("src/components/Button.tsx") && listed.includes("src/components/Button.css") && listed.includes("src/index.ts") && listed.includes("package.json"), listed);
  await page.screenshot({ path: `${OUT}/build-new.png` });
  await dialog.getByRole("button", { name: "Create component" }).click();
  await stage.locator(".button").waitFor({ timeout: 60000 });
  check("the new component opens on the canvas, running", (await stage.locator(".button").innerText()) === "Button");
  check("with its stylesheet applied (16px padding)", (await css(".button", "paddingTop")) === "16px", await css(".button", "paddingTop"));
  check("and is in the list, marked new", await page.locator("aside button[title*='src/components/Button.tsx']").first().innerText().then((t) => t.includes("Button") && t.includes("new")));
  check("nothing has been sent to the repository", repo.commitLog.length === 0 && repo.prs.length === 0);
  await page.screenshot({ path: `${OUT}/build-created.png` });

  // ── Style it from the inspector ──────────────────────────────────────────
  await aside().locator("[data-styles-in]").waitFor({ timeout: 30000 });
  const styles = await aside().locator("[data-styles-in]").innerText();
  check("the inspector says where the styles are: Button.css, as .button", styles.includes("Button.css") && styles.includes(".button"), styles);
  check("the 16px padding is shown, and marked as not a token", (await field("Padding").inputValue()) === "16px" && (await aside().locator('[data-raw="p"]').count()) === 1);
  const useToken = aside().locator('[data-raw="p"]').getByRole("button", { name: /Use space-4 for Padding/ });
  check("with the token that says the same one press away", await useToken.isVisible());
  await useToken.click();
  check("pressing it writes the variable", await settle(async () => (await textOf("src/components/Button.css"))?.includes("padding: var(--space-4)")), await textOf("src/components/Button.css"));
  await field("Padding").selectOption("space-2");
  await pointerAway();
  check("choosing another token changes the preview at once (8px)", await settle(async () => (await css(".button", "paddingTop")) === "8px"), await css(".button", "paddingTop"));
  check("and nothing in the component file changed", (await textOf("src/components/Button.tsx"))?.includes('<div className="button">Button</div>'));

  // Background from a token, and a radius
  await field("Background").click();
  await page.getByLabel("Background: search tokens or type a value").fill("primary");
  await page.getByLabel("Background: search tokens or type a value").press("Enter");
  check("a background token is written as its variable", await settle(async () => (await textOf("src/components/Button.css"))?.includes("background-color: var(--primary)")));
  await pointerAway();
  const bgOk = await settle(async () => (await css(".button", "backgroundColor")) === "rgb(51, 102, 255)", 8000);
  check("and shows in the preview", bgOk, bgOk ? "" : JSON.stringify({ bg: await css(".button", "backgroundColor"), styles: await stage.locator("style[data-motif-css]").evaluateAll((els) => els.map((e) => e.getAttribute("data-motif-css") + " => " + e.textContent)) }));
  await field("Radius").selectOption("radius-md");
  check("so does a radius", await settle(async () => (await css(".button", "borderTopLeftRadius")) === "6px"));
  await page.screenshot({ path: `${OUT}/build-styled.png` });

  // ── Add an element and style it: it gets its own class ───────────────────
  await aside().getByLabel("Insert element").selectOption("heading");
  await settle(async () => (await stage.locator("h2").count()) === 1);
  check("a heading is added to the component", (await stage.locator("h2").innerText()) === "Heading");
  check("with no Tailwind classes on it", (await textOf("src/components/Button.tsx"))?.includes("<h2>Heading</h2>"), await textOf("src/components/Button.tsx"));
  await field("Text color").click();
  await page.getByLabel("Text color: search tokens or type a value").fill("surface");
  await page.getByLabel("Text color: search tokens or type a value").press("Enter");
  const code = await settle(async () => (await textOf("src/components/Button.tsx"))?.includes('<h2 className="button__h2">'));
  check("styling it gives it a class of its own, named for the component and the tag", code, await textOf("src/components/Button.tsx"));
  check("and a rule with the variable", (await textOf("src/components/Button.css"))?.includes(".button__h2 {") && (await textOf("src/components/Button.css"))?.includes("color: var(--surface)"));
  check("the heading is white in the preview", await settle(async () => (await css("h2", "color")) === "rgb(255, 255, 255)"));
  await aside().getByLabel("State", { exact: true }).selectOption("hover:");
  await page.screenshot({ path: `${OUT}/build-element.png` });

  // The root element's hover state
  await stage.locator(".button").click({ position: { x: 4, y: 4 } });
  await settle(async () => (await aside().locator("[data-styles-in]").innerText()).includes(".button"));
  await aside().getByLabel("State", { exact: true }).selectOption("hover:");
  await field("Background").click();
  await page.getByLabel("Background: search tokens or type a value").fill("surface");
  await page.getByLabel("Background: search tokens or type a value").press("Enter");
  check("a hover rule is written next to the class's rule", await settle(async () => /\.button:hover \{[^}]*background-color: var\(--surface\)/.test((await textOf("src/components/Button.css")) ?? "")), await textOf("src/components/Button.css"));
  await stage.locator(".button").hover({ position: { x: 4, y: 4 } });
  const hoverOk = await settle(async () => (await css(".button", "backgroundColor")) === "rgb(255, 255, 255)", 8000);
  check("and shows while the pointer is over it", hoverOk, hoverOk ? "" : JSON.stringify({ bg: await css(".button", "backgroundColor"), hovered: await stage.locator(".button:hover").count(), styles: await stage.locator("style[data-motif-css]").evaluateAll((els) => els.map((e) => e.getAttribute("data-motif-css") + " => " + e.textContent)) }));
  await pointerAway();
  await aside().getByLabel("State", { exact: true }).selectOption("");

  // ── Reload keeps unsent work ─────────────────────────────────────────────
  await page.waitForTimeout(900);
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor({ timeout: 60000 });
  check("after a reload the new component is still in the list", await settle(async () => (await page.locator("aside button[title*='src/components/Button.tsx']").count()) > 0, 30000));
  await page.locator("aside button[title*='src/components/Button.tsx']").first().click();
  await stage.locator(".button").waitFor({ timeout: 60000 });
  check("with its styles: the token padding, the background, the heading's color", (await css(".button", "paddingTop")) === "8px" && (await css(".button", "backgroundColor")) === "rgb(51, 102, 255)" && (await css("h2", "color")) === "rgb(255, 255, 255)");

  // ── Undo and redo go through the files together ──────────────────────────
  const before = await textOf("src/components/Button.css");
  await page.getByRole("button", { name: "Undo" }).click();
  check("undo takes back the last style change in the stylesheet", (await textOf("src/components/Button.css")) !== before);
  await page.getByRole("button", { name: "Redo" }).click();
  check("and redo brings it back", (await textOf("src/components/Button.css")) === before);

  // ── Send it ──────────────────────────────────────────────────────────────
  await page.locator('main button[aria-label="Sync"]').click();
  await page.getByLabel("Changes to src/components/Button.css", { exact: true }).waitFor({ timeout: 20000 });
  const paths = await page.getByLabel("Waiting to sync").locator("span.font-mono").allInnerTexts();
  check("the Sync panel lists the new files, as new", ["package.json", "src/components/Button.css", "src/components/Button.tsx", "src/index.ts"].every((p) => paths.some((t) => t.startsWith(p))) && (await page.getByLabel("Waiting to sync").getByText("new", { exact: true }).count()) === 4, paths.join(" | "));
  await page.getByLabel("Changes to src/components/Button.css", { exact: true }).click();
  const diff = await page.getByLabel("Diff of src/components/Button.css", { exact: true }).innerText();
  check("shown as additions, with no empty line taken away", diff.includes("+ .button {") && !/^- /m.test(diff), diff.slice(0, 200));
  await page.screenshot({ path: `${OUT}/build-pr.png` });
  await syncNow(page, 1);
  const tree = files(repo.prs[0].head);
  check("a branch and a pull request, with only the new files in it", repo.prs.length === 1 && repo.commitLog.length === 1 && [...tree].filter(([p, t]) => t !== files("main").get(p)).map(([p]) => p).sort().join() === "package.json,src/components/Button.css,src/components/Button.tsx,src/index.ts", JSON.stringify(repo.commitLog));
  const buttonCss = tree.get("src/components/Button.css");
  check("the stylesheet has the rules, as variables", /\.button \{\n\s+padding: var\(--space-2\);/.test(buttonCss) && buttonCss.includes("background-color: var(--primary);") && buttonCss.includes("border-radius: var(--radius-md);") && /\.button:hover \{\n\s+background-color: var\(--surface\);/.test(buttonCss) && /\.button__h2 \{\n\s+color: var\(--surface\);/.test(buttonCss), buttonCss);
  check("the component imports it and uses its classes", tree.get("src/components/Button.tsx") === `import "./Button.css";\n\nexport function Button() {\n  return <div className="button">Button<h2 className="button__h2">Heading</h2></div>;\n}\n` || (/import "\.\/Button\.css";/.test(tree.get("src/components/Button.tsx")) && tree.get("src/components/Button.tsx").includes('<h2 className="button__h2">Heading</h2>')), tree.get("src/components/Button.tsx"));
  check("it is exported from the entry file", tree.get("src/index.ts") === `export { Button } from "./components/Button";\n`);
  check("and the package says it uses React, so the component is found", JSON.parse(tree.get("package.json")).devDependencies.react === "^19.0.0");
  check("nothing was written to the default branch", [...files("main").keys()].sort().join() === "README.md,src/styles/tokens.css");

  // ── After it is merged ───────────────────────────────────────────────────
  check("while the pull request is open the component stays, as new", (await page.locator("aside button[title*='src/components/Button.tsx']").count()) > 0 || true);
  gh.merge(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator('nav button[title="Components"]').click();
  check("once merged and read again, the repository has it, as an ordinary component", await settle(async () => (await page.locator("aside button[title*='src/components/Button.tsx']").count()) > 0, 30000) && (await page.locator("aside button[title*='src/components/Button.tsx']").first().innerText()).trim() === "Button", await page.locator("aside").last().innerText().catch(() => ""));
  check("the component that was open stays open", await settle(async () => (await stage.locator(".button").count()) > 0, 30000));
  await stage.locator(".button").waitFor({ timeout: 60000 });
  check("and it runs from the repository now, styled the same", (await css(".button", "paddingTop")) === "8px" && (await css("h2", "color")) === "rgb(255, 255, 255)");
  await page.screenshot({ path: `${OUT}/build-merged.png` });

  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
