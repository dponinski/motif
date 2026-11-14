import { describe, expect, it } from "vitest";
import { elementTree, pathTo, relatives } from "./tree";

const SOURCE = `import { Icon } from "./icon";

function helper() {
  return <i>not this</i>;
}

export function Card({ title, items, open }) {
  return (
    <section className="p-4">
      <h2 className="text-lg">{title}</h2>
      {open && <p>Open</p>}
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <Icon name="x" />
      <>
        <small>fine print</small>
      </>
    </section>
  );
}
`;

const shape = (nodes: Awaited<ReturnType<typeof elementTree>>): unknown =>
  nodes.map((n) => (n.children.length ? { [n.tag]: shape(n.children) } : n.tag));

describe("elementTree", () => {
  it("shows what the component renders, nested as written", async () => {
    const tree = await elementTree("Card.tsx", SOURCE, "Card");
    expect(shape(tree)).toEqual([{ section: ["h2", "p", { ul: ["li"] }, "Icon", "small"] }]);
  });

  it("leaves out other components in the file", async () => {
    const tree = await elementTree("Card.tsx", SOURCE, "Card");
    expect(JSON.stringify(tree)).not.toContain('"i"');
  });

  it("marks plain elements as pickable and components as not", async () => {
    const [section] = await elementTree("Card.tsx", SOURCE, "Card");
    expect(section.selectable).toBe(true);
    expect(section.children.find((c) => c.tag === "Icon")?.selectable).toBe(false);
  });

  it("uses where the element starts in the source, as the preview does", async () => {
    const [section] = await elementTree("Card.tsx", SOURCE, "Card");
    expect(SOURCE.slice(section.start, section.start + 8)).toBe("<section");
    const h2 = section.children[0];
    expect(SOURCE.slice(h2.start, h2.start + 3)).toBe("<h2");
  });

  it("labels text elements with what they say", async () => {
    const [section] = await elementTree("Card.tsx", SOURCE, "Card");
    expect(section.children.find((c) => c.tag === "p")?.label).toBe("Open");
  });

  it("finds the path down to an element", async () => {
    const tree = await elementTree("Card.tsx", SOURCE, "Card");
    const li = tree[0].children[2].children[0];
    expect(pathTo(tree, li.start)).toEqual([tree[0].start, tree[0].children[2].start, li.start]);
    expect(pathTo(tree, 1)).toEqual([]);
  });

  it("works for arrow components and falls back to the whole file", async () => {
    const arrow = `export const Tag = ({ children }) => <span className="x">{children}</span>;\n`;
    expect(shape(await elementTree("Tag.tsx", arrow, "Tag"))).toEqual(["span"]);
    expect(shape(await elementTree("Tag.tsx", arrow, "Missing"))).toEqual(["span"]);
  });
});

describe("relatives", () => {
  it("says where the keyboard goes from an element", async () => {
    const tree = await elementTree("Card.tsx", SOURCE, "Card");
    const at = (tag: string, from = tree): number => {
      for (const n of from) { if (n.tag === tag) return n.start; const inner = n.children.length ? at(tag, n.children) : -1; if (inner >= 0) return inner; }
      return -1;
    };
    const section = at("section");
    const h2 = at("h2");
    const ul = at("ul");
    expect(relatives(tree, section)).toMatchObject({ parent: null, firstChild: h2, previous: null, next: null });
    expect(relatives(tree, h2)).toMatchObject({ parent: section, firstChild: null, previous: null });
    expect(relatives(tree, h2).next).toBe(at("p"));
    expect(relatives(tree, ul)).toMatchObject({ parent: section, firstChild: at("li") });
    expect(relatives(tree, ul).previous).toBe(at("p"));
  });

  it("skips what can't be picked, and knows nothing about an element that isn't there", async () => {
    const tree = await elementTree("Card.tsx", SOURCE, "Card");
    const section = tree[0];
    const icon = section.children.find((c) => c.tag === "Icon")!;
    expect(icon.selectable).toBe(false);
    // After the list comes a component (skipped), then what the fragment holds.
    const small = section.children.find((c) => c.tag === "small")!;
    expect(relatives(tree, section.children.find((c) => c.tag === "ul")!.start).next).toBe(small.start);
    expect(relatives(tree, small.start).previous).toBe(section.children.find((c) => c.tag === "ul")!.start);
    expect(relatives(tree, 99999)).toEqual({ parent: null, firstChild: null, previous: null, next: null });
  });
});
