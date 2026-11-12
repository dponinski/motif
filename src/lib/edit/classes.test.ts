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
    expect(tokenize("a hover:b").map((t) => [t.modifier, t.utility])).toEqual([["", "a"], ["hover:", "b"]]);
    expect(tokenize("!p-2 -mt-2").map((t) => t.utility)).toEqual([null, null]);
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

describe("states and breakpoints", () => {
  const read2 = (text: string, id: string, modifier: string) => readGroup(text, groupById(id), modifier);
  const write2 = (text: string, id: string, value: string | null, modifier: string) => writeGroup(text, groupById(id), value, modifier);

  it("reads a group under the modifier it is written with", () => {
    const text = "bg-primary hover:bg-primary/90 dark:bg-muted md:p-8 dark:hover:bg-red-500";
    expect(read2(text, "bg", "")).toBe("primary");
    expect(read2(text, "bg", "hover:")).toBe("primary/90");
    expect(read2(text, "bg", "dark:")).toBe("muted");
    expect(read2(text, "bg", "dark:hover:")).toBe("red-500");
    expect(read2(text, "p", "md:")).toBe("8");
    expect(read2(text, "p", "")).toBeNull();
    expect(read2(text, "bg", "focus:")).toBeNull();
  });

  it("writes a state without touching the plain class, and the other way round", () => {
    expect(write2("bg-primary hover:bg-primary/90", "bg", "danger", "hover:")).toBe("bg-primary hover:bg-danger");
    expect(write2("bg-primary hover:bg-primary/90", "bg", "danger", "")).toBe("bg-danger hover:bg-primary/90");
    expect(write2("flex", "gap", "4", "md:")).toBe("flex md:gap-4");
    expect(write2("gap-2 md:gap-4", "gap", null, "md:")).toBe("gap-2");
    expect(write2("gap-2 md:gap-4", "gap", null, "")).toBe("md:gap-4");
    expect(write2("dark:hover:bg-a", "bg", "b", "dark:")).toBe("dark:hover:bg-a dark:bg-b");
  });

  it("keeps a colon inside brackets out of the modifier", () => {
    expect(tokenize("bg-[url(a:b)]")[0]).toMatchObject({ modifier: "", utility: "bg-[url(a:b)]" });
    expect(tokenize("md:bg-[url(a:b)]")[0]).toMatchObject({ modifier: "md:", utility: "bg-[url(a:b)]" });
  });

  it("round-trips every group's options under a modifier", () => {
    for (const g of GROUPS.filter((x) => x.options)) {
      for (const option of g.options!) {
        const out = writeGroup("", g, option, "hover:");
        expect(readGroup(out, g, "hover:"), `${g.id}=${option}`).toBe(option);
        expect(readGroup(out, g, ""), `${g.id} plain`).toBeNull();
      }
    }
  });
});
