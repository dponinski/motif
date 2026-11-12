import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import type { RepoComponent } from "../repo-scan/types";
import { controlFor, controlsFor, initialProps, variantCombinations } from "./props";

const analysis = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" });
const component = (name: string) => analysis.components.find((c) => c.name === name)!;
const kinds = (name: string) => Object.fromEntries(controlsFor(component(name)).map((c) => [c.name, c.control.kind]));

describe("controls", () => {
  it("makes a select of every variant, and a toggle of every boolean", () => {
    expect(kinds("Button")).toEqual({ children: "node", loading: "boolean", variant: "select", size: "select" });
    expect(controlsFor(component("Button")).find((c) => c.name === "variant")!.control).toEqual({ kind: "select", options: ["primary", "secondary", "outline", "ghost", "danger"] });
    expect(controlsFor(component("Button")).find((c) => c.name === "variant")!.defaultValue).toBe("primary");
  });

  it("understands text, nodes, handlers and elements across the whole design system", () => {
    expect(kinds("Avatar")).toEqual({ name: "text", src: "text", size: "select", className: "text" });
    expect(kinds("Switch")).toEqual({ checked: "boolean", defaultChecked: "boolean", onCheckedChange: "ignored", label: "text", disabled: "boolean", className: "text" });
    expect(kinds("Modal")).toEqual({ open: "boolean", onClose: "ignored", title: "node", description: "node", footer: "node", className: "text", children: "node" });
    expect(kinds("Field").children).toBe("ignored");
    expect(controlsFor(component("Field")).find((c) => c.name === "children")!.control).toEqual({ kind: "ignored", reason: "Needs an element, which only an example can provide" });
    expect(kinds("Tabs")).toMatchObject({ defaultValue: "text", onValueChange: "ignored", children: "node" });
  });

  it("gives every prop a control, and keeps descriptions", () => {
    for (const c of analysis.components) expect(controlsFor(c).map((x) => x.name).filter((n) => n !== "children")).toEqual(c.props.map((p) => p.name).filter((n) => n !== "children"));
    expect(controlsFor(component("Field")).find((c) => c.name === "children")!.description).toMatch(/single form control/);
  });

  it("falls back to ignored for types it cannot edit, naming them", () => {
    const prop = (type: string, name = "x") => ({ name, type, required: false, default: null, description: null, options: null });
    expect(controlFor(prop("string | undefined")).kind).toBe("text");
    expect(controlFor(prop("number | null")).kind).toBe("number");
    expect(controlFor(prop("Record<string, unknown>"))).toEqual({ kind: "ignored", reason: "A complex value that can't be edited here" });
    expect(controlFor(prop("Date"))).toEqual({ kind: "ignored", reason: "A Date value that can't be edited here" });
    expect(controlFor(prop("() => void", "retry")).kind).toBe("ignored");
    expect(controlFor(prop("string", "onChange")).kind).toBe("ignored");
  });
});

describe("starting values", () => {
  const initial = (name: string) => initialProps(component(name));

  it("lets content be edited on every component that holds it, but not on elements that cannot", () => {
    for (const name of ["Button", "Badge", "Alert", "Card", "CardTitle", "Label"]) expect(kinds(name).children, name).toBe("node");
    for (const name of ["Input", "Textarea", "Select", "Checkbox", "Avatar"]) expect(kinds(name).children, name).toBeUndefined();
    expect(controlsFor(component("Button"))[0]).toMatchObject({ name: "children", required: false, defaultValue: null });
  });

  it("gives components that hold content their name as text", () => {
    expect(initial("Button")).toEqual({ children: "Button" });
    expect(initial("Card")).toEqual({ children: "Card" });
    expect(initial("Badge")).toEqual({ children: "Badge" });
    expect(initial("Alert")).toEqual({ children: "Alert" });
    expect(initial("Label")).toEqual({ children: "Label" });
  });

  it("does not give children to elements that cannot have them", () => {
    for (const name of ["Input", "Textarea", "Select", "Checkbox"]) expect(initial(name), name).toEqual({});
  });

  it("fills required props with something that renders", () => {
    expect(initial("Avatar")).toEqual({ name: "Ada Lovelace" });
    expect(initial("Modal")).toEqual({ open: true, title: "Title", children: "Modal" });
    expect(initial("Field")).toEqual({ label: "Label" });
    expect(initial("Tabs")).toEqual({ defaultValue: "DefaultValue", children: "Tabs" });
    expect(initial("TabsTrigger")).toEqual({ value: "Value", children: "TabsTrigger" });
  });

  it("leaves optional props alone, so the component's own defaults apply", () => {
    expect(Object.keys(initial("Button"))).not.toContain("variant");
    expect(Object.keys(initial("Switch"))).not.toContain("checked");
  });

  it("picks the first option for a required variant and 1 for a required number", () => {
    const c = { name: "X", root: "div", nativeProps: null, variants: [], props: [
      { name: "tone", type: '"a" | "b"', required: true, default: null, description: null, options: ["a", "b"] },
      { name: "count", type: "number", required: true, default: null, description: null, options: null },
    ] } as unknown as RepoComponent;
    expect(initialProps(c)).toEqual({ tone: "a", count: 1 });
  });
});

describe("all variants", () => {
  it("is every combination, labelled", () => {
    const { combinations, total } = variantCombinations(component("Button"), { children: "Button" });
    expect(total).toBe(20);
    expect(combinations).toHaveLength(20);
    expect(combinations[0]).toEqual({ key: "primary/sm", label: "primary · sm", props: { children: "Button", variant: "primary", size: "sm" } });
    expect(combinations[19].label).toBe("danger · icon");
    expect(new Set(combinations.map((c) => c.key)).size).toBe(20);
  });

  it("is a single item when there are no variants", () => {
    expect(variantCombinations(component("Card"), { children: "Card" })).toEqual({ combinations: [{ key: "default", label: "default", props: { children: "Card" } }], total: 1 });
    expect(variantCombinations(component("Badge"), {}).total).toBe(6);
  });

  it("caps very large matrices and says how many there are", () => {
    const options = ["a", "b", "c", "d", "e"];
    const c = { variants: ["x", "y", "z"].map((name) => ({ name, options, default: null, source: "cva" })) } as unknown as RepoComponent;
    const { combinations, total } = variantCombinations(c, {});
    expect(total).toBe(125);
    expect(combinations).toHaveLength(24);
    expect(variantCombinations(c, {}, 5).combinations).toHaveLength(5);
  });
});
