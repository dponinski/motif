import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { analyze, deleteElement, duplicateElement, moveElement, setGroup, setSlotClasses, setText, slotText } from "./element";
import { groupById, readGroup } from "./classes";
import { instrument, parseMotifKey } from "./instrument";

const files = loadFixture("motif-test-system");
const button = files["src/components/Button.tsx"];
const card = files["src/components/Card.tsx"];
const alert = files["src/components/Alert.tsx"];

// Where the element with this opening text starts.
const at = (code: string, opening: string, nth = 0) => {
  let from = -1;
  for (let i = 0; i <= nth; i++) from = code.indexOf(opening, from + 1);
  if (from < 0) throw new Error(`no ${opening}`);
  return from;
};

describe("instrumenting a module for the preview", () => {
  it("marks every plain element with where it starts, and nothing else", async () => {
    const out = await instrument("src/components/Button.tsx", button);
    const marks = [...out.matchAll(/data-motif="([^"]+)"/g)].map((m) => parseMotifKey(m[1])!);
    expect(marks.map((m) => button.slice(m.start, m.start + 5))).toEqual(["<butt", "<span"]);
    expect(out).toContain('<button data-motif="src/components/Button.tsx|');
    expect(out).not.toContain("<Button data-motif");
    expect(out.replace(/ data-motif="[^"]*"/g, "")).toBe(button);
  });

  it("leaves what it can't read as it was, and non-script files alone", async () => {
    expect(await instrument("a.css", "a { }")).toBe("a { }");
    expect(parseMotifKey("src/a.tsx|120")).toEqual({ path: "src/a.tsx", start: 120 });
    expect(parseMotifKey("nonsense")).toBeNull();
    await expect(instrument("a.tsx", "const = ;")).rejects.toThrow();
  });
});

describe("what an element offers", () => {
  it("finds the classes of a plain cn() element", async () => {
    const info = (await analyze("Card.tsx", card, at(card, "<div className", 0)))!;
    expect(info.tag).toBe("div");
    expect(info.className).toBe("static");
    expect(info.slots.map((s) => [s.kind, slotText(s)])).toEqual([["cn", "rounded-lg border border-border bg-surface shadow-card"]]);
    expect(info.classes).toBe("rounded-lg border border-border bg-surface shadow-card");
  });

  it("follows a cva call, joining a string written in pieces, and marks the variants that apply", async () => {
    const info = (await analyze("Button.tsx", button, at(button, "<button"), { variant: "danger" }))!;
    const labels = info.slots.map((s) => `${s.label}${s.active ? "*" : ""}`);
    expect(labels).toEqual(["buttonVariants base*", "variant: primary", "variant: secondary", "variant: outline", "variant: ghost", "variant: danger*", "size: sm", "size: md*", "size: lg", "size: icon"]);
    expect(info.slots[0].parts).toHaveLength(3);
    expect(info.classes).toContain("inline-flex");
    expect(info.classes).toContain("bg-danger text-danger-foreground");
    expect(info.classes).toContain("h-10 px-4 text-sm");
    expect(info.classes).not.toContain("bg-primary");
  });

  it("uses the cva defaults when no value is given", async () => {
    const info = (await analyze("Button.tsx", button, at(button, "<button")))!;
    expect(info.slots.filter((s) => s.active).map((s) => s.label)).toEqual(["buttonVariants base", "variant: primary", "size: md"]);
  });

  it("says when classes can't be edited, and when there are none", async () => {
    const dynamic = `export const A = ({ c }: { c: string }) => <div className={c}>x</div>;`;
    const info = (await analyze("A.tsx", dynamic, dynamic.indexOf("<div")))!;
    expect(info.className).toBe("dynamic");
    expect(info.dynamicReason).toMatch(/runtime/);
    const plain = "export const A = () => <div>x</div>;";
    const none = (await analyze("A.tsx", plain, plain.indexOf("<div")))!;
    expect(none.className).toBe("none");
    expect(none.text).toMatchObject({ value: "x" });
  });

  it("returns nothing for a position that is not an element", async () => {
    expect(await analyze("Card.tsx", card, 3)).toBeNull();
  });

  it("offers the text only when the element holds nothing but text", async () => {
    const info = (await analyze("Alert.tsx", alert, at(alert, "<p className"), {}))!;
    expect(info.text).toBeNull();
    const code = 'export const A = () => (\n  <div>\n    <h1 className="a">  Hello  </h1>\n    <p>{x}</p>\n  </div>\n);';
    expect((await analyze("A.tsx", code, code.indexOf("<h1")))!.text).toMatchObject({ value: "Hello" });
    expect((await analyze("A.tsx", code, code.indexOf("<p")))!.text).toBeNull();
  });
});

describe("changing classes", () => {
  it("edits the class string that already holds the group, and only that", async () => {
    const start = at(card, "<div className", 0);
    const out = (await setGroup("Card.tsx", card, start, "bg", "primary"))!;
    expect(out.code).toBe(card.replace("rounded-lg border border-border bg-surface shadow-card", "rounded-lg border border-border bg-primary shadow-card"));
    expect(out.selection).toBe(start);
    expect(out.summary).toBe("div: background surface → primary");
  });

  it("changes a variant's own classes when that variant is the one shown", async () => {
    const start = at(button, "<button");
    const out = (await setGroup("Button.tsx", button, start, "bg", "success", { variant: "secondary" }))!;
    expect(out.code).toContain('secondary: "bg-success text-secondary-foreground hover:bg-secondary/80"');
    expect(out.code).toContain('primary: "bg-primary text-primary-foreground hover:bg-primary/90"');
    // The selected element is after the edit, so it moved by the difference in length.
    expect(out.code.slice(out.selection!, out.selection! + 7)).toBe("<button");
  });

  it("edits a piece of a string written in several pieces, leaving the pieces as they are", async () => {
    const out = (await setGroup("Button.tsx", button, at(button, "<button"), "gap", "4"))!;
    expect(out.code).toContain('"inline-flex items-center justify-center gap-4 whitespace-nowrap rounded-md font-medium transition-colors "');
    expect(out.code.split("\n").length).toBe(button.split("\n").length);
  });

  it("adds a group that isn't set to the element's own classes, or the cva base", async () => {
    const withCard = (await setGroup("Card.tsx", card, at(card, "<div className", 0), "p", "8"))!;
    expect(withCard.code).toContain('cn("rounded-lg border border-border bg-surface shadow-card p-8", className)');
    const added = (await setGroup("Alert.tsx", alert, at(alert, "<div\n"), "shadow", "md"))!;
    expect(added.code).toContain('cva("flex gap-3 rounded-lg border p-4 text-sm shadow-md"');
  });

  it("adds a className where there is none", async () => {
    const code = "export const A = () => <div>x</div>;";
    const out = (await setGroup("A.tsx", code, code.indexOf("<div"), "gap", "2"))!;
    expect(out.code).toBe('export const A = () => <div className="gap-2">x</div>;');
  });

  it("removes a group, and does nothing to remove one that isn't there", async () => {
    const start = at(card, "<div className", 0);
    expect((await setGroup("Card.tsx", card, start, "shadow", null))!.code).toContain('cn("rounded-lg border border-border bg-surface", className)');
    expect((await setGroup("Card.tsx", card, start, "gap", null))!.code).toBe(card);
  });

  it("refuses classes it can't see, saying why", async () => {
    const code = "export const A = ({ c }: { c: string }) => <div className={c}>x</div>;";
    await expect(setGroup("A.tsx", code, code.indexOf("<div"), "gap", "2")).rejects.toThrow(/runtime/);
  });

  it("shifts the selection when the edit is above the element", async () => {
    // Alert's root takes its classes from a cva defined above it.
    const start = at(alert, "<div\n");
    const same = (await setGroup("Alert.tsx", alert, start, "gap", "6", { variant: "info" }))!;
    expect(same.selection).toBe(start);
    const longer = (await setGroup("Alert.tsx", alert, start, "p", "10", { variant: "info" }))!;
    expect(longer.selection).toBe(start + 1);
    expect(longer.code.slice(longer.selection!, longer.selection! + 4)).toBe("<div");
  });

  it("edits a slot's raw classes", async () => {
    const info = (await analyze("Card.tsx", card, at(card, "<div className", 1)))!;
    const out = (await setSlotClasses("Card.tsx", card, info.start, "0", "flex flex-col gap-2 p-6 pb-0"))!;
    expect(out.code).toContain('cn("flex flex-col gap-2 p-6 pb-0", className)');
    const quoted = (await setSlotClasses("Card.tsx", card, info.start, "0", 'a "b" c'))!;
    expect(quoted.code).toContain('cn("a b c", className)');
  });
});

describe("changing a state", () => {
  it("changes the hover class of the variant that is showing, and nothing else", async () => {
    const start = at(button, "<button");
    const info = (await analyze("Button.tsx", button, start, { variant: "primary" }))!;
    expect(readGroup(info.classes, groupById("bg"), "hover:")).toBe("primary/90");
    const out = (await setGroup("Button.tsx", button, start, "bg", "muted", { variant: "primary" }, "hover:"))!;
    expect(out.code).toContain('primary: "bg-primary text-primary-foreground hover:bg-muted"');
    expect(out.summary).toBe("button: hover background primary/90 → muted");
    const diff = out.code.split("\n").filter((l, i) => l !== button.split("\n")[i]);
    expect(diff).toHaveLength(1);
  });

  it("adds a state to the element's own classes when it has none", async () => {
    const start = at(card, "<div className", 0);
    const hover = (await setGroup("Card.tsx", card, start, "shadow", "lg", {}, "hover:"))!;
    expect(hover.code).toContain('cn("rounded-lg border border-border bg-surface shadow-card hover:shadow-lg", className)');
    const dark = (await setGroup("Card.tsx", card, start, "bg", "background", {}, "dark:"))!;
    expect(dark.code).toContain("shadow-card dark:bg-background");
    const md = (await setGroup("Card.tsx", card, start, "p", "8", {}, "md:"))!;
    expect(md.code).toContain("shadow-card md:p-8");
    expect(md.summary).toBe("div: md padding none → 8");
  });

  it("puts a new state beside the plain class it belongs to, in the variant that has it", async () => {
    const start = at(button, "<button");
    const dark = (await setGroup("Button.tsx", button, start, "bg", "danger", { variant: "primary" }, "dark:"))!;
    expect(dark.code).toContain('primary: "bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-danger"');
    const gap = (await setGroup("Button.tsx", button, start, "gap", "6", { variant: "primary" }, "md:"))!;
    expect(gap.code).toContain('cursor-pointer md:gap-6"');
  });

  it("removes a state without removing the plain class", async () => {
    const start = at(button, "<button");
    const out = (await setGroup("Button.tsx", button, start, "bg", null, { variant: "primary" }, "hover:"))!;
    expect(out.code).toContain('primary: "bg-primary text-primary-foreground"');
  });

  it("puts a state on a className that doesn't exist yet", async () => {
    const code = "export const A = () => <div>x</div>;";
    const out = (await setGroup("A.tsx", code, code.indexOf("<div"), "bg", "primary", {}, "hover:"))!;
    expect(out.code).toBe('export const A = () => <div className="hover:bg-primary">x</div>;');
  });
});

describe("changing text and structure", () => {
  const code = [
    "export function A() {",
    "  return (",
    "    <div className=\"flex\">",
    "      <h1>Title</h1>",
    "      <p>One</p>",
    "      <p>Two</p>",
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n");

  it("sets text, escaping what JSX would read as code", async () => {
    const start = code.indexOf("<h1");
    expect((await setText("A.tsx", code, start, "Hello"))!.code).toContain("<h1>Hello</h1>");
    expect((await setText("A.tsx", code, start, "a {b} < c"))!.code).toContain('<h1>{"a {b} < c"}</h1>');
    expect(await setText("A.tsx", code, code.indexOf("<div"), "x")).toBeNull();
  });

  it("deletes an element and the line it was on", async () => {
    const out = (await deleteElement("A.tsx", code, code.indexOf("<p>One")))!;
    expect(out.code).toBe(code.replace("      <p>One</p>\n", ""));
    expect(out.selection).toBeNull();
  });

  it("won't delete the root of what a component returns", async () => {
    expect(await deleteElement("A.tsx", code, code.indexOf("<div"))).toBeNull();
    expect((await analyze("A.tsx", code, code.indexOf("<div")))!.canDelete).toBe(false);
    expect((await analyze("A.tsx", code, code.indexOf("<h1")))!.canDelete).toBe(true);
  });

  it("duplicates an element on its own line", async () => {
    const out = (await duplicateElement("A.tsx", code, code.indexOf("<p>One")))!;
    expect(out.code).toContain("      <p>One</p>\n      <p>One</p>\n      <p>Two</p>");
    expect(out.selection).toBe(code.indexOf("<p>One"));
  });

  it("moves an element past its sibling, and keeps the selection on it", async () => {
    const down = (await moveElement("A.tsx", code, code.indexOf("<p>One"), 1))!;
    expect(down.code).toContain("      <p>Two</p>\n      <p>One</p>\n    </div>");
    expect(down.code.slice(down.selection!, down.selection! + 10)).toBe("<p>One</p>");
    const up = (await moveElement("A.tsx", code, code.indexOf("<p>Two"), -1))!;
    expect(up.code).toContain("      <p>Two</p>\n      <p>One</p>");
    expect(up.code.slice(up.selection!, up.selection! + 10)).toBe("<p>Two</p>");
    expect(await moveElement("A.tsx", code, code.indexOf("<h1"), -1)).toBeNull();
    const info = (await analyze("A.tsx", code, code.indexOf("<p>One")))!;
    expect([info.canMoveUp, info.canMoveDown]).toEqual([true, true]);
  });

  it("does not treat an element inside an expression as a sibling", async () => {
    const cond = "export const A = ({ x }: { x: boolean }) => (<div>{x && <span>a</span>}</div>);";
    expect(await deleteElement("A.tsx", cond, cond.indexOf("<span"))).toBeNull();
  });
});
