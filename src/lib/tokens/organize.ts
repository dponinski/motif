// How tokens are arranged on the Tokens screen: which group a name belongs in, in what order a group reads, what a search
// finds, and what a new token in a group should be called. Pure, so the arrangement can be tested without a screen.

// A name's step when it ends in a number: `primary-500` is step 500 of `primary`, `chart-1` step 1 of `chart`.
export function stepOf(name: string): number | null {
  const m = /^.+?-(\d{1,3})$/.exec(name);
  return m ? Number(m[1]) : null;
}

export function stemOf(name: string): string {
  const m = /^(.+?)-\d{1,3}$/.exec(name);
  return m ? m[1] : name;
}

// The group a new color belongs in, from its name and the names it is made with (a repository's tokens come in all at once).
// A ramp (`gray-50` … `gray-950`) is a group of its own; so is a color with a `-foreground` partner (`primary` and
// `primary-foreground`); everything else is "base".
export function deriveGroup(name: string, all: string[]): string {
  const step = stepOf(name);
  if (step !== null) {
    const stem = stemOf(name);
    if (all.filter((n) => stepOf(n) !== null && stemOf(n) === stem).length >= 2) return stem;
  }
  const own = name.replace(/-foreground$/, "");
  if (all.includes(own) && all.includes(`${own}-foreground`)) return own;
  return "base";
}

// The order a group reads in: the tokens of a ramp by step, each ramp where its first token was, everything else as it was.
export function sortForReading<T extends { name: string }>(items: T[]): T[] {
  const members = new Map<string, number>();
  for (const t of items) if (stepOf(t.name) !== null) members.set(stemOf(t.name), (members.get(stemOf(t.name)) ?? 0) + 1);
  // A token belongs to a ramp when others share its stem; the ramp sits where its first token is.
  const bucket = (t: T, i: number) => (stepOf(t.name) !== null && (members.get(stemOf(t.name)) ?? 0) >= 2 ? `ramp:${stemOf(t.name)}` : `one:${i}`);
  const place = new Map<string, number>();
  const rows = items.map((t, i) => { const b = bucket(t, i); if (!place.has(b)) place.set(b, i); return { t, i, b }; });
  return rows
    .sort((x, y) => place.get(x.b)! - place.get(y.b)! || (x.b === y.b ? (stepOf(x.t.name) ?? 0) - (stepOf(y.t.name) ?? 0) : 0) || x.i - y.i)
    .map((r) => r.t);
}

export interface Grouped<T> { group: string; items: T[] }

// Items by group, groups in the order they first appear, each group in reading order.
export function groupItems<T extends { name: string; group: string }>(items: T[]): Grouped<T>[] {
  const order: string[] = [];
  const by = new Map<string, T[]>();
  for (const t of items) {
    if (!by.has(t.group)) { by.set(t.group, []); order.push(t.group); }
    by.get(t.group)!.push(t);
  }
  return order.map((group) => ({ group, items: sortForReading(by.get(group)!) }));
}

export type Only = "all" | "changed" | "unsynced" | "readonly" | "unused" | "differs" | "same";

export interface Searchable { name: string; group: string; text: string; linked: boolean; changed: boolean; readonly: boolean; unused?: boolean; differs?: boolean }

// What the search box and the filter chips leave: a token whose name, group or value has the typed words in it (every word).
export function filterItems<T extends Searchable>(items: T[], query: string, only: Only): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((t) => {
    if (only === "changed" && !t.changed) return false;
    if (only === "unsynced" && t.linked) return false;
    if (only === "readonly" && !t.readonly) return false;
    if (only === "unused" && !t.unused) return false;
    if (only === "differs" && !t.differs) return false;
    if (only === "same" && t.differs) return false;
    if (words.length === 0) return true;
    const hay = `${t.name} ${t.group} ${t.text}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// `name-copy`, then `name-copy-2`, … : a name that is free.
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const base = `${name.replace(/-copy(-\d+)?$/, "")}-copy`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// What to call the next token of a group: the step after the last one of a ramp, `group-1` for a numbered group, `group` otherwise.
export function nextName(group: string, names: string[]): string {
  const steps = names.filter((n) => stemOf(n) === group && stepOf(n) !== null).map((n) => stepOf(n)!);
  let candidate: string;
  if (steps.length === 0) candidate = group === "base" ? "color" : `${group}-1`;
  else {
    const max = Math.max(...steps);
    // Steps like 50 … 950 are a ramp; small numbers are a count.
    candidate = max >= 50 ? `${group}-${RAMP.find((s) => s > max) ?? max + 100}` : `${group}-${max + 1}`;
  }
  return uniqueName(candidate, names);
}
