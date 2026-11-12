import { describe, expect, it } from "vitest";
import { GROUPS, groupById, hasGroup, readGroup, tokenize, writeGroup } from "./classes";

const read = (text: string, id: string) => readGroup(text, groupById(id));
const write = (text: string, id: string, value: string | null) => writeGroup(text, groupById(id), value);

describe("reading utilities", () => {
  it("reads each kind of utility into its group", () => {
    const text = "flex flex-col items-center justify-between gap-4 p-6 px-2 mt-auto w-full h-10 max-w-2xl text-lg font-semibold text-center text-primary bg-surface border border-border rounded-lg shadow-card opacity-50";
    const expected: Record<string, string> = {
      display: "flex", direction: "col", items: "center", justify: "between", gap: "4", p: "6", px: "2", mt: "auto", w: "full", h: "10", "max-w": "2xl",
      "text-size": "lg", "font-weight": "semibold", "text-align": "center", "text-color": "primary", bg: "surface", "border-width": "1", "border-color": "border",
      radius: "lg", shadow: "card", opacity: "50",
    };
    for (const [id, value] of Object.entries(expected)) expect(read(text, id), id).toBe(value);
  });

  it("does not confuse look-alike utilities", () => {
    expect(read("gap-x-2", "gap")).toBeNull();
    expect(read("gap-x-2", "gap-x")).toBe("2");
    expect(read("px-4", "p")).toBeNull();
    expect(read("text-sm", "text-color")).toBeNull();
    expect(read("text-left", "text-color")).toBeNull();
    expect(read("text-[13px]", "text-size")).toBe("[13px]");
    expect(read("bg-cover bg-no-repeat bg-gradient-to-r", "bg")).toBeNull();
    expect(read("border-t border-solid", "border-width")).toBeNull();
    expect(read("border-t border-solid", "border-color")).toBeNull();
    expect(read("border-0", "border-width")).toBe("0");
    expect(read("rounded-t-lg", "radius")).toBeNull();
    expect(read("shadow-red-500", "shadow")).toBeNull();
    expect(read("flex-1 flex-shrink-0", "direction")).toBeNull();
    expect(read("flex-wrap", "direction")).toBeNull();
    expect(read("flex-wrap", "wrap")).toBe("wrap");
  });

  it("leaves classes with modifiers alone", () => {
    expect(read("hover:bg-muted md:p-8 dark:text-white !p-2 -mt-2", "bg")).toBeNull();
    expect(read("hover:bg-muted bg-primary", "bg")).toBe("primary");
    expect(hasGroup("md:p-8", groupById("p"))).toBe(false);
    expect(tokenize("a hover:b").map((t) => t.utility)).toEqual(["a", null]);
  });

  it("keeps a color with an opacity and an arbitrary value whole", () => {
    expect(read("bg-primary/90", "bg")).toBe("primary/90");
    expect(read("p-[18px]", "p")).toBe("[18px]");
    expect(read("bg-[#fff]", "bg")).toBe("[#fff]");
  });
});

describe("writing utilities", () => {
  it("replaces in place, keeping the other classes and their spacing", () => {
    expect(write("flex gap-2 p-4", "gap", "6")).toBe("flex gap-6 p-4");
    expect(write("flex  gap-2   p-4", "gap", "6")).toBe("flex  gap-6   p-4");
    expect(write("bg-primary text-primary-foreground hover:bg-primary/90", "bg", "danger")).toBe("bg-danger text-primary-foreground hover:bg-primary/90");
  });

  it("adds at the end when the group isn't there, without disturbing a trailing space", () => {
    expect(write("flex", "gap", "4")).toBe("flex gap-4");
    expect(write("flex ", "gap", "4")).toBe("flex gap-4");
    expect(write("", "gap", "4")).toBe("gap-4");
  });

  it("removes a group, and any duplicates, taking one side of the space with it", () => {
    expect(write("flex gap-2 p-4", "gap", null)).toBe("flex p-4");
    expect(write("flex p-4 gap-2", "gap", null)).toBe("flex p-4");
    expect(write("gap-2", "gap", null)).toBe("");
    expect(write("p-2 flex p-4", "p", "8")).toBe("p-8 flex");
    expect(write("a gap-2 ", "gap", null)).toBe("a ");
  });

  it("writes the plain forms of border, radius and shadow", () => {
    expect(write("x", "border-width", "1")).toBe("x border");
    expect(write("border-2", "border-width", "1")).toBe("border");
    expect(write("rounded-md", "radius", "DEFAULT")).toBe("rounded");
    expect(write("rounded", "radius", "full")).toBe("rounded-full");
    expect(write("shadow-card", "shadow", "none")).toBe("shadow-none");
  });

  it("round-trips every group's options", () => {
    for (const g of GROUPS.filter((x) => x.options)) {
      for (const option of g.options!) {
        const out = writeGroup("flex", g, option);
        expect(readGroup(out, g), `${g.id}=${option}`).toBe(option);
      }
    }
  });

  it("has a group id for every control", () => {
    expect(new Set(GROUPS.map((g) => g.id)).size).toBe(GROUPS.length);
  });
});
