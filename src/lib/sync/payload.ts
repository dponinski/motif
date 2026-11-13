// What of a project is kept on the server, and how it is told apart from what is on a device. Shared by the page and
// the server, so both read the same shape.
//
// Only what the person made is synced: the repository it is about, its name, tokens, documentation and the link
// to the repository's tokens. What can be read again from the repository (the scan, the component library) is not,
// and neither is the access token a project may hold, which stays in the browser it was typed into.

export interface SyncedConnection { owner: string; repo: string; defaultBranch: string }

export interface ProjectPayload {
  name: string;
  connection: SyncedConnection | null;
  tokenLink: Record<string, unknown> | null;
  tokens: Record<string, unknown>;
  docs: unknown[];
}

export const SECTIONS = ["name", "connection", "tokenLink", "tokens", "docs"] as const;
export type Section = (typeof SECTIONS)[number];

export const MAX_PAYLOAD_CHARS = 1_500_000;
export const MAX_PROJECTS = 100;

// The same text for the same value, whatever order its keys were made in.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// A fast 53-bit hash (cyrb53). It only has to tell whether a section changed since it was last synced.
export function hashText(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export type Hashes = Record<Section, string>;

export function hashSections(payload: ProjectPayload): Hashes {
  const out = {} as Hashes;
  for (const s of SECTIONS) out[s] = hashText(stableStringify(payload[s]));
  return out;
}

export const sameHashes = (a: Hashes, b: Hashes) => SECTIONS.every((s) => a[s] === b[s]);

// Anything that looks like a GitHub access token is refused outright: they must never be stored here, whatever
// field they were put in.
const TOKEN_PATTERN = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/;

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Reads what a page sent, or says what is wrong with it. It builds a new object from known parts only.
export function readPayload(input: unknown): { ok: true; payload: ProjectPayload } | { ok: false; error: string } {
  if (!isObject(input)) return { ok: false, error: "The project is missing" };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 200) return { ok: false, error: "The project needs a name of up to 200 characters" };

  let connection: SyncedConnection | null = null;
  if (input.connection !== null && input.connection !== undefined) {
    const c = input.connection;
    if (!isObject(c) || typeof c.owner !== "string" || typeof c.repo !== "string" || !NAME.test(c.owner) || !NAME.test(c.repo)) return { ok: false, error: "The repository isn't valid" };
    const defaultBranch = typeof c.defaultBranch === "string" ? c.defaultBranch : "main";
    if (!defaultBranch || defaultBranch.length > 250) return { ok: false, error: "The branch isn't valid" };
    // Not the token, even if one was sent.
    connection = { owner: c.owner, repo: c.repo, defaultBranch };
  }
  if (input.tokenLink !== null && input.tokenLink !== undefined && !isObject(input.tokenLink)) return { ok: false, error: "The token link isn't valid" };
  if (!isObject(input.tokens)) return { ok: false, error: "The tokens aren't valid" };
  if (!Array.isArray(input.docs)) return { ok: false, error: "The documentation isn't valid" };

  const payload: ProjectPayload = { name, connection, tokenLink: (input.tokenLink as Record<string, unknown> | null | undefined) ?? null, tokens: input.tokens, docs: input.docs };
  const text = JSON.stringify(payload);
  if (text.length > MAX_PAYLOAD_CHARS) return { ok: false, error: "This project is too large to save to your account" };
  if (TOKEN_PATTERN.test(text)) return { ok: false, error: "This project contains what looks like an access token, which can't be saved to your account" };
  return { ok: true, payload };
}

// What goes to the server for a project held in the browser.
export function toPayload(project: {
  name: string;
  repo: { connection: { owner: string; repo: string; defaultBranch: string } | null; tokenLink: unknown };
  tokens: unknown;
  docs: unknown[];
}): ProjectPayload {
  const c = project.repo.connection;
  return {
    name: project.name.trim() || c?.repo || "Untitled",
    connection: c ? { owner: c.owner, repo: c.repo, defaultBranch: c.defaultBranch } : null,
    tokenLink: (project.repo.tokenLink as Record<string, unknown> | null) ?? null,
    tokens: project.tokens as Record<string, unknown>,
    docs: project.docs,
  };
}
