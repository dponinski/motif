import type { GitHost } from "../github";
import { generateTokensCss } from "../token-sync/write";
import { relativeImport, type RepoState } from "../token-sync/flow";
import type { FileWrite } from "../token-sync/pr";

// Adding Tailwind CSS (v4) to a repository, the way adding a dependency would: the package, and a stylesheet that
// starts it. The result is a pull request. What this does not do is set up the bundler of an application (the
// repository may not have one): it adds what Tailwind needs to be there, and Motif's editing takes over once it is.

export const TAILWIND_VERSION = "^4.0.0";
const MOTIF_HEADER = "/* Design tokens, kept in sync with Motif. */";

export interface FrameworkPlan {
  files: Record<string, FileWrite>;
  // One line per file, for the person to read before anything is sent.
  summary: { path: string; what: string }[];
  notes: string[];
}

// Why Tailwind can't be added, in words for the person.
export class FrameworkRefusal extends Error {}

export function newPackageJson(name: string): string {
  return JSON.stringify({ name, version: "0.0.0", private: true, type: "module", devDependencies: { tailwindcss: TAILWIND_VERSION } }, null, 2) + "\n";
}

const indentOf = (text: string) => text.match(/^([ \t]+)"/m)?.[1] ?? "  ";

// Adds a dev dependency to a package.json by editing its text, so nothing else in the file changes (key order,
// formatting, arrays). Null when the file isn't one it can place the entry in.
export function addDevDependency(text: string, name: string, version: string): string | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const unit = indentOf(text);
  const entry = `${JSON.stringify(name)}: ${JSON.stringify(version)}`;

  const dev = json.devDependencies;
  if (dev !== undefined && (typeof dev !== "object" || dev === null || Array.isArray(dev))) return null;

  if (dev) {
    const open = text.search(/"devDependencies"\s*:\s*\{/);
    if (open === -1) return null;
    const braceAt = text.indexOf("{", open);
    // The matching brace: dependency names and versions hold no braces.
    let depth = 0, close = -1;
    for (let i = braceAt; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) { close = i; break; }
    }
    if (close === -1) return null;
    const inner = text.slice(braceAt + 1, close);
    const lineStart = text.lastIndexOf("\n", close);
    const closeIndent = text.slice(lineStart + 1, close).match(/^[ \t]*/)?.[0] ?? "";
    if (inner.trim() === "") return `${text.slice(0, braceAt + 1)}\n${closeIndent}${unit}${entry}\n${closeIndent}${text.slice(close)}`;
    const trimmed = inner.replace(/\s+$/, "");
    const itemIndent = inner.match(/\n([ \t]+)"/)?.[1] ?? closeIndent + unit;
    return `${text.slice(0, braceAt + 1)}${trimmed},\n${itemIndent}${entry}\n${closeIndent}${text.slice(close)}`;
  }

  // No devDependencies: a new block at the end of the file.
  const end = text.lastIndexOf("}");
  const before = text.slice(0, end).replace(/\s+$/, "");
  const comma = before.endsWith("{") ? "" : ",";
  return `${before}${comma}\n${unit}"devDependencies": {\n${unit}${unit}${entry}\n${unit}}\n${text.slice(end)}`;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

// What adding Tailwind to this repository changes, or why it can't be done.
export async function planTailwind(host: Pick<GitHost, "getFile">, repo: RepoState, branch: string, repoName: string): Promise<FrameworkPlan> {
  const { analysis, snapshot } = repo;
  if (analysis.stack.tailwindVersion === 4) throw new FrameworkRefusal("Tailwind CSS v4 is already set up in this repository.");
  if (analysis.stack.tailwindVersion === 3) throw new FrameworkRefusal("This repository uses Tailwind CSS v3. Motif adds v4 only, and doesn't change versions.");

  const files: Record<string, FileWrite> = {};
  const summary: FrameworkPlan["summary"] = [];
  const notes: string[] = [];

  // The dependency.
  const pkg = await host.getFile("package.json", branch);
  if (pkg) {
    if (/"tailwindcss"\s*:/.test(pkg.text)) throw new FrameworkRefusal("package.json already lists tailwindcss.");
    const next = addDevDependency(pkg.text, "tailwindcss", TAILWIND_VERSION);
    if (next === null) throw new FrameworkRefusal("package.json isn't in a shape Motif can add to safely. Add tailwindcss to it yourself and rescan.");
    files["package.json"] = { text: next, sha: pkg.sha };
    summary.push({ path: "package.json", what: `adds tailwindcss ${TAILWIND_VERSION} to devDependencies` });
  } else {
    files["package.json"] = { text: newPackageJson(repoName), sha: null };
    summary.push({ path: "package.json", what: "new, with tailwindcss as a dev dependency" });
  }

  // Motif's own tokens file, when there is one, switched to the form Tailwind reads.
  const tokensPath = analysis.styleFiles.find((f) => /(^|\/)(motif-)?tokens\.css$/.test(f)) ?? null;
  let tokensImport: string | null = null;
  if (tokensPath) {
    const current = await host.getFile(tokensPath, branch);
    if (current?.text.startsWith(MOTIF_HEADER)) {
      const text = generateTokensCss(snapshot.doc, { tailwind: true, baseTheme: snapshot.baseTheme });
      if (text !== current.text) {
        files[tokensPath] = { text, sha: current.sha };
        summary.push({ path: tokensPath, what: "the tokens, now also given to Tailwind as theme values (@theme)" });
      }
      tokensImport = tokensPath;
    } else if (current) {
      notes.push(`${tokensPath} isn't a file Motif made, so it was left as it is. Map its variables into Tailwind's @theme to use them as utilities.`);
    }
  }

  // The stylesheet that starts Tailwind, next to the other styles.
  const dir = tokensPath ? dirOf(tokensPath) : analysis.styleFiles[0] !== undefined ? dirOf(analysis.styleFiles[0]) : "src/styles";
  const entry = join(dir, analysis.styleFiles.includes(join(dir, "tailwind.css")) ? "motif-tailwind.css" : "tailwind.css");
  const lines = [`@import "tailwindcss";`];
  if (tokensImport) lines.push(`@import "${relativeImport(entry, tokensImport)}";`);
  files[entry] = { text: lines.join("\n") + "\n", sha: null };
  summary.push({ path: entry, what: tokensImport ? "new: starts Tailwind and imports the tokens" : "new: starts Tailwind" });

  notes.push(`Import ${entry} once in your application, and make sure its bundler runs Tailwind (for example with @tailwindcss/vite). Motif doesn't set up the bundler.`);
  return { files, summary, notes };
}

export const tailwindPrBody = (plan: FrameworkPlan): string =>
  [
    "Adds Tailwind CSS v4 to this repository, from Motif.",
    "",
    "### Changes",
    "",
    ...plan.summary.map((s) => `- \`${s.path}\`: ${s.what}`),
    ...(plan.notes.length ? ["", "### To do", "", ...plan.notes.map((n) => `- ${n}`)] : []),
    "",
    "---",
    "Opened from Motif.",
  ].join("\n");

export const tailwindBranchName = (now = Date.now()) => `motif/tailwind-${now.toString(36)}`;
