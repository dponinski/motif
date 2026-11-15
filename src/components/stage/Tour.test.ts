import { describe, expect, it } from "vitest";
import { place } from "./Tour";

const view = { width: 1440, height: 900 };

describe("where the tour's card goes", () => {
  it("is to the right of something at the left edge", () => {
    const p = place({ left: 56, top: 380, right: 360, bottom: 700 }, view, 170);
    expect(p.left).toBe(372);
  });

  it("is to the left of something at the right edge", () => {
    const p = place({ left: 1200, top: 40, right: 1440, bottom: 900 }, view, 170);
    expect(p.left).toBe(1200 - 300 - 12);
  });

  it("is under something near the top, centred on it", () => {
    const p = place({ left: 500, top: 70, right: 900, bottom: 110 }, view, 170);
    expect(p.top).toBe(122);
    expect(p.left).toBe(700 - 150);
  });

  it("stays inside the window", () => {
    const p = place({ left: 1300, top: 860, right: 1440, bottom: 900 }, view, 170);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + 300).toBeLessThanOrEqual(1440 - 12);
    expect(p.top + 170).toBeLessThanOrEqual(900 - 12);
    expect(p.top).toBeGreaterThanOrEqual(12);
  });
});
