import { TAILWIND_ROLES } from "../edit/tokens";
import type { TokenRole } from "../edit/classes";
import { eachClassWord } from "../repo-scan/usage";
import type { RepoToken } from "../repo-scan/types";

// Renaming a token the repository names, everywhere it is named: its declarations (every theme, every file), the Tailwind mapping that
// gives it a class, every `var()` of it and every class that names it. Pure: texts in, texts out. What the repository has to say is
// read by `rename-scan.ts`; what is done with the result (staging it as changes to the pull request) is the Tokens screen's.

export interface RenamePlan {
  // Only the files that change, with their new text.
  files: Record<string, string>;
  // How many places each file has the token in.
  places: { path: string; n: number }[];
  total: number;
  // Files that could not be read as what they are (a stylesheet that doesn't parse), left alone.
  unreadable: string[];
}

export interface Naming {
  // What a class calls it (`primary` in `bg-primary`), the kind of utility, and what comes before it in the token's Tailwind name.
  role: TokenRole;
  value: string;
  // `color-` in `color-primary`.
  prefix: string;
}

// How the token is named by classes, or null when no class names it (a stylesheet's token, or one Tailwind isn't given).
export function namingOf(token: RepoToken): Naming | null {
  if (!token.tailwind) return null;
  for (const [re, role] of TAILWIND_ROLES) {
    const m = re.exec(token.tailwind);
    if (m) return { role, value: m[1], prefix: token.tailwind.slice(0, token.tailwind.length - m[1].length) };
  }
  return null;
}

const RENAMABLE = new Set<RepoToken["kind"]>(["color", "radius", "spacing", "shadow"]);
const IDENT = /^[a-z][a-z0-9_-]*$/i;

export interface Names {
  // The variable, without dashes: `primary`, `color-brand`.
  from: string;
  to: string;
  // What Tailwind calls it, before and after, when it does (`color-primary`, `color-brand`).
  tailwindFrom: string | null;
  tailwindTo: string | null;
  // The class value, before and after: `primary`, `brand`.
  classFrom: string | null;
  classTo: string | null;
  role: TokenRole | null;
  // The mapping `--color-primary: var(--primary)` exists, as a variable of its own (the token is not itself Tailwind's).
  mapped: boolean;
}

