import { describe, expect, it } from "vitest";
import { elementTree, pathTo } from "./tree";

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
