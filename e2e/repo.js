const { seed } = require("./support/seed");
const { openDetails } = require("./support/git-panel");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const { OUT } = require("./support/env");
const { FIXTURE } = require("./support/env");

function loadDir(dir, prefix = "") {
  const files = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) Object.assign(files, loadDir(path.join(dir, e.name), `${prefix}${e.name}/`));
    else files[`${prefix}${e.name.replace(/\.fixture$/, "")}`] = fs.readFileSync(path.join(dir, e.name), "utf8");
  }
  return files;
}

const XSS = "<img src=x onerror=window.__xss=1>";
const repos = {
  "dponinski/motif-test-system": loadDir(FIXTURE),
  "acme/evil": {
    "package.json": JSON.stringify({ name: `<b>pkg</b>`, dependencies: { react: "^18", tailwindcss: "^4.0.0" } }),
    "src/styles.css": `:root { --x: rgb(0 0 0) url(https://evil.test/pixel.png); --y: #ff0000; --${"z"}: red; }`,
    "src/Evil.tsx": `
      export interface EvilProps {
        /** <script>window.__xss=2</script> */
        "${XSS}": string;
        tone?: "<b>loud</b>" | "calm";
      }
      export function Evil({ tone = "calm" }: EvilProps) { return <div className="p-1" />; }`,
    [`src/${XSS}.tsx`]: `export const Odd = () => <i className="a" />;`,
  },
};

const requests = [];
let rateLimit = false;
// A branch that moves is a new commit (and a new tree): what is read for a commit is kept, so reading again asks again only then.
let moved = false;
const sha = (ref) => (ref === "main" ? (moved ? "c" : "a").repeat(40) : "b".repeat(40));

