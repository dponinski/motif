import { describe, expect, it } from "vitest";
import { absPos, matrixCss, sceneToScreen, visibleOrigin } from "./canvas-geometry";

describe("canvas geometry", () => {
  const elements = {
    root: { x: 100, y: 50 },
    frame: { x: 10, y: 20, parentId: "root" },
    leaf: { x: 5, y: 5, parentId: "frame" },
  };

  it("adds up the positions of every frame an element is in", () => {
    expect(absPos(elements.root, elements)).toEqual({ x: 100, y: 50 });
    expect(absPos(elements.frame, elements)).toEqual({ x: 110, y: 70 });
    expect(absPos(elements.leaf, elements)).toEqual({ x: 115, y: 75 });
    expect(absPos({ x: 1, y: 2, parentId: "gone" }, elements)).toEqual({ x: 1, y: 2 });
  });

  it("writes a viewport transform as a CSS matrix", () => {
    expect(matrixCss([2, 0, 0, 2, 40, -10])).toBe("matrix(2, 0, 0, 2, 40, -10)");
    expect(matrixCss([])).toBe("matrix(1, 0, 0, 1, 0, 0)");
  });

  it("puts a scene point on screen the way the canvas does, and the other way round", () => {
    expect(sceneToScreen(100, 50, 2, -30, 10)).toEqual({ x: 140, y: 120 });
    // The canvas draws at zoom * (scene + pan), so a viewport transform of [z,0,0,z,pan*z,...] agrees.
    const z = 1.5, panX = 20, panY = -8;
    const vpt = [z, 0, 0, z, panX * z, panY * z];
    expect(sceneToScreen(40, 60, z, panX, panY)).toEqual({ x: 40 * vpt[0] + vpt[4], y: 60 * vpt[3] + vpt[5] });
  });

  it("finds a visible place for something new", () => {
    expect(visibleOrigin(1, 0, 0)).toEqual({ x: 100, y: 100 });
    expect(visibleOrigin(2, -400, -200)).toEqual({ x: 450, y: 250 });
    expect(visibleOrigin(0.5, 100, 100)).toEqual({ x: 100, y: 100 });
  });
});
