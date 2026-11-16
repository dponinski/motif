import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import { readRepoTokens } from "./doc";
import { formatChannels, normalizeColor } from "./color";
import type { TokenChange } from "./merge";
import { applyEdits } from "./write";

const FILES = loadFixture("motif-test-system-v3");
const CSS = "src/styles/globals.css";
const scan = (files: Record<string, string>) => scanRepository(memorySource(files), { repo: "a/b", ref: "main" }, { tokensOnly: true });
const analysis = await scan(FILES);
const snapshot = readRepoTokens(analysis.tokens, analysis.themes);
const change = (name: string, kind: TokenChange["kind"], theme: string, type: TokenChange["type"], after: string): TokenChange => ({ name, kind, theme, type, after });

describe("a Tailwind 3 repository's tokens", () => {
  it("are read: colors from their variables, radii and shadows from the config", () => {
    const kinds = Object.values(snapshot.doc).map((t) => t.kind);
    expect(kinds.filter((k) => k === "color")).toHaveLength(17);
    expect(kinds.filter((k) => k === "radius")).toHaveLength(4);
    expect(kinds.filter((k) => k === "shadow")).toHaveLength(2);
    expect(snapshot.baseTheme).toBe("light");
  });
  it("read bare channels as the color they are, in each theme", () => {
    // shadcn's slate-900 and slate-50.
    expect(snapshot.doc.primary.values).toEqual({ light: "#0f172a", dark: "#f8fafc" });
    expect(snapshot.raw.primary.light).toBe("222.2 47.4% 11.2%");
  });
  it("leave out only what Motif has no tokens for", () => {
    expect(snapshot.skipped.map((s) => s.name).sort()).toEqual(["font-mono", "font-sans"]);
  });
});

describe("channels", () => {
  it("are written with as few digits as read back as the same color", () => {
    expect(formatChannels("hsl", "#ff0000")).toBe("0 100% 50%");
    expect(formatChannels("hsl", "#0f172a")).toBe("222.2 47.4% 11.2%");
    expect(formatChannels("rgb", "#ff8000")).toBe("255 128 0");
    expect(formatChannels("hsl", "#ff0000", "0, 100%, 50%")).toBe("0, 100%, 50%");
  });
  it("read back as what they were written from, for every color of the repository", () => {
    for (const [name, t] of Object.entries(snapshot.doc)) {
      if (t.kind !== "color") continue;
      for (const hex of Object.values(t.values)) expect(normalizeColor(`hsl(${formatChannels("hsl", hex)})`), name).toBe(hex);
    }
  });
  it("stay channels when a color is edited in a stylesheet", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [change("primary", "color", "light", "changed", "#ff0000")]);
    expect(out.skipped).toEqual([]);
    const lines = out.files[CSS].split("\n").filter((l, i) => l !== FILES[CSS].split("\n")[i]);
    expect(lines).toEqual(["    --primary: 0 100% 50%;"]);
  });
  it("and in the other theme only that one", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [change("danger", "color", "dark", "changed", "#112233")]);
    const before = FILES[CSS].split("\n");
    const diff = out.files[CSS].split("\n").map((l, i) => [before[i], l]).filter(([a, b]) => a !== b);
    expect(diff).toHaveLength(1);
    expect(diff[0][0]).toBe("    --danger: 0 91% 71%;");
    expect(diff[0][1]).toBe("    --danger: 210 50% 13.3%;");
  });
});