async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  requests.push({ url: req.url(), auth: req.headers()["authorization"] ?? null });
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "x-ratelimit-remaining" };
  const json = (status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, ...extra }, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

  if (url.host === "raw.githubusercontent.com") {
    const [owner, repo, ref, ...rest] = url.pathname.slice(1).split("/");
    const text = repos[`${owner}/${repo}`]?.[decodeURIComponent(rest.join("/"))];
    return text === undefined ? route.fulfill({ status: 404, headers: cors, body: "404: Not Found" }) : route.fulfill({ status: 200, headers: cors, contentType: "text/plain", body: text });
  }

  const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const files = m && repos[m[1]];
  if (!files) return json(404, { message: "Not Found" });
  const auth = req.headers()["authorization"];
  if (auth && auth !== "Bearer t") return json(401, { message: "Bad credentials" });
  const rest = decodeURIComponent(m[2] ?? "");
  if (rest === "") return json(200, { default_branch: "main", permissions: { push: auth === "Bearer t" } });
  if (rest === "/branches") return json(200, [{ name: "main" }, { name: "redesign" }]);
  if (rest.startsWith("/git/ref/heads/")) return json(200, { object: { sha: sha(rest.slice(15)) } });
  if (rest.startsWith("/git/trees/")) {
    if (rateLimit) return json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" });
    return json(200, { truncated: false, tree: [{ path: "src", type: "tree" }, ...Object.keys(files).map((p) => ({ path: p, type: "blob" }))] });
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
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route("https://api.github.com/**", github);
  await page.route("https://raw.githubusercontent.com/**", github);
  await page.route("https://evil.test/**", (route) => { requests.push({ url: route.request().url(), auth: null }); route.abort(); });

    let projectCount = 0;
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const tab = (name) => page.locator("button[aria-pressed]").filter({ hasText: new RegExp(`^${name}`) }).click();
  // A repository is connected by making a project for it.
  const connect = async (repo, token = "") => {
    const id = "repo000" + ++projectCount;
    const clean = repo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    await seed(page, id, { repo: clean, token });
    await page.goto("http://localhost:3000/editor/" + id);
    await page.getByText("Layers", { exact: true }).waitFor();
    await nav("Source control");
    await openDetails(page);
  };

  // ── Public repository, no token ────────────────────────────────────────────
  await connect("https://github.com/dponinski/motif-test-system.git");
  check("connects to a public repository without a token", await page.getByRole("link", { name: "dponinski/motif-test-system" }).isVisible());
  check("saving is gated behind a token, scanning is not", (await page.getByRole("button", { name: "Add token" }).isVisible()) && (await page.getByRole("button", { name: /^(Re)?scan$/i }).isVisible()) && true);

  await openDetails(page);
  await page.getByRole("button", { name: /^(Re)?scan$/i }).click();
  await page.getByText("25 tokens · 22 components").waitFor({ timeout: 30000 });
  const panel = page.locator("div.w-\\[300px\\]");
  check("stack summary", (await panel.getByText("React 19.3.1 · TypeScript · Vite").isVisible()) && (await panel.getByText("Tailwind CSS v4 · cva").isVisible()));
  check("editability summary", await panel.getByText("17 editable · 5 partly editable · 0 view only").isVisible());
  check("scan reads files from raw.githubusercontent.com, never with credentials",
    requests.some((r) => r.url.includes("raw.githubusercontent.com") && r.url.endsWith("/src/styles/motif.css")) &&
    requests.every((r) => r.auth === null) && !requests.some((r) => r.url.includes("/contents/")));
  check("tree is requested by commit sha", requests.some((r) => r.url.includes(`/git/trees/${"a".repeat(40)}?recursive=1`)));
  await page.screenshot({ path: `${OUT}/repo-panel.png` });

  // ── Report ─────────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Open report" }).click();
  await page.getByText("Entry files").waitFor();
  const body = page.locator("div.overflow-y-auto").last();
  check("setup tab explains the findings", (await body.getByText("tailwindcss ^4.3.5 in package.json").isVisible()) && (await body.getByText("12 of 12 component files use utility classes").isVisible()) && (await body.getByText("src/index.ts").isVisible()) && (await body.getByText(/Tailwind is the first styling system/).isVisible()));
  await page.screenshot({ path: `${OUT}/repo-setup.png` });

  await tab("Tokens");
  await body.getByText("Defined in").waitFor();
  check("tokens tab shows a swatch per color per theme", (await body.locator("span.h-4.w-4").count()) === 34, await body.locator("span.h-4.w-4").count());
  check("tokens show their Tailwind name", await body.getByText("Tailwind: color-primary", { exact: true }).isVisible());
  await body.getByRole("button", { name: /^Radius/ }).click();
  check("kind filter narrows the table", (await body.locator("span.font-mono.text-text-primary").allInnerTexts()).join() === "radius-sm,radius-md,radius-lg,radius-xl");
  await body.getByRole("button", { name: /^Colors/ }).click();
  await page.screenshot({ path: `${OUT}/repo-tokens.png` });

  await tab("Components");
  await body.getByLabel("Filter components").waitFor();
  check("components tab lists all 22", (await body.locator("button[aria-expanded]").count()) === 22);
  await body.getByLabel("Filter components").fill("tab");
  check("filter by name", (await body.locator("button[aria-expanded]").count()) === 4);
  await body.getByLabel("Filter components").fill("");
  await body.getByLabel("Public only").check();
  check("every component is public", (await body.locator("button[aria-expanded]").count()) === 22);
  await body.getByRole("button", { name: /^Button\b/ }).click();
  check("component details show variants, native props and the root element",
    (await body.getByText("ghost", { exact: true }).isVisible()) && (await body.getByText("ButtonHTMLAttributes<HTMLButtonElement>").isVisible()) && (await body.getByText("<button>").isVisible()));
  await body.getByLabel("Filter components").fill("Field");
  await body.getByRole("button", { name: /^Field\b/ }).click();
  check("doc comments and conditions are shown", (await body.getByText(/A single form control/).isVisible()) && (await body.getByText("Some classes depend on a condition").isVisible()));
  await page.screenshot({ path: `${OUT}/repo-components.png` });
  check("a clean scan has no warnings tab", (await page.locator("button[aria-pressed]").filter({ hasText: /^Warnings/ }).count()) === 0);

  // ── Survives a reload ─────────────────────────────────────────────────────
  await page.goto("http://localhost:3000/editor/repo0001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await nav("Source control");
  await openDetails(page);
  check("the last scan is kept across reloads", await page.getByText("25 tokens · 22 components").isVisible());

  // ── Adding a token ────────────────────────────────────────────────────────
  await page.getByLabel("Access token").fill("wrong");
  await page.getByRole("button", { name: "Add token" }).click();
  await page.getByText("GitHub rejected the token").waitFor();
  await page.getByLabel("Access token").fill("t");
  await page.getByRole("button", { name: "Add token" }).click();
  await page.getByLabel("Access token").waitFor({ state: "detached" });
  check("a bad token is rejected, a good one is accepted", true);
  await openDetails(page);
  check("scan results survive adding a token", await page.getByText("25 tokens · 22 components").isVisible());
  await openDetails(page);
  await page.getByRole("button", { name: /^(Re)?scan$/i }).click();
  await page.waitForTimeout(1500);
  check("scanning with a token reads files through the API", requests.some((r) => r.auth === "Bearer t" && r.url.includes("/git/trees/")));

  // ── Rate limit ────────────────────────────────────────────────────────────
  await connect("dponinski/motif-test-system");
  await page.getByRole("button", { name: /^(Re)?scan$/i }).waitFor();
  rateLimit = true;
  moved = true;
  await openDetails(page);
  await page.getByRole("button", { name: /^(Re)?scan$/i }).click();
  await page.getByText(/rate limit for requests without a token/).waitFor();
  check("hitting GitHub's anonymous rate limit says how to continue", true);
  rateLimit = false;

  // ── Hostile repository ────────────────────────────────────────────────────
  await connect("acme/evil");
  await openDetails(page);
  await page.getByRole("button", { name: /^(Re)?scan$/i }).click();
  await page.getByText(/tokens · \d+ components/).waitFor({ timeout: 30000 });
  await openDetails(page);
  await page.getByRole("button", { name: "Open report" }).click();
  await page.getByText("Entry files").waitFor();
  await tab("Tokens");
  await body.getByText("Defined in").waitFor();
  check("a color value that could fetch a resource gets no swatch", (await body.locator("span.h-4.w-4").count()) === 1, await body.locator("span.h-4.w-4").count());
  await tab("Components");
  await body.getByLabel("Filter components").waitFor();
  for (const b of await body.locator("button[aria-expanded]").all()) await b.click();
  const text = await body.innerText();
  check("repository text is shown as text", text.includes(XSS) && text.includes("<script>window.__xss=2</script>") && text.includes("<b>loud</b>"));
  check("nothing from the repository runs or loads", (await page.evaluate(() => window.__xss)) === undefined && (await body.locator("img, script, b").count()) === 0 && !requests.some((r) => r.url.includes("evil.test")));

  const real = errors.filter((e) => !/hydrat/i.test(e)); check("no page errors besides the existing theme hydration warning", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2000)); process.exit(1); });
