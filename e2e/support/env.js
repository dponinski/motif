// What the browser suites need to know about where they run. Everything can be set from the environment, so the same suites
// run on a developer's machine and in CI.
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

// Where the app under test is served for the suites that use the shared server (the runner starts it), and for the suites
// that start a server of their own (these use APP_PORT_OWN, since only one `next dev` can run in a project at a time).
const APP_PORT = Number(process.env.E2E_PORT ?? 3000);
const APP_PORT_OWN = Number(process.env.E2E_PORT_OWN ?? 3100);

// Screenshots the suites take are put here (not kept in git).
const OUT = path.join(ROOT, "e2e", "out");
fs.mkdirSync(OUT, { recursive: true });

// The design system the suites read as the repository's components.
const FIXTURE = path.join(ROOT, "src", "lib", "repo-scan", "fixtures", "motif-test-system");
// The same design system on Tailwind 3 (a tailwind.config.js, and colors kept as HSL channels in CSS variables).
const FIXTURE_V3 = path.join(ROOT, "src", "lib", "repo-scan", "fixtures", "motif-test-system-v3");

// PostgreSQL, for the suites of accounts, sync and teams: a role that can create databases (to make one for the run), and the
// role the app connects as, which owns it.
const DB_ADMIN_URL = process.env.E2E_DB_ADMIN_URL ?? "postgresql://postgres@127.0.0.1:5433";
const DB_APP_URL = process.env.E2E_DB_APP_URL ?? "postgresql://motif:motifpw@127.0.0.1:5433";
const DB_APP_ROLE = new URL(DB_APP_URL).username;
const psql = (db, q) => execFileSync("psql", [`${DB_ADMIN_URL}/${db}`, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

module.exports = { ROOT, APP_PORT, APP_PORT_OWN, APP_URL: `http://localhost:${APP_PORT}`, APP_URL_OWN: `http://localhost:${APP_PORT_OWN}`, OUT, FIXTURE, FIXTURE_V3, DB_ADMIN_URL, DB_APP_URL, DB_APP_ROLE, psql };
