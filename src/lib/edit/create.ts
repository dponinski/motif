import { gitBlobSha, type RepoReader } from "../github";
import type { LibraryComponent } from "../preview/library";
import { rescanComponent } from "../preview/rescan";
import type { RepoAnalysis } from "../repo-scan/types";
import { addDevDependency } from "../frameworks/tailwind";
import { relativeImport } from "../token-sync/flow";
import { NEW_FILE, type Base } from "../../store/edit";

// Making a component from nothing: its file, the stylesheet next to it when it has one, and a line in the repository's
// entry file so it is part of what the design system exports. Nothing is written anywhere: the result is text that goes
// into the editor's changes like any other edit, and leaves as a pull request.

export const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;
const RESERVED = new Set(["React", "Fragment", "Suspense", "StrictMode", "Component", "Object", "Array", "Map", "Set", "Date", "Error", "Promise", "Symbol"]);

// Where the repository keeps its components: the folder most of them are in, or src/components.
export function componentDir(components: { file: string }[]): string {
  const counts = new Map<string, number>();
  for (const c of components) {
    const dir = c.file.includes("/") ? c.file.slice(0, c.file.lastIndexOf("/")) : "";
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best ? best[0] : "src/components";
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

// Why this name can't be used, or null.
export function checkName(name: string, taken: { components: string[]; paths: string[] }, dir: string): string | null {
  if (!name) return "Give the component a name.";
  if (!COMPONENT_NAME.test(name)) return "Start with a capital letter and use letters and numbers only, like Button or PricingCard.";
  if (name.length > 40) return "Keep the name to 40 characters or fewer.";
  if (RESERVED.has(name)) return `${name} is a name React or JavaScript already uses.`;
  const lower = name.toLowerCase();
  if (taken.components.some((c) => c.toLowerCase() === lower)) return `There is already a component called ${name}.`;
  if (taken.paths.some((p) => [`${join(dir, name)}.tsx`, `${join(dir, name)}.css`].some((f) => f.toLowerCase() === p.toLowerCase()))) return `${join(dir, name)} already exists in the repository.`;
  return null;
}

export type StyleEngine = "css" | "tailwind";

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// The component's class when its styles are in a stylesheet.
export const rootClass = (name: string) => kebab(name);

export function componentSource(name: string, engine: StyleEngine): { code: string; css: string | null; rootStart: number } {
  const cls = rootClass(name);
  const root = engine === "css" ? `<div className="${cls}">${name}</div>` : `<div className="p-4">${name}</div>`;
  const head = engine === "css" ? `import "./${name}.css";\n\n` : "";
  const code = `${head}export function ${name}() {\n  return ${root};\n}\n`;
  return { code, css: engine === "css" ? `.${cls} {\n  padding: 16px;\n}\n` : null, rootStart: code.indexOf(root) };
}

// The line that exports the component from the repository's entry file.
export const exportLine = (entry: string, file: string, name: string) => `export { ${name} } from "${relativeImport(entry, file.replace(/\.tsx$/, ""))}";`;

export const REACT_VERSION = "^19.0.0";

// The scanner reads components only from a repository that depends on React, so a repository that doesn't say so
// (a new one) is told, in its package.json: as a peer dependency of the components, and as what runs them here.
export const reactPackageJson = (name: string): string =>
  JSON.stringify({ name, version: "0.0.0", private: true, type: "module", peerDependencies: { react: ">=18", "react-dom": ">=18" }, devDependencies: { react: REACT_VERSION, "react-dom": REACT_VERSION } }, null, 2) + "\n";

export interface NewComponent {
  name: string;
  file: string;
  stylesheet: string | null;
  engine: StyleEngine;
  // Every file that goes into the change, as it will be.
  texts: Record<string, string>;
  // What each was before: nothing for the new ones, the repository's text and sha for the entry file.
  bases: Record<string, Base>;
  // Where the component's root element starts, to select it.
  rootStart: number;
  entry: string;
  // Things the person should know about what was planned.
  notes: string[];
}

export async function planComponent(input: {
  name: string;
  analysis: RepoAnalysis;
  components: { file: string; name: string }[];
  paths: string[];
  reader: RepoReader;
  ref: string;
}): Promise<NewComponent> {
  const { name, analysis, components, paths, reader, ref } = input;
  const dir = componentDir(components);
  const problem = checkName(name, { components: components.map((c) => c.name), paths }, dir);
  if (problem) throw new Error(problem);

  // With Tailwind v4 in the repository the component is made of its classes, as the others are.
  const engine: StyleEngine = analysis.stack.tailwindVersion === 4 ? "tailwind" : "css";
  const file = `${join(dir, name)}.tsx`;
  const { code, css, rootStart } = componentSource(name, engine);
  const stylesheet = css === null ? null : `${join(dir, name)}.css`;

  const entry = analysis.stack.entryFiles[0] ?? (dir.startsWith("src/") || dir === "src" ? "src/index.ts" : "index.ts");
  const line = exportLine(entry, file, name);
  const current = await reader.readText(entry, ref).catch(() => null);
  const barrel = current === null ? `${line}\n` : current.includes(line) ? current : `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${line}\n`;

  const texts: Record<string, string> = { [file]: code, [entry]: barrel };
  const bases: Record<string, Base> = { [file]: NEW_FILE, [entry]: current === null ? NEW_FILE : { text: current, sha: await gitBlobSha(current) } };
  if (stylesheet) { texts[stylesheet] = css!; bases[stylesheet] = NEW_FILE; }

  // React has to be among the dependencies for the repository's components to be read.
  const notes: string[] = [];
  const pkg = await reader.readText("package.json", ref).catch(() => null);
  if (pkg === null) {
    texts["package.json"] = reactPackageJson(analysis.repo.split("/").pop() ?? "design-system");
    bases["package.json"] = NEW_FILE;
  } else if (!/"react"\s*:/.test(pkg)) {
    let next: string | null = addDevDependency(pkg, "react", REACT_VERSION);
    if (next !== null && !/"react-dom"\s*:/.test(next)) next = addDevDependency(next, "react-dom", REACT_VERSION);
    if (next === null) notes.push("package.json isn't in a shape Motif can add to, so add react to its dependencies yourself: components are only read from a repository that depends on React.");
    else { texts["package.json"] = next; bases["package.json"] = { text: pkg, sha: await gitBlobSha(pkg) }; }
  }
  return { name, file, stylesheet, engine, texts, bases, rootStart, entry, notes };
}

// The library's entry for the new component, read from the text that was generated for it. It is public by construction
// (the entry file exports it).
export async function libraryEntry(plan: NewComponent, input: { reader: RepoReader; ref: string; paths: string[] }): Promise<LibraryComponent> {
  const seed: LibraryComponent = {
    id: `${plan.file}::${plan.name}`, name: plan.name, file: plan.file, line: 1, exported: "named", public: true, root: "div",
    props: [], nativeProps: null, variants: [], hooks: [], notes: [], support: { level: "editable", reasons: [] },
  };
  const read = await rescanComponent({ ...input, overlay: plan.texts, component: seed }).catch(() => null);
  return read ?? seed;
}