// Whether `to` can be the token's name, and if so what that changes. A string is the reason it can't.
export function namesFor(token: RepoToken, to: string, tokens: RepoToken[]): Names | string {
  const name = to.trim();
  if (!RENAMABLE.has(token.kind)) return "Only colors, radii, spacing and shadows can be renamed";
  if (Object.values(token.locations).some((l) => l.container === "config" || l.container === "json")) return "It is defined in a Tailwind config or a token JSON file, which Motif can't change yet";
  if (!IDENT.test(name)) return "A name is letters, digits, dashes and underscores, starting with a letter";
  if (name === token.name) return "That is its name already";
  if (tokens.some((t) => t.name === name)) return "A token already has that name";
  const naming = namingOf(token);
  if (!naming) return { from: token.name, to: name, tailwindFrom: null, tailwindTo: null, classFrom: null, classTo: null, role: null, mapped: false };
  // The token is Tailwind's as it is written (`--color-primary` in @theme): the name keeps what makes it a color, a radius…
  if (token.tailwind === token.name) {
    if (!name.startsWith(naming.prefix) || name.length === naming.prefix.length) return `The name has to start with ${naming.prefix}, which is what gives Tailwind a class for it`;
    return { from: token.name, to: name, tailwindFrom: token.tailwind, tailwindTo: name, classFrom: naming.value, classTo: name.slice(naming.prefix.length), role: naming.role, mapped: false };
  }
  // A variable that Tailwind is given under another name (`--primary` as `--color-primary`).
  if (naming.value !== token.name) return "Its classes are named in a way that doesn't follow its name, so it can't be renamed safely";
  if (tokens.some((t) => t.tailwind === `${naming.prefix}${name}`)) return "A token already has a class by that name";
  return { from: token.name, to: name, tailwindFrom: token.tailwind, tailwindTo: `${naming.prefix}${name}`, classFrom: naming.value, classTo: name, role: naming.role, mapped: true };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `--name` as a whole name: not the start of `--name-foreground`, not the end of `---name`.
const varPattern = (name: string) => new RegExp(`(?<![\\w-])--${escape(name)}(?![\\w-])`, "g");

interface Context {
  names: Names;
  byValue: Map<TokenRole, Map<string, string>>;
  vars: [RegExp, string][];
}

function context(names: Names): Context {
  const byValue = new Map<TokenRole, Map<string, string>>();
  if (names.role && names.classFrom) byValue.set(names.role, new Map([[names.classFrom, names.from]]));
  const vars: [RegExp, string][] = [[varPattern(names.from), `--${names.to}`]];
  // The variable Tailwind's own name for it stands on (`var(--color-primary)`), when it has one that isn't the token itself.
  if (names.mapped && names.tailwindFrom && names.tailwindTo) vars.push([varPattern(names.tailwindFrom), `--${names.tailwindTo}`]);
  return { names, byValue, vars };
}

// The class names in a text with the token's name in them changed (`hover:bg-primary/90` → `hover:bg-brand/90`).
function renameClasses(text: string, ctx: Context): { text: string; n: number } {
  if (!ctx.names.classFrom || !ctx.names.classTo) return { text, n: 0 };
  const edits: { at: number; length: number }[] = [];
  eachClassWord(text, ctx.byValue, (hit, start) => edits.push({ at: start + hit.offset, length: hit.length }));
  let out = text;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + ctx.names.classTo + out.slice(e.at + e.length);
  return { text: out, n: edits.length };
}

function renameVars(text: string, ctx: Context): { text: string; n: number } {
  let n = 0;
  let out = text;
  for (const [pattern, replacement] of ctx.vars) out = out.replace(pattern, () => { n++; return replacement; });
  return { text: out, n };
}

async function inStylesheet(text: string, ctx: Context): Promise<{ text: string; n: number }> {
  const postcss = (await import("postcss")).default;
  const root = postcss.parse(text);
  const { names } = ctx;
  let n = 0;
  root.walkDecls((d) => {
    let changed = false;
    if (d.prop === `--${names.from}`) { d.prop = `--${names.to}`; changed = true; }
    else if (names.mapped && names.tailwindFrom && d.prop === `--${names.tailwindFrom}` && names.tailwindTo) { d.prop = `--${names.tailwindTo}`; changed = true; }
    const value = renameVars(d.value, ctx);
    if (value.n > 0) { d.value = value.text; changed = true; }
    if (changed) n++;
  });
  root.walkAtRules("apply", (rule) => {
    const params = renameClasses(rule.params, ctx);
    if (params.n > 0) { rule.params = params.text; n += params.n; }
  });
  // What a comment says about the token (`exposes them as bg-primary`) is kept true too.
  root.walkComments((comment) => {
    const classes = renameClasses(comment.text, ctx);
    const vars = renameVars(classes.text, ctx);
    if (classes.n + vars.n > 0) { comment.text = vars.text; n += classes.n + vars.n; }
  });
  return { text: n > 0 ? root.toString() : text, n };
}

export async function planRename(input: { token: RepoToken; to: string; tokens: RepoToken[]; files: Record<string, string> }): Promise<RenamePlan | { refused: string }> {
  const names = namesFor(input.token, input.to, input.tokens);
  if (typeof names === "string") return { refused: names };
  const ctx = context(names);
  const plan: RenamePlan = { files: {}, places: [], total: 0, unreadable: [] };
  // What can't be in a file that has the token in it, so most files are not read any further.
  const needles = [`--${names.from}`, ...(names.classFrom ? [names.classFrom] : []), ...(names.mapped && names.tailwindFrom ? [`--${names.tailwindFrom}`] : [])];
  for (const [path, text] of Object.entries(input.files)) {
    if (!needles.some((n) => text.includes(n))) continue;
    let result: { text: string; n: number };
    if (/\.css$/i.test(path)) {
      try { result = await inStylesheet(text, ctx); } catch { plan.unreadable.push(path); continue; }
    } else {
      const classes = renameClasses(text, ctx);
      const vars = renameVars(classes.text, ctx);
      result = { text: vars.text, n: classes.n + vars.n };
    }
    if (result.n === 0 || result.text === text) continue;
    plan.files[path] = result.text;
    plan.places.push({ path, n: result.n });
    plan.total += result.n;
  }
  plan.places.sort((a, b) => b.n - a.n || a.path.localeCompare(b.path));
  return plan;
}
