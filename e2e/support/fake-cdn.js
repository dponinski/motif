// A local stand-in for esm.sh and jsDelivr: bundles npm packages to browser ES modules on demand.
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

// Its packages are in e2e/cdn (installed with `npm run e2e:setup`).
const CDN_DIR = path.join(__dirname, "..", "cdn");
const esbuild = require(path.join(CDN_DIR, "node_modules/esbuild"));
const requireFromCdn = createRequire(path.join(CDN_DIR, "package.json"));

const cache = new Map();
const CJS = new Set(["react", "react-dom", "react/jsx-runtime", "react-dom/client", "scheduler"]);
const EXTERNAL = ["react", "react-dom"];

function names(spec) {
  const m = requireFromCdn(spec);
  return Object.keys(m).filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k));
}

// CJS packages are wrapped so every named export is a real ES export.
function entryFor(spec) {
  if (!CJS.has(spec)) return `import * as ns from ${JSON.stringify(spec)}; export * from ${JSON.stringify(spec)}; export default ns.default;`;
  const list = names(spec);
  return `import * as ns from ${JSON.stringify(spec)};\nconst m = ns.default && ns.default.__esModule ? ns.default : (ns.default || ns);\nexport default m;\nexport const { ${list.join(", ")} } = m;`;
}

async function bundle(spec) {
  if (cache.has(spec)) return cache.get(spec);
  const externalPlugin = {
    name: "external-react",
    setup(build) {
      // Inside a CommonJS package, require("react") must become an import that the page's import map resolves.
      build.onResolve({ filter: /^(react|react-dom)$/ }, (args) => {
        // The shim's own import must stay a bare import, so the page's import map decides which React it gets.
        if (args.namespace === "ext-shim") return { path: args.path, external: true };
        if (args.importer === "<stdin>") return undefined;
        if (spec === args.path) return undefined;
        return { path: args.path, namespace: "ext-shim" };
      });
      build.onLoad({ filter: /.*/, namespace: "ext-shim" }, (args) => ({
        contents: `import * as ns from ${JSON.stringify(args.path)};\nmodule.exports = ns.default && ns.default.__esModule ? ns.default : Object.assign({}, ns.default || {}, ns);`,
        loader: "js",
        resolveDir: CDN_DIR,
      }));
    },
  };
  const result = await esbuild.build({
    stdin: { contents: entryFor(spec), resolveDir: CDN_DIR, loader: "js" },
    bundle: true, format: "esm", write: false, platform: "browser", minify: false,
    external: [],
    plugins: [externalPlugin], logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const text = result.outputFiles[0].text;
  cache.set(spec, text);
  return text;
}

// -> { status, type, body } or null when the URL is not one this CDN knows.
async function serve(url) {
  const u = new URL(url);
  if (u.host === "cdn.jsdelivr.net" && u.pathname.startsWith("/npm/@tailwindcss/browser")) {
    return { status: 200, type: "application/javascript", body: fs.readFileSync(path.join(CDN_DIR, "node_modules/@tailwindcss/browser/dist/index.global.js"), "utf8") };
  }
  if (u.host !== "esm.sh") return null;
  // /@scope/name@ver/sub or /name@ver/sub
  const m = u.pathname.match(/^\/((?:@[^/]+\/)?[^@/]+)@[^/]*(\/.*)?$/);
  if (!m) return { status: 404, type: "text/plain", body: "not found" };
  const spec = m[1] + (m[2] ?? "");
  try {
    return { status: 200, type: "application/javascript", body: await bundle(spec) };
  } catch (error) {
    return { status: 500, type: "text/plain", body: String(error.message || error).slice(0, 500) };
  }
}

module.exports = { serve };
