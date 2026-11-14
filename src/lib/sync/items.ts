import { hashText, stableStringify } from "./payload";

// A project's tokens and documentation are made of items: each color, spacing step and so on, and each page. When two
// people change the same part at the same time, what matters is whether they changed the same item. Items are told apart by
// a hash of their content, kept (not the content) from the last time both sides agreed, which is enough to say who changed
// what.

export type ItemSection = "tokens" | "docs";
export const ITEM_SECTIONS: readonly ItemSection[] = ["tokens", "docs"];
export type ItemHashes = Record<string, string>;
export interface Items { tokens: ItemHashes; docs: ItemHashes }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasId = (v: unknown): v is Record<string, unknown> & { id: string } => isObject(v) && typeof v.id === "string";
const isCollection = (v: unknown): v is (Record<string, unknown> & { id: string })[] => Array.isArray(v) && v.every(hasId);

interface Entry {
  key: string;
  // Where it lives: a list in the tokens (`colors`), a single value (`$name`), the docs list, or the whole section.
  group: { kind: "list"; name: string } | { kind: "value"; name: string } | { kind: "docs" } | { kind: "whole" };
  value: unknown;
}

// A section as its items, in order.
function entriesOf(section: ItemSection, value: unknown): Entry[] {
  if (section === "docs") {
    if (isCollection(value)) return value.map((v) => ({ key: v.id, group: { kind: "docs" }, value: v }));
  } else if (isObject(value)) {
    const out: Entry[] = [];
    for (const [name, v] of Object.entries(value)) {
      if (isCollection(v)) for (const item of v) out.push({ key: `${name}/${item.id}`, group: { kind: "list", name }, value: item });
      else out.push({ key: `$${name}`, group: { kind: "value", name }, value: v });
    }
    return out;
  }
  // A shape that isn't made of items is one item.
  return [{ key: "$whole", group: { kind: "whole" }, value }];
}

const hashOf = (value: unknown) => hashText(stableStringify(value));

export function itemHashes(section: ItemSection, value: unknown): ItemHashes {
  return Object.fromEntries(entriesOf(section, value).map((e) => [e.key, hashOf(e.value)]));
}

export const itemsOf = (payload: { tokens: unknown; docs: unknown }): Items => ({ tokens: itemHashes("tokens", payload.tokens), docs: itemHashes("docs", payload.docs) });

export interface ItemConflict { section: ItemSection; key: string; name: string }

const nameOf = (e: Entry | undefined, key: string) => {
  const v = e?.value;
  if (isObject(v)) {
    if (typeof v.name === "string" && v.name) return v.name;
    if (typeof v.title === "string" && v.title) return v.title;
  }
  return key.includes("/") ? key.slice(key.indexOf("/") + 1) : key.replace(/^\$/, "");
};

export interface MergedSection {
  // The section with each item that both sides changed taken from this device, and from the server.
  withLocal: unknown;
  withServer: unknown;
  conflicts: ItemConflict[];
}

// Merges a section item by item against what both sides had when they last agreed: an item changed on one side only (added,
// edited or deleted) comes from that side; an item changed on both, differently, is a conflict. The order is the server's,
// with what is only here added after it.
export function mergeSection(section: ItemSection, base: ItemHashes, local: unknown, server: unknown): MergedSection {
  const L = new Map(entriesOf(section, local).map((e) => [e.key, e]));
  const S = new Map(entriesOf(section, server).map((e) => [e.key, e]));
  const keys = [...S.keys(), ...[...L.keys()].filter((k) => !S.has(k))];
  const conflicts: ItemConflict[] = [];
  const pickLocal = new Map<string, Entry | undefined>();
  const pickServer = new Map<string, Entry | undefined>();

  for (const key of keys) {
    const l = L.get(key), s = S.get(key);
    const lh = l && hashOf(l.value), sh = s && hashOf(s.value), bh = base[key];
    const here = lh !== bh, there = sh !== bh;
    if (lh === sh) { pickLocal.set(key, s ?? l); pickServer.set(key, s ?? l); continue; }
    if (!here) { pickLocal.set(key, s); pickServer.set(key, s); continue; }
    if (!there) { pickLocal.set(key, l); pickServer.set(key, l); continue; }
    conflicts.push({ section, key, name: nameOf(l ?? s, key) });
    pickLocal.set(key, l);
    pickServer.set(key, s);
  }

  const assemble = (picks: Map<string, Entry | undefined>): unknown => {
    const chosen = keys.map((k) => picks.get(k)).filter((e): e is Entry => !!e);
    if (section === "docs") return chosen.some((e) => e.group.kind === "whole") ? chosen[0].value : chosen.map((e) => e.value);
    // Something that isn't made of items at all is taken whole, from whichever side the pick is.
    if (keys.length === 1 && keys[0] === "$whole") return chosen[0]?.value ?? server;
    // The tokens: a list that is empty now is still there, in the server's place among the keys and then this device's.
    const out: Record<string, unknown> = {};
    const names = [...(isObject(server) ? Object.keys(server) : []), ...(isObject(local) ? Object.keys(local).filter((k) => !isObject(server) || !(k in server)) : [])];
    for (const name of names) {
      const asList = (isObject(server) && isCollection(server[name])) || (isObject(local) && isCollection(local[name]));
      if (asList) out[name] = [];
    }
    for (const e of chosen) {
      if (e.group.kind === "list") {
        const list = (out[e.group.name] as unknown[] | undefined) ?? (out[e.group.name] = []);
        list.push(e.value);
      } else if (e.group.kind === "value") out[e.group.name] = e.value;
    }
    return out;
  };
  return { withLocal: assemble(pickLocal), withServer: assemble(pickServer), conflicts };
}
