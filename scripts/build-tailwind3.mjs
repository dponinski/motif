// Bundles the Tailwind 3 engine for the preview's sandbox into public/motif-tailwind3.js. The engine is written for Node: it reads its
// base stylesheet from beside its code, loads configs with jiti and asks the system for a few facts. A page has none of that, so the
// base stylesheet goes into the bundle, the config comes from the page (already evaluated), and Node's modules are small stand-ins.
// Run by `npm run dev` and `npm run build` (and by the browser suites), so the file is never out of date.
import { build } from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const outfile = join(root, "public", "motif-tailwind3.js");
mkdirSync(dirname(outfile), { recursive: true });

const STUBS = {
  os: `module.exports = { platform: () => "linux", EOL: "\\n", homedir: () => "/", tmpdir: () => "/tmp", cpus: () => [], type: () => "Linux", arch: () => "x64", release: () => "", hostname: () => "browser" };`,
  process: `module.exports = globalThis.process;`,
  url: `module.exports = { URL: globalThis.URL, fileURLToPath: (u) => String(u).replace(/^file:\\/\\//, ""), pathToFileURL: (p) => new URL("file://" + p), parse: (u) => new URL(u), format: (u) => String(u) };`,
};
const BUILTINS = ["fs", "url", "os", "module", "crypto", "util", "stream", "events", "assert", "child_process", "tty", "worker_threads", "perf_hooks", "v8", "vm", "zlib", "http", "https", "net", "readline", "constants", "process", "buffer", "string_decoder", "querystring", "timers", "console", "inspector", "async_hooks", "dns", "dgram", "cluster", "repl", "tls", "http2", "punycode", "diagnostics_channel"];

const plugins = [
  {
    // The base stylesheet ("preflight") is read from a file next to the engine's code.
    name: "inline-preflight",
    setup(b) {
      b.onLoad({ filter: /tailwindcss[\\/]lib[\\/]corePlugins\.js$/ }, (args) => {
        const css = readFileSync(join(dirname(require.resolve("tailwindcss/package.json")), "lib", "css", "preflight.css"), "utf8");
        const code = readFileSync(args.path, "utf8").replace('_fs.default.readFileSync(_path.join(__dirname, "./css/preflight.css"), "utf8")', JSON.stringify(css));
        if (code.includes("preflight.css")) throw new Error("The Tailwind engine reads its base stylesheet in a way this build doesn't know (its version changed?)");
        return { contents: code, loader: "js" };
      });
    },
  },
  {
    name: "node-stand-ins",
    setup(b) {
      b.onResolve({ filter: /^(node:)?path$/ }, () => ({ path: require.resolve("path-browserify") }));
      b.onResolve({ filter: /^jiti(\/.*)?$/ }, (args) => ({ path: args.path, namespace: "stub" }));
      b.onResolve({ filter: new RegExp(`^(node:)?(${BUILTINS.join("|")})$`) }, (args) => ({ path: args.path.replace(/^node:/, ""), namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path] ?? "module.exports = {};", loader: "js" }));
    },
  },
];

await build({
  entryPoints: [join(root, "scripts", "tailwind3-entry.js")],
  outfile,
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  legalComments: "none",
  plugins,
  nodePaths: [join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"production"', "process.env.OXIDE": "undefined", "process.env.JEST_WORKER_ID": "undefined", "process.env.DEBUG": "undefined" },
  banner: { js: 'globalThis.process = globalThis.process || { env: {}, cwd: () => "/", platform: "linux", version: "v18.0.0", versions: { node: "18.0.0" }, argv: [], nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)), emitWarning() {}, stdout: {}, stderr: {}, hrtime: () => [0, 0] };' },
  logLevel: "warning",
});
