import { describe, expect, it } from "vitest";
import { readDeclarations } from "./css";
import { newClassName, ownedClass, setCssGroup, stylesheetOf, usesOf, viewOf } from "./css-element";
import { analyze } from "./element";
import { buildTokenIndex } from "./tokens";

const index = buildTokenIndex(
  [
    { name: "primary", kind: "color", values: { default: "#3366ff" }, locations: {}, tailwind: null, file: "t.css", line: 1 },
    { name: "space-4", kind: "spacing", values: { default: "16px" }, locations: {}, tailwind: null, file: "t.css", line: 2 },
  ],
  ["default"], null, {}, true
);

const CODE = `import "./Card.css";

export function Card() {
  return (
    <div className="card">
      <h2>Title</h2>
      <p className="card__text">Body</p>
      <p className={cn("card__text", open && "open")}>More</p>
    </div>
  );
}
`;
const CSS = `.card {\n  padding: 16px;\n}\n\n.card__text {\n  color: var(--primary);\n}\n`;
const at = (needle: string) => CODE.indexOf(needle);

const run = (needle: string, groupId: string, value: string | null, modifier = "", css = CSS, code = CODE) =>
  setCssGroup({ path: "src/Card.tsx", code, start: code.indexOf(needle), stylesheet: "src/Card.css", css, groupId, value, modifier, index });

describe("finding where an element's styles are", () => {
  it("is the stylesheet the component imports, and not a CSS module", () => {
    expect(stylesheetOf("src/components/Card.tsx", `import "./Card.css";\nexport const a = 1;`)).toBe("src/components/Card.css");
    expect(stylesheetOf("src/components/Card.tsx", `import "../styles/card.css";`)).toBe("src/styles/card.css");
    expect(stylesheetOf("Card.tsx", `import './card.css'`)).toBe("card.css");
    expect(stylesheetOf("src/Card.tsx", `import styles from "./Card.module.css";`)).toBeNull();
    expect(stylesheetOf("src/Card.tsx", `import "./Card.module.css";`)).toBeNull();
    expect(stylesheetOf("src/Card.tsx", `import x from "x.css";\nimport "pkg/style.css";`)).toBeNull();
    expect(stylesheetOf("src/Card.tsx", `export const a = 1;`)).toBeNull();
  });

  it("is the first class of the element that has a rule", () => {
    expect(ownedClass("a card b", CSS)).toBe("card");
    expect(ownedClass("a b", CSS)).toBeNull();
    expect(ownedClass("", CSS)).toBeNull();
  });

  it("counts the elements that use a class", () => {
    expect(usesOf(CODE, "card__text")).toBe(2);
    expect(usesOf(CODE, "card")).toBe(1);
    expect(usesOf(CODE, "none")).toBe(0);
    expect(usesOf(`<p className='a b' /><i className={"b"} /><u className={\`b c\`} />`, "b")).toBe(3);
  });

  it("describes an element: its class, and who else has it", async () => {
    const info = (await analyze("src/Card.tsx", CODE, at('<p className="card__text">')))!;
    expect(viewOf(info, CODE, CSS)).toEqual({ cls: "card__text", sharedWith: 1 });
    const own = (await analyze("src/Card.tsx", CODE, at('<div className="card">')))!;
    expect(viewOf(own, CODE, CSS)).toEqual({ cls: "card", sharedWith: 0 });
    const none = (await analyze("src/Card.tsx", CODE, at("<h2>")))!;
    expect(viewOf(none, CODE, CSS)).toEqual({ cls: null, sharedWith: 0 });
  });

  it("chooses a class name for an element that has none, one that is not taken", () => {
    expect(newClassName("src/Card.css", "h2", CODE, CSS)).toBe("card__h2");
    expect(newClassName("src/PricingCard.css", "div", CODE, CSS)).toBe("pricing-card__div");
    expect(newClassName("src/Card.css", "p", CODE, CSS)).toBe("card__p");
    expect(newClassName("src/Card.css", "p", CODE, `${CSS}.card__p{}`)).toBe("card__p-2");
    expect(newClassName("src/Card.css", "p", `<i className="card__p card__p-2" />`, `.card__p{}`)).toBe("card__p-3");
    expect(newClassName("src/Card.css", "Icon", CODE, CSS)).toBe("card__icon");
  });
});

