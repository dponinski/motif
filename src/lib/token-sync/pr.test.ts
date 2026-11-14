import { describe, expect, it } from "vitest";
import { changeLine, tokenSummary } from "./pr";
import type { TokenChange } from "./merge";

describe("tokenSummary", () => {
  const changes: TokenChange[] = [
    { name: "primary", kind: "color", theme: "dark", type: "changed", before: "#111111", after: "#222222" },
    { name: "brand`s", kind: "color", theme: "light", type: "added", after: "#333333" },
    { name: "radius-md", kind: "radius", theme: "light", type: "changed", before: "8", after: "10" },
  ];

  it("says what was done on its first line and lists each change and what was left out after it", () => {
    const lines = tokenSummary(changes, [{ name: "radius-md", theme: "light", reason: "Defined in a Tailwind config file, which can't be edited yet" }], { generated: false }).split("\n");
    expect(lines[0]).toBe("Update 3 design tokens from Motif");
    expect(lines).toContain("`radius-md` (light): `8px` → `10px`");
    expect(lines).toContain("`primary` (dark): `#111111` → `#222222`");
    expect(lines).toContain("`brand's` (light): `#333333`");
    expect(lines).toContain("Not included: `radius-md` (light): Defined in a Tailwind config file, which can't be edited yet");
  });

  it("describes a generated file and caps long lists", () => {
    const many = Array.from({ length: 75 }, (_, i): TokenChange => ({ name: `t${i}`, kind: "color", theme: "light", type: "added", after: "#000000" }));
    const lines = tokenSummary(many, [], { generated: true }).split("\n");
    expect(lines[0]).toBe("Add 75 design tokens from Motif");
    expect(lines).toContain("…and 15 more");
    expect(lines.some((l) => l.startsWith("Not included"))).toBe(false);
    expect(lines).toHaveLength(1 + 60 + 1);
  });

  it("writes a single token as singular", () => {
    expect(tokenSummary([changes[1]], [], { generated: false }).split("\n")[0]).toBe("Update 1 design token from Motif");
    expect(changeLine(changes[1])).toBe("`brand's` (light): `#333333`");
  });
});
