import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import { groupById } from "./classes";
import { buildTokenIndex, choicesFor } from "./tokens";

const scan = (files: Record<string, string>) => scanRepository(memorySource(files), { repo: "a/b", ref: "main" }, { tokensOnly: true });
const v3 = await scan(loadFixture("motif-test-system-v3"));
const v4 = await scan(loadFixture("motif-test-system"));

describe("the inspector's choices in a Tailwind 3 repository", () => {
  const radius = groupById("radius");
  const shadow = groupById("shadow");
  it("offer the repository's tokens, read from its config and its variables", () => {
    const index = buildTokenIndex(v3.tokens, v3.themes, 3);
    expect(choicesFor(radius, index, "light").tokens.map((c) => c.value)).toEqual(["sm", "md", "lg", "xl"]);
  });
  it("show a color kept as channels as the color it is", () => {
    const index = buildTokenIndex(v3.tokens, v3.themes, 3);
    const primary = choicesFor(groupById("bg"), index, "light").tokens.find((c) => c.value === "primary");
    expect(primary).toMatchObject({ swatch: "#0f172a", hint: "#0f172a" });
    expect(choicesFor(groupById("bg"), index, "dark").tokens.find((c) => c.value === "primary")?.swatch).toBe("#f8fafc");
  });
  it("leave out the sizes Tailwind 3 doesn't have", () => {
    const v3Index = buildTokenIndex(v3.tokens, v3.themes, 3);
    const v4Index = buildTokenIndex(v4.tokens, v4.themes, 4);
    expect(choicesFor(radius, v3Index, "light").scale.map((c) => c.value)).not.toContain("xs");
    expect(choicesFor(shadow, v3Index, "light").scale.map((c) => c.value)).not.toContain("2xs");
    expect(choicesFor(shadow, v3Index, "light").scale.map((c) => c.value)).not.toContain("xs");
    expect(choicesFor(radius, v4Index, "light").scale.map((c) => c.value)).toContain("xs");
  });
  it("know when a config replaces Tailwind's own values instead of adding to them", async () => {
    const replaced = await scan({ "package.json": '{"dependencies":{"react":"^18","tailwindcss":"^3"}}', "tailwind.config.js": "module.exports = { theme: { colors: { ink: '#111111' }, extend: { borderRadius: { card: '8px' } } } };" });
    const index = buildTokenIndex(replaced.tokens, replaced.themes, 3);
    expect([...index.reset]).toEqual(["color"]);
    expect([...buildTokenIndex(v3.tokens, v3.themes, 3).reset]).toEqual([]);
  });
  it("read a font size that comes with its line height", async () => {
    const sizes = await scan({ "package.json": '{"dependencies":{"react":"^18","tailwindcss":"^3"}}', "tailwind.config.js": "module.exports = { theme: { extend: { fontSize: { lead: ['1.25rem', { lineHeight: '1.75rem' }], tiny: '0.6rem' } } } };" });
    expect(sizes.tokens.map((t) => `${t.name}=${Object.values(t.values)[0]}`).sort()).toEqual(["text-lead=1.25rem", "text-tiny=0.6rem"]);
    const index = buildTokenIndex(sizes.tokens, sizes.themes, 3);
    expect(choicesFor(groupById("text-size"), index, "default").tokens.map((c) => c.value)).toEqual(["lead", "tiny"]);
  });
});
