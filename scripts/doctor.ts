// npm run doctor [-- --send-to you@example.com] [-- --json]
//
// Checks the accounts setup of a server against the real database, mail server and sign-in providers, with the environment it
// would run with (the shell's, and .env.local). See src/lib/auth/doctor.ts for what is asked of each, and "Going live" in the README.
import { Pool } from "pg";
import nodemailer from "nodemailer";
import { poolConfig } from "../src/lib/auth/db.ts";
import { failed, runDoctor, type Check } from "../src/lib/auth/doctor.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "") : null; };
const sendTo = flag("--send-to");
if (sendTo === "") { console.error("--send-to needs an address"); process.exit(2); }

const checks = await runDoctor(process.env, {
  fetch,
  smtp: (url) => {
    const transport = nodemailer.createTransport(url);
    // A mail server that doesn't answer would otherwise leave this waiting for minutes.
    const within = <T,>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the mail server didn't answer in 25 seconds")), 25000).unref())]);
    return { verify: () => within(transport.verify()), sendMail: (message) => within(transport.sendMail(message)) };
  },
  db: async (url, env) => {
    const pool = new Pool({ ...poolConfig(url, env), connectionTimeoutMillis: 15000, max: 1 });
    return { query: (sql) => pool.query(sql), end: () => pool.end() };
  },
}, { sendTo: sendTo ?? undefined });

if (args.includes("--json")) {
  console.log(JSON.stringify(checks, null, 2));
} else {
  const mark: Record<Check["status"], string> = { ok: "✓", warn: "!", fail: "✗", skip: "–" };
  for (const c of checks) {
    console.log(`${mark[c.status]} ${c.title}: ${c.detail}`);
    if (c.hint && c.status !== "ok") console.log(`    ${c.hint}`);
  }
  const bad = failed(checks).length;
  const warn = checks.filter((c) => c.status === "warn").length;
  console.log(`\n${checks.filter((c) => c.status === "ok").length} fine, ${warn} to look at, ${bad} wrong, ${checks.filter((c) => c.status === "skip").length} not set up or not checkable here`);
}
process.exit(failed(checks).length ? 1 : 0);
