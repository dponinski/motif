#!/usr/bin/env node
// Runs the browser suites.
//
//   node e2e/run.js            the suites that need no database (npm run e2e)
//   node e2e/run.js db         accounts, sync and teams, which need PostgreSQL (npm run e2e:db)
//   node e2e/run.js all        both
//   node e2e/run.js edit tokens   named suites
//
// Most suites use one server, started here (`next dev`, or `next start` with E2E_PROD=1 after `npm run build`). A few start a
// server of their own, and only one `next dev` can run in a project at a time, so the shared one is stopped before them.
// Set E2E_REUSE=1 to use a server that is already running on the port instead of starting one.
const { spawn } = require("child_process");
const path = require("path");
const { ROOT, APP_PORT, APP_URL } = require("./support/env");

// Use the shared server.
const SHARED = ["build", "canvas", "chat", "direct", "insert", "docs-repo", "docs", "edit", "empty", "import", "migrate", "persist", "preview", "projects", "props", "repo", "stage", "states", "structure", "sync-flow", "sync-mixed", "tokenpick", "tokens", "variants", "compare", "tour", "tokens-screen", "tokens-add", "tokens-alias", "tokens-quickadd", "tokens-usage", "tokens-rename", "tailwind3-tokens", "tailwind3-preview", "tailwind3-docs", "headers", "tokens-themes", "tokens-usable", "pull", "layout", "source-control", "tokens-compare"];
// Start a server of their own, with no database.
const OWN = ["signin"];
// Start a server of their own, and need PostgreSQL.
const DB = ["auth", "sync", "teams", "teams-merge"];

const GROUPS = { default: [...SHARED, ...OWN], db: DB, all: [...SHARED, ...OWN, ...DB] };
const SUITE_TIMEOUT_MS = Number(process.env.E2E_SUITE_TIMEOUT ?? 300_000);

const wanted = process.argv.slice(2);
const names = wanted.length === 0 ? GROUPS.default : wanted.flatMap((w) => GROUPS[w] ?? [w]);
const unknown = names.filter((n) => !GROUPS.all.includes(n));
if (unknown.length) {
  console.error(`Unknown suite: ${unknown.join(", ")}. Suites: ${GROUPS.all.join(", ")}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => fetch(APP_URL, { signal: AbortSignal.timeout(2000) }).then((r) => r.status < 500, () => false);

let server = null;
async function startServer() {
  // The preview's Tailwind 3 engine is a file made from the project's dependencies (npm run dev and build make it too).
  require("child_process").execFileSync("node", ["scripts/build-tailwind3.mjs"], { cwd: ROOT, stdio: "inherit" });
  if (await up()) {
    if (process.env.E2E_REUSE) return;
    throw new Error(`Something is already serving ${APP_URL}. Stop it, or set E2E_REUSE=1 to use it.`);
  }
  const args = process.env.E2E_PROD ? ["next", "start", "-p", String(APP_PORT)] : ["next", "dev", "-p", String(APP_PORT)];
  server = spawn("npx", args, { cwd: ROOT, stdio: "ignore", detached: true });
  for (let i = 0; i < 600; i++) {
    if (await up()) return;
    await sleep(500);
  }
  throw new Error("The app did not start");
}
function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  server = null;
}
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

function runSuite(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("node", [path.join(__dirname, `${name}.js`)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => { out += "\nTIMEOUT: the suite did not finish\n"; try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }, SUITE_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ name, ok: code === 0 && !/TIMEOUT:/.test(out), out, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

(async () => {
  const results = [];
  const report = (r) => {
    const summary = r.out.split("\n").filter((l) => /passed|checks passed/.test(l)).pop() ?? "";
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(12)} ${String(r.seconds).padStart(4)}s  ${summary.trim()}`);
    if (!r.ok) console.log(r.out.split("\n").filter((l) => /^FAIL|Error|TIMEOUT/.test(l)).slice(0, 12).map((l) => `       ${l.slice(0, 600)}`).join("\n") || r.out.slice(-1200));
    // On CI the whole output of a failing suite is in the log: what passed before it failed says where it went wrong.
    if (!r.ok && process.env.CI) console.log(`::group::${r.name} output\n${r.out}\n::endgroup::`);
  };

  const shared = names.filter((n) => SHARED.includes(n));
  const own = names.filter((n) => !SHARED.includes(n));
  if (shared.length) {
    await startServer();
    try { for (const n of shared) { const r = await runSuite(n); results.push(r); report(r); } } finally { stopServer(); }
    await sleep(1500);
  }
  for (const n of own) { const r = await runSuite(n); results.push(r); report(r); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} suites passed${failed.length ? `; failed: ${failed.map((r) => r.name).join(", ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error(String(err.message ?? err)); stopServer(); process.exit(1); });
