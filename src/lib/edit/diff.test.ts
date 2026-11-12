import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

describe("line diff", () => {
  it("shows a changed line with its neighbours", () => {
    const a = ["1", "2", "3", "4", "5", "6", "7"].join("\n");
    const b = ["1", "2", "3", "four", "5", "6", "7"].join("\n");
    const d = diffLines(a, b, 1);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].map((l) => l.type + l.text)).toEqual([" 3", "-4", "+four", " 5"]);
  });

  it("splits distant changes into hunks and joins near ones", () => {
    const base = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const far = base.map((l, i) => (i === 2 || i === 25 ? `${l}!` : l));
    expect(diffLines(base.join("\n"), far.join("\n"), 2).hunks).toHaveLength(2);
    const near = base.map((l, i) => (i === 10 || i === 13 ? `${l}!` : l));
    expect(diffLines(base.join("\n"), near.join("\n"), 2).hunks).toHaveLength(1);
  });

  it("handles additions, removals and no change", () => {
    expect(diffLines("a\nb", "a\nb").hunks).toEqual([]);
    const added = diffLines("a\nc", "a\nb\nc", 0);
    expect(added.hunks[0].map((l) => l.type + l.text)).toEqual(["+b"]);
    const removed = diffLines("a\nb\nc", "a\nc", 0);
    expect(removed.hunks[0].map((l) => l.type + l.text)).toEqual(["-b"]);
  });
});