describe("changing an element's style in its stylesheet", () => {
  it("changes the rule of the class it already has, and nothing else", async () => {
    const edit = (await run('<div className="card">', "p", "24px"))!;
    expect(Object.keys(edit.texts)).toEqual(["src/Card.css"]);
    expect(edit.texts["src/Card.css"]).toBe(CSS.replace("16px", "24px"));
    expect(edit.summary).toBe("div: padding 16px → 24px");
  });

  it("gives an element with a class string but no rule of its own a class and a rule", async () => {
    const code = CODE.replace("<h2>Title</h2>", '<h2 className="title">Title</h2>');
    const edit = (await run('<h2 className="title">', "text-size", "24px", "", CSS, code))!;
    expect(edit.texts["src/Card.tsx"]).toContain('<h2 className="title card__h2">');
    expect(readDeclarations(edit.texts["src/Card.css"], "card__h2")).toEqual({ "font-size": "24px" });
    // the rest of the file is as it was
    expect(edit.texts["src/Card.tsx"].replace(' card__h2', "")).toBe(code);
  });

  it("gives an element with no className one", async () => {
    const edit = (await run("<h2>", "text-color", "primary"))!;
    expect(edit.texts["src/Card.tsx"]).toContain('<h2 className="card__h2">Title</h2>');
    expect(readDeclarations(edit.texts["src/Card.css"], "card__h2")).toEqual({ color: "var(--primary)" });
    expect(edit.summary).toBe("h2: text color none → primary");
  });

  it("works with a stylesheet that doesn't exist yet", async () => {
    const edit = (await run("<h2>", "gap", "space-4", "", ""))!;
    expect(readDeclarations(edit.texts["src/Card.css"], "card__h2")).toEqual({ gap: "var(--space-4)" });
  });

  it("writes and reads a state", async () => {
    const edit = (await run('<div className="card">', "bg", "primary", "hover:"))!;
    expect(edit.texts["src/Card.css"]).toContain(".card:hover {");
    expect(readDeclarations(edit.texts["src/Card.css"], "card", "hover:")).toEqual({ "background-color": "var(--primary)" });
    expect(readDeclarations(edit.texts["src/Card.css"], "card")).toEqual({ padding: "16px" });
    expect(edit.summary).toBe("div: hover background none → primary");
    const md = (await run('<div className="card">', "p", "32px", "md:"))!;
    expect(md.texts["src/Card.css"]).toContain("@media (min-width: 768px)");
  });

  it("takes a value away, and a rule with nothing left", async () => {
    const edit = (await run('<p className="card__text">', "text-color", null))!;
    expect(edit.texts["src/Card.css"]).not.toContain("card__text");
    expect(Object.keys(edit.texts)).toEqual(["src/Card.css"]);
  });

  it("changes nothing when there is nothing to change", async () => {
    expect((await run('<div className="card">', "p", "16px"))!.texts).toEqual({});
    expect((await run("<h2>", "p", null))!.texts).toEqual({});
  });

  it("refuses an element whose classes are computed, and a state it can't write", async () => {
    await expect(run('<p className={cn("card__text", open && "open")}>', "p", "8px")).resolves.toBeDefined();
    const computed = `import "./C.css";\nexport const C = ({ c }: { c: string }) => <div className={c}>x</div>;\n`;
    await expect(run("<div", "p", "8px", "", CSS, computed)).rejects.toThrow(/computed|can't/);
    await expect(run('<div className="card">', "p", "8px", "focus-within:")).rejects.toThrow(/can't be written in CSS/);
  });

  it("refuses a value that could break the stylesheet", async () => {
    await expect(run('<div className="card">', "p", "[1px;_} body {]")).rejects.toThrow(/can't be written/);
  });

  it("adds the class to a cn() string", async () => {
    const code = CODE.replace('<h2>Title</h2>', '<h2 className={cn("x")}>Title</h2>');
    const edit = (await run('<h2 className={cn("x")}>', "p", "8px", "", CSS, code))!;
    expect(edit.texts["src/Card.tsx"]).toContain('<h2 className={cn("x card__h2")}>');
  });
});
