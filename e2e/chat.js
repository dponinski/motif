const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");
const { gitData } = require("./support/git-data");
const { openSync, syncNow } = require("./support/sync-helpers");

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

const design = loadDir(FIXTURE);
// A component made of plain elements and text, to edit text and structure with.
design["src/components/Banner.tsx"] = [
  'export function Banner() {',
  '  return (',
  '    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border">',
  '      <h2 className="text-lg font-semibold">Hello</h2>',
  '      <p className="text-sm text-muted-foreground">World</p>',
  '      <small className="text-xs">Footnote</small>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
design["src/index.ts"] += '\nexport { Banner } from "./components/Banner";\n';
const repos = { "acme/ds": { main: new Map(Object.entries(design)) } };
const prs = [];

async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "x-ratelimit-remaining" };
  const json = (status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

  const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const branches = m && repos[m[1]];
  if (!branches) return json(404, { message: "Not Found" });
  const token = (req.headers()["authorization"] ?? "").replace("Bearer ", "");
  if (token && token !== "t" && token !== "ro") return json(401, { message: "Bad credentials" });
  const rest = decodeURIComponent(m[2] ?? "");
  const method = req.method();
  

  if (rest === "") return json(200, { default_branch: "main", permissions: { push: Boolean(token) } });
  if (rest === "/branches") return json(200, Object.keys(branches).map((name) => ({ name })));
  const gd = gitData({ rest, method, req, branches, prs, json });
  if (gd) return gd;
  if (rest.startsWith("/git/ref/heads/")) {
    const b = rest.slice(15);
    return branches[b] ? json(200, { object: { sha: `commit:${b}` } }) : json(404, { message: "Not Found" });
  }
  if (rest.startsWith("/git/trees/")) {
    const b = rest.slice(11).split("?")[0].replace("commit:", "");
    return branches[b] ? json(200, { truncated: false, tree: [...branches[b].keys()].map((p) => ({ path: p, type: "blob" })) }) : json(404, { message: "Not Found" });
  }
  if (rest === "/git/refs" && method === "POST") {
    const body = req.postDataJSON();
    const from = body.sha.replace("commit:", "");
    branches[body.ref.replace("refs/heads/", "")] = new Map(branches[from]);
    return json(201, {});
  }
  if (rest.startsWith("/contents/")) {
    const file = rest.slice(10);
    if (method === "PUT") {
      const body = req.postDataJSON();
      const tree = branches[body.branch];
      const current = tree.get(file);
      if ((current === undefined ? undefined : blobSha(current)) !== body.sha) return json(409, { message: `${file} does not match ${body.sha}` });
      tree.set(file, Buffer.from(body.content, "base64").toString("utf8"));
      return json(200, { content: { sha: blobSha(tree.get(file)) }, commit: { html_url: "https://github.com/commit/1" } });
    }
    const text = branches[url.searchParams.get("ref")]?.get(file);
    return text === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: blobSha(text), content: Buffer.from(text).toString("base64"), encoding: "base64" });
  }
  if (rest === "/pulls" && method === "POST") {
    if (token === "ro") return json(403, { message: "Resource not accessible by personal access token" });
    const body = req.postDataJSON();
    const pr = { number: prs.length + 1, repo: m[1], ...body, state: "open", merged: false };
    prs.push(pr);
    return json(201, { number: pr.number, html_url: `https://github.com/${m[1]}/pull/${pr.number}` });
  }
  const pull = rest.match(/^\/pulls\/(\d+)$/);
  if (pull) {
    const pr = prs[Number(pull[1]) - 1];
    return json(200, { number: pr.number, html_url: `https://github.com/${pr.repo}/pull/${pr.number}`, state: pr.state, merged: pr.merged });
  }
  return json(404, { message: "Not Found" });
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", github);
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });

  // The project's own tokens are in the set that is linked to the repository, as they are once it has been pulled and the tokens sent: the
  // link agrees with them, so nothing waits to be sent, and the repository was read already (so it isn't pulled again when opened).
  const link = { repo: "acme/ds", branch: "main", setId: "set-global", themes: { default: "theme-default" }, baseTheme: "default", staged: null, syncedAt: 1,
    base: { brand: { kind: "color", values: { default: "#123456" } }, gutter: { kind: "spacing", values: { default: "24" } } } };
  const analysis = { repo: "acme/ds", ref: "main", scannedAt: 1, stack: { framework: null, supported: true, typescript: true, bundler: null, styling: { primary: null, evidence: [] }, tailwindVersion: null, variantHelper: null, packages: [], entryFiles: [] },
    themes: ["default"], tokens: [], components: [], styleFiles: [], tailwindEntry: null, warnings: [], stats: { filesInRepo: 0, filesRead: 0, truncated: false } };
  await seed(page, "chat0001", { extra: { repo: { connection: { owner: "acme", repo: "ds", token: "t", defaultBranch: "main" }, analysis, tokenLink: link }, tokens: {
    sets: [{ id: "set-global", name: "Global", themes: [{ id: "theme-default", name: "Default" }], activeThemeId: "theme-default" }],
    colors: [{ id: "c1", name: "brand", value: "#123456", group: "base", setId: "set-global", themeValues: { "theme-default": "#123456" } }],
    typography: [], spacing: [{ id: "sp1", name: "gutter", value: 24, setId: "set-global" }], radii: [], shadows: [], components: [],
  } } });
  await page.goto("http://localhost:3000/editor/chat0001");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());

  await componentsReady(page);

  // The pointer is moved off the preview first: a button under it would show its hover color.
  const css = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const editButton = page.getByRole("button", { name: "Design", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });
  const setColor = async (label, value) => { await field(label).click(); const box = page.getByLabel(`${label}: search tokens or type a value`); await box.fill(value); await box.press("Enter"); };

  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const asked = [];
  let reply = null;
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    const out = typeof reply === "function" ? reply(body) : reply;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  const wrap = (text, json) => ({ text: `${text}\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``, structured: json });
  const idOf = (body, tag) => body.context.elements.find((e) => e.tag === tag).id;
  const chatBox = page.getByPlaceholder("Ask me anything…");
  const say = async (text) => { await chatBox.fill(text); await chatBox.press("Enter"); };
  const card = (kind) => page.locator(`[data-proposal="${kind}"]`).last();
  const savedTokens = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0].tokens); };

  // ── Open a component, ask ─────────────────────────────────────────────────
  await rowFor("Banner").click();
  await stage.locator("#root h2").waitFor({ timeout: 60000 });
  await nav("Chat");
  reply = (body) => wrap("I made the heading larger and muted the body text.", {
    action: "edit", summary: "Larger heading, muted body",
    changes: [
      { element: idOf(body, "h2"), group: "text-size", value: "2xl" },
      { element: idOf(body, "h2"), text: "Hello there" },
      { element: idOf(body, "p"), group: "text-color", value: "danger" },
      { element: 99, group: "gap", value: "2" },
      { element: idOf(body, "p"), group: "bg", value: 'primary" onClick="x' },
      { element: idOf(body, "p"), group: "display", value: "banana" },
    ],
  });
  await say("Make the heading larger and the body muted");
  await card("edit").waitFor({ timeout: 15000 });

  const sent = asked[0];
  check("the assistant is told the open component and its elements with their classes", sent.context.component.name === "Banner" && sent.context.elements.map((e) => e.tag).join() === "div,h2,p,small" && sent.context.elements[1].classes === "text-lg font-semibold" && sent.context.elements[1].text === "Hello" && sent.context.elements.every((e) => e.editable), JSON.stringify(sent.context.elements));
  check("and the repository's tokens with what each is worth", sent.context.tokens.color.some((t) => /^primary: #[0-9a-f]{6}$/.test(t)) && sent.context.tokens.radius.join() === "sm: 6px,md: 8px,lg: 12px,xl: 16px", JSON.stringify(sent.context.tokens).slice(0, 300));
  check("nothing about where the code is kept or the access token", !JSON.stringify(sent).includes("github") && !/"token"/.test(JSON.stringify(sent)) && !JSON.stringify(sent).includes('"start"'));
  check("the reply is a card, not a block of JSON", (await page.locator("text=/\"action\"/").count()) === 0 && (await card("edit").isVisible()));
  const rows = await card("edit").locator("[data-change]").allInnerTexts();
  check("each change shows what it changes, from what the component has", rows.length === 3 && rows[0].replace(/\s+/g, " ").includes("<h2> Text size lg → 2xl") && rows[1].replace(/\s+/g, " ").includes("<h2> Text Hello → Hello there") && rows[2].replace(/\s+/g, " ").includes("<p> Text color muted-foreground → danger"), rows.join(" | "));
  const notes = await card("edit").locator("ul.list-disc li").allInnerTexts();
  check("what can't be made is left out, with the reason", notes.length === 3 && /isn't in the component/.test(notes[0]) && /value that can't be used/.test(notes[1]) && /isn't a value of display/.test(notes[2]), notes.join(" | "));
  await page.screenshot({ path: `${OUT}/chat-proposal.png` });

  // ── Apply ─────────────────────────────────────────────────────────────────
  const fontSize = () => stage.locator("#root h2").evaluate((el) => getComputedStyle(el).fontSize);
  const before = { size: await fontSize(), color: await stage.locator("#root p").evaluate((el) => getComputedStyle(el).color) };
  await card("edit").getByRole("button", { name: "Apply 3 changes" }).click();
  check("applying restyles the real component", await settle(async () => (await fontSize()) === "24px"), await fontSize());
  check("and changes its text", await settle(async () => (await stage.locator("#root h2").innerText()) === "Hello there"));
  check("the color is the repository's token", await settle(async () => (await stage.locator("#root p").evaluate((el) => getComputedStyle(el).color)) !== before.color));
  check("it says what was done, and the buttons are gone", (await page.locator("[data-outcome]").last().innerText()).includes("Applied 3 of 3 changes to Banner") && (await page.getByRole("button", { name: /Apply 3 changes/ }).count()) === 0);
  check("the file counts as one changed file", (await page.locator('main button[aria-label="Sync"]').innerText()).includes("Sync (1)"), await page.locator('main button[aria-label="Sync"]').innerText());

  await page.getByLabel("Undo", { exact: true }).click();
  check("one undo takes all of it back", await settle(async () => (await fontSize()) === before.size && (await stage.locator("#root h2").innerText()) === "Hello" && (await stage.locator("#root p").evaluate((el) => getComputedStyle(el).color)) === before.color));

  // ── The component changes before it is applied ────────────────────────────
  reply = (body) => wrap("Larger heading.", { action: "edit", summary: "Larger heading", changes: [{ element: idOf(body, "h2"), group: "text-size", value: "xl" }] });
  await say("Make the heading a bit larger");
  await settle(async () => (await page.locator('[data-proposal="edit"]').count()) === 2);
  check("a new suggestion is shown", (await card("edit").locator("[data-change]").count()) === 1);
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await stage.locator("#root small").click();
  await page.locator("aside").last().getByRole("button", { name: "Delete element" }).click();
  await settle(async () => (await stage.locator("#root small").count()) === 0);
  await card("edit").getByRole("alert").waitFor({ timeout: 10000 });
  check("when the elements are no longer the same it says so and can't be applied", /changed since this was suggested/.test(await card("edit").getByRole("alert").innerText()) && (await card("edit").getByRole("button", { name: /Apply/ }).isDisabled()));
  await card("edit").getByRole("button", { name: "Dismiss" }).click();
  check("it can be dismissed", (await page.locator("[data-outcome]").last().innerText()) === "Dismissed.");

  await say("Make the heading a bit larger");
  await settle(async () => (await page.locator('[data-proposal="edit"]').count()) === 3);
  check("asking again is about the component as it is now", asked[asked.length - 1].context.elements.map((e) => e.tag).join() === "div,h2,p");
  await card("edit").getByRole("button", { name: "Apply 1 change" }).click();
  check("and applies", await settle(async () => (await fontSize()) === "20px"));
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  check("the stage is not in Design mode", (await page.getByRole("button", { name: "Design", exact: true }).getAttribute("aria-pressed")) === "false");
  await page.keyboard.press("Control+z");
  check("Ctrl+Z steps it back too, outside Edit mode as well", await settle(async () => (await fontSize()) === before.size));
  await page.keyboard.press("Control+Shift+z");
  await settle(async () => (await fontSize()) === "20px");

  // ── Tokens ────────────────────────────────────────────────────────────────
  reply = wrap("Here is a success scale.", {
    action: "tokens",
    tokens: {
      colors: [{ name: "Success 600", value: "rgb(22 163 74)", dark: "#22c55e", group: "success" }, { name: "brand", value: "#ff0000" }, { name: "broken", value: "not a color" }],
      spacing: [{ name: "gutter", value: 8 }, { name: "pad", value: 10 }],
      radii: [{ name: "card", value: 12 }],
      typography: [{ name: "body", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20 }],
    },
  });
  await say("Suggest a success color and a card radius");
  await card("tokens").waitFor({ timeout: 15000 });
  const lines = (await card("tokens").locator("[data-token]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("the tokens are listed, and the ones that exist are shown as such", lines.length === 5 && lines[0].includes("Success 600") && lines[1].includes("already a token") && lines[2].includes("already a token") && !lines[3].includes("already") && !lines[4].includes("already"), lines.join(" | "));
  check("what can't be sent to a repository is left out", (await card("tokens").locator("ul.list-disc li").count()) === 1 && /color without a name or a color value/.test(await card("tokens").locator("ul.list-disc li").first().innerText()));
  await card("tokens").getByRole("button", { name: "Add 3 tokens" }).click();
  const outcome = await settle(async () => (await page.locator("[data-outcome]").last().innerText()).includes("Added 3 tokens"));
  check("applying adds them to the token set and points to Sync tokens", outcome && (await page.locator("[data-outcome]").last().innerText()).includes("next Sync") && (await page.locator("[data-outcome]").last().innerText()).includes("2 already existed"));
  const tokens = await savedTokens();
  check("what was there is kept", tokens.colors.some((c) => c.name === "brand" && c.value === "#123456") && tokens.spacing.some((s) => s.name === "gutter" && s.value === 24));
  const added = tokens.colors.find((c) => c.name === "success-600");
  check("the new color is in the set with its dark value, and the others are added", added && added.themeValues["theme-default"] === "#16a34a" && added.value === "#16a34a" && tokens.spacing.some((s) => s.name === "pad" && s.value === 10) && tokens.radii.some((r) => r.name === "card" && r.value === 12), JSON.stringify(added));
  check("existing tokens were not replaced", tokens.colors.length === 2 && tokens.spacing.length === 2 && !tokens.colors.some((c) => c.value === "#ff0000"), JSON.stringify({ colors: tokens.colors.map((c) => c.name), spacing: tokens.spacing.map((c) => c.name), sets: tokens.sets?.map((x) => x.name) }));
  await page.screenshot({ path: `${OUT}/chat-tokens.png` });

  // ── No component open ─────────────────────────────────────────────────────
  await nav("Chat");
  await nav("Components");
  await rowFor("Banner").click();
  await page.waitForTimeout(500);
  check("closing the component returns to the list", await page.getByText("Choose a component").isVisible());
  await nav("Chat");
  reply = (body) => wrap("Heading change.", { action: "edit", summary: "x", changes: [{ element: 1, group: "gap", value: "2" }] });
  await say("Change something");
  await settle(async () => (await page.getByText("Open a component and ask again").count()) === 1);
  check("with nothing open it is told only the tokens, and an edit can't be applied", asked[asked.length - 1].context.component === null && (await page.getByText("Open a component and ask again").count()) === 1 && (await page.getByRole("button", { name: /Apply/ }).count()) === 0);

  // ── A reply that is only words, and an error ──────────────────────────────
  reply = { text: "**Looks fine.**\n- The contrast is good" };
  await say("Is it accessible?");
  await page.getByText("Looks fine.").waitFor();
  check("a review is plain text with nothing to apply", (await page.getByRole("button", { name: /Apply|Add \d/ }).count()) === 0);
  reply = { error: "ANTHROPIC_API_KEY not configured. Add it to .env.local" };
  await say("Again");
  await page.getByText(/ANTHROPIC_API_KEY not configured/).waitFor();
  check("an error from the server is shown as one", true);

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
