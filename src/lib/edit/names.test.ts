import { describe, expect, it } from "vitest";
import { describeTag, elementName } from "./names";

describe("what an element is called", () => {
  it("names plain elements by what they are for", () => {
    expect(describeTag("h2")).toEqual({ kind: "Heading", icon: "heading" });
    expect(describeTag("div")).toEqual({ kind: "Box", icon: "box" });
    expect(describeTag("button").kind).toBe("Button");
    expect(describeTag("p").kind).toBe("Text");
    expect(describeTag("a").kind).toBe("Link");
    expect(describeTag("li").kind).toBe("List item");
  });

  it("keeps a component's own name, and an unknown tag as it is", () => {
    expect(describeTag("Badge")).toEqual({ kind: "Badge", icon: "component" });
    expect(describeTag("Dialog.Title")).toEqual({ kind: "Dialog.Title", icon: "component" });
    expect(describeTag("marquee")).toEqual({ kind: "marquee", icon: "box" });
  });

  it("adds what the element says, shortened", () => {
    expect(elementName("h2", "Hello")).toBe("Heading · Hello");
    expect(elementName("p", "  a   long\n text  ")).toBe("Text · a long text");
    expect(elementName("p", "x".repeat(40), 10)).toBe("Text · xxxxxxxxx…");
    expect(elementName("div", null)).toBe("Box");
    expect(elementName("div", "   ")).toBe("Box");
  });
});