describe("values in the config", () => {
  const CONFIG = "tailwind.config.js";
  const lines = (before: string, after: string) => {
    const a = before.split("\n"), b = after.split("\n");
    expect(b.length).toBe(a.length);
    return b.map((l, i) => [a[i], l]).filter(([x, y]) => x !== y);
  };
  it("a radius is changed on its own line, in the unit the config uses", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [change("radius-md", "radius", "light", "changed", "10")]);
    expect(out.skipped).toEqual([]);
    expect(lines(FILES[CONFIG], out.files[CONFIG])).toEqual([['        md: "0.5rem",', '        md: "0.625rem",']]);
  });
  it("a shadow too, and a color in a stylesheet and a radius in the config go to their own files", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [
      change("shadow-card", "shadow", "light", "changed", "0 2px 2px 0 #0000000a, 0 1px 3px 0 #0000000f"),
      change("primary", "color", "light", "changed", "#ff0000"),
      change("radius-lg", "radius", "light", "changed", "16"),
    ]);
    expect(out.skipped).toEqual([]);
    expect(Object.keys(out.files).sort()).toEqual([CSS, CONFIG]);
    expect(lines(FILES[CONFIG], out.files[CONFIG]).map(([, l]) => l.trim())).toEqual(['lg: "1rem",', 'card: "0 2px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",']);
    expect(lines(FILES[CSS], out.files[CSS])).toEqual([["    --primary: 222.2 47.4% 11.2%;", "    --primary: 0 100% 50%;"]]);
  });
  it("is read again as what was written", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [change("radius-md", "radius", "light", "changed", "10"), change("primary", "color", "dark", "changed", "#123456")]);
    const after = await scan({ ...FILES, ...out.files });
    const doc = readRepoTokens(after.tokens, after.themes).doc;
    expect(doc["radius-md"].values.light).toBe("10");
    expect(doc.primary.values.dark).toBe("#123456");
    expect(doc.primary.values.light).toBe(snapshot.doc.primary.values.light);
  });
});

describe("new tokens in a Tailwind 3 repository", () => {
  const CONFIG = "tailwind.config.js";
  it("a color is a variable of channels in each theme and an entry in the config", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [change("brand", "color", "light", "added", "#1d4ed8"), change("brand", "color", "dark", "added", "#60a5fa")]);
    expect(out.skipped).toEqual([]);
    expect(out.files[CSS]).toMatch(/:root \{[^}]*--brand: 224\.3 76\.3% 48%;[^}]*\}/);
    expect(out.files[CSS]).toMatch(/\.dark \{[^}]*--brand: 213\.1 93\.9% 67\.8%;[^}]*\}/);
    expect(out.files[CONFIG]).toContain('danger: {\n          DEFAULT: "hsl(var(--danger))",\n          foreground: "hsl(var(--danger-foreground))",\n        },\n        brand: "hsl(var(--brand))",\n      },');
  });
  it("what was added is read again as the same color in each theme", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [change("brand", "color", "light", "added", "#1d4ed8"), change("brand", "color", "dark", "added", "#60a5fa")]);
    const after = await scan({ ...FILES, ...out.files });
    const token = after.tokens.find((t) => t.name === "brand")!;
    expect(token).toMatchObject({ kind: "color", tailwind: "color-brand", channels: "hsl" });
    expect(readRepoTokens(after.tokens, after.themes).doc.brand.values).toEqual({ light: "#1d4ed8", dark: "#60a5fa" });
  });
  it("a radius, a shadow and spacing are entries of their sections, named for their classes", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [
      change("radius-card", "radius", "light", "added", "12"),
      change("shadow-lift", "shadow", "light", "added", "0 4px 8px 0 #00000014"),
      change("spacing-gutter", "spacing", "light", "added", "24"),
    ]);
    expect(out.skipped).toEqual([]);
    expect(out.files[CONFIG]).toContain('xl: "1rem",\n        card: "0.75rem",\n      },');
    expect(out.files[CONFIG]).toContain('lift: "0 4px 8px 0 rgb(0 0 0 / 0.078)"');
    expect(out.files[CONFIG]).toContain('spacing: {\n        gutter: "');
    expect(Object.keys(out.files)).toEqual([CONFIG]);
    const after = await scan({ ...FILES, ...out.files });
    expect(readRepoTokens(after.tokens, after.themes).doc["radius-card"].values.light).toBe("12");
  });
  it("says why a token can't be added: a name that gives no class, and a theme a config doesn't have", async () => {
    const out = await applyEdits(FILES, analysis, snapshot, [change("card", "radius", "light", "added", "12"), change("radius-wide", "radius", "dark", "added", "20")]);
    expect(out.files).toEqual({});
    expect(out.skipped.map((s) => s.reason)).toEqual(["The name has to start with radius-, which is what gives Tailwind a class for it", "A Tailwind 3 config has no themes, so only a new token's base value is written"]);
  });
});
