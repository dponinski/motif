import { THEME_NAMESPACES } from "./names";

// What a repository needs to build its stylesheet from the design tokens files itself: a Style Dictionary config, and the script and
// dependency in package.json. The config does the same as `generateCss` (lib/dtcg/generate.ts) with the same rules.

export const CONFIG_FILE = "style-dictionary.config.mjs";
export const SCRIPT = "tokens:build";
export const VERSION = "^5.8.0";

export function styleDictionaryConfig(dir: string): string {
  return `// Builds the stylesheet from the design tokens files in ${dir} with Style Dictionary (\`npm run ${SCRIPT}\`; Node 22 or newer).
// Motif writes the same stylesheet when it syncs the tokens, so the repository works without running this; running it gives the same file.
// ${dir}/tokens.config.json says how the files are laid out, where the stylesheet goes, and the selector of each theme.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import StyleDictionary from "style-dictionary";

const DIR = ${JSON.stringify(dir)};
const config = JSON.parse(readFileSync(\`\${DIR}/tokens.config.json\`, "utf8"));
const HEADER = ${JSON.stringify("/**\n * Generated from the design tokens files by `npm run tokens:build`. Do not edit directly.\n */\n")};
const THEME_NAMESPACES = new Set(${JSON.stringify([...THEME_NAMESPACES])});
const SUFFIX = { lineHeight: "line-height", letterSpacing: "letter-spacing", fontWeight: "font-weight", fontFamily: "font-family" };

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const round = (n) => String(parseFloat(n.toFixed(4)));
const byte = (n) => Math.round(Math.min(255, Math.max(0, n * 255))).toString(16).padStart(2, "0");
const num = (c) => (c === "none" ? "none" : round(c));
const alphaText = (a) => (a !== undefined && a < 1 ? \` / \${parseFloat(a.toFixed(3))}\` : "");

function color(v) {
  const [a, b, d] = v.components;
  switch (v.colorSpace) {
    case "srgb": {
      const hex = typeof v.hex === "string" && /^#[0-9a-f]{6}$/i.test(v.hex) ? v.hex.toLowerCase() : \`#\${byte(a === "none" ? 0 : a)}\${byte(b === "none" ? 0 : b)}\${byte(d === "none" ? 0 : d)}\`;
      return v.alpha !== undefined && v.alpha < 1 ? \`\${hex}\${byte(v.alpha)}\` : hex;
    }
    case "hsl": return \`hsl(\${num(a)} \${num(b)}% \${num(d)}%\${alphaText(v.alpha)})\`;
    case "oklch": return \`oklch(\${num(a)} \${num(b)} \${num(d)}\${alphaText(v.alpha)})\`;
    case "display-p3": return \`color(display-p3 \${num(a)} \${num(b)} \${num(d)}\${alphaText(v.alpha)})\`;
    default: return "";
  }
}

const refText = (v) => v.replace(/^\\{([^{}]+)\\}$/, (_, p) => \`var(--\${p.split(".").join("-")})\`);

function valueText(v) {
  if (typeof v === "string") return refText(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  if (isObject(v)) {
    if (typeof v.colorSpace === "string" && Array.isArray(v.components)) return color(v);
    if ("value" in v && "unit" in v) return \`\${v.value}\${v.unit}\`;
  }
  return String(v);
}

function variables(token) {
  const name = \`--\${token.path.join("-")}\`;
  const value = token.original.$value;
  const type = token.$type ?? token.original.$type;
  if (type === "typography" && isObject(value)) {
    const out = [];
    if ("fontSize" in value) out.push([name, valueText(value.fontSize)]);
    for (const [prop, suffix] of Object.entries(SUFFIX)) if (prop in value) out.push([\`\${name}--\${suffix}\`, valueText(value[prop])]);
    return out;
  }
  if (type === "shadow" && isObject(value)) {
    const raw = token.original.$extensions?.["com.motif"]?.raw;
    if (typeof raw === "string") return [[name, raw]];
    const part = (key) => (key in value ? valueText(value[key]) : "0");
    const parts = [value.inset === true ? "inset" : null, part("offsetX"), part("offsetY"), part("blur"), part("spread"), "color" in value ? valueText(value.color) : null];
    return [[name, parts.filter((p) => p !== null).join(" ")]];
  }
  return [[name, valueText(value)]];
}

const block = (selector, lines) => \`\${selector} {\\n\${lines.map(([n, v]) => \`  \${n}: \${v};\`).join("\\n")}\\n}\`;

// Not the formats Style Dictionary comes with: these write the variables the way the design system names them.
StyleDictionary.registerFormat({
  name: "motif/base",
  format: ({ dictionary }) => {
    const inTheme = [];
    const inRoot = [];
    for (const token of dictionary.allTokens) {
      for (const v of variables(token)) (config.tailwind && token.path.length > 1 && THEME_NAMESPACES.has(token.path[0]) ? inTheme : inRoot).push(v);
    }
    const blocks = [];
    if (config.tailwind) {
      if (inTheme.length) blocks.push(block("@theme", inTheme));
      if (inRoot.length) blocks.push(block(":root", inRoot));
    } else if (inTheme.length || inRoot.length) {
      blocks.push(block(":root", [...inTheme, ...inRoot]));
    }
    return blocks.join("\\n\\n");
  },
});
StyleDictionary.registerFormat({
  name: "motif/theme",
  format: ({ dictionary, options }) => {
    const lines = dictionary.allTokens.flatMap(variables);
    return lines.length ? block(options.selector, lines) : "";
  },
});

const files = (theme) => {
  const suffix = theme ? \`.\${theme}\` : "";
  const all = config.files === "single" ? [\`\${DIR}/tokens\${suffix}.json\`] : config.sets.map((s) => \`\${DIR}/\${s.key}\${suffix}.json\`);
  return all.filter((f) => existsSync(f));
};

const run = async (settings, format, options = {}, filter) => {
  const sd = new StyleDictionary({ usesDtcg: true, log: { verbosity: "silent" }, ...settings, platforms: { css: { transforms: [], files: [{ destination: "tokens.css", format, options, ...(filter ? { filter } : {}) }] } } });
  const [out] = await sd.formatPlatform("css");
  return out.output;
};

const base = files(null);
const blocks = [await run({ source: base }, "motif/base")];
for (const [key, selector] of Object.entries(config.selectors ?? {})) {
  const theme = files(key);
  if (theme.length) blocks.push(await run({ include: base, source: theme }, "motif/theme", { selector }, (token) => token.isSource));
}

const text = blocks.filter(Boolean).join("\\n\\n");
mkdirSync(dirname(config.output), { recursive: true });
writeFileSync(config.output, \`\${HEADER}\${text ? \`\\n\${text}\\n\` : ""}\`);
console.log(\`\${config.output} is up to date\`);
`;
}

// package.json with the dependency and the script added (what is there is left alone); null when it can't be read.
export function patchPackageJson(text: string): string | null {
  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(text); } catch { return null; }
  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) return null;
  const indent = /^\{\n( +)"/.exec(text)?.[1].length ?? 2;
  const scripts = (typeof pkg.scripts === "object" && pkg.scripts !== null ? pkg.scripts : {}) as Record<string, string>;
  const dev = (typeof pkg.devDependencies === "object" && pkg.devDependencies !== null ? pkg.devDependencies : {}) as Record<string, string>;
  if (scripts[SCRIPT] && "style-dictionary" in dev) return text;
  const next = {
    ...pkg,
    scripts: { ...scripts, [SCRIPT]: scripts[SCRIPT] ?? `node ${CONFIG_FILE}` },
    devDependencies: Object.fromEntries(Object.entries({ ...dev, "style-dictionary": dev["style-dictionary"] ?? VERSION }).sort(([a], [b]) => a.localeCompare(b))),
  };
  return `${JSON.stringify(next, null, indent)}${text.endsWith("\n") ? "\n" : ""}`;
}

export const scaffoldFiles = (dir: string): Record<string, string> => ({ [CONFIG_FILE]: styleDictionaryConfig(dir) });
