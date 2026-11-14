import { describe, expect, it } from "vitest";
import { metaOf, resolveClash } from "./engine";
import { itemHashes, itemsOf, mergeSection } from "./items";
import type { ProjectPayload } from "./payload";

const color = (id: string, value: string) => ({ id, name: `color-${id}`, value });
const page = (id: string, title: string, text = "") => ({ id, title, blocks: [{ text }] });
const payload = (over: Partial<ProjectPayload> = {}): ProjectPayload => ({
  name: "Acme",
  connection: null,
  tokenLink: null,
  tokens: { sets: [{ id: "s1", name: "Global" }], colors: [color("a", "#111"), color("b", "#222")], spacing: [{ id: "sp1", name: "space-1", value: 4 }] },
  docs: [page("p1", "Intro"), page("p2", "Guide")],
  ...over,
});
const tokens = (p: ProjectPayload) => p.tokens as { colors: { id: string; value: string }[]; spacing: unknown[]; sets: unknown[] };

describe("telling items apart", () => {
  it("keys tokens by list and id, and pages by id, with a hash of each", () => {
    const items = itemsOf(payload());
    expect(Object.keys(items.tokens).sort()).toEqual(["colors/a", "colors/b", "sets/s1", "spacing/sp1"]);
    expect(Object.keys(items.docs)).toEqual(["p1", "p2"]);
    expect(itemHashes("docs", [page("p1", "Intro")]).p1).toBe(items.docs.p1);
    expect(itemHashes("docs", [page("p1", "Changed")]).p1).not.toBe(items.docs.p1);
  });

  it("treats a value that isn't a list of items as one item, and a shape that isn't items as the whole", () => {
    expect(Object.keys(itemHashes("tokens", { version: 2, colors: [color("a", "#1")] })).sort()).toEqual(["$version", "colors/a"]);
    expect(Object.keys(itemHashes("docs", "text"))).toEqual(["$whole"]);
  });
});

describe("merging a section item by item", () => {
  const base = itemsOf(payload());

  it("takes an item changed on one side from that side, so different items by two people both survive", () => {
    const local = payload({ tokens: { ...payload().tokens, colors: [color("a", "#AAA"), color("b", "#222")] } });
    const server = payload({ tokens: { ...payload().tokens, colors: [color("a", "#111"), color("b", "#BBB")] } });
    const m = mergeSection("tokens", base.tokens, local.tokens, server.tokens);
    expect(m.conflicts).toEqual([]);
    expect(tokens({ tokens: m.withLocal } as ProjectPayload).colors.map((c) => c.value)).toEqual(["#AAA", "#BBB"]);
    expect(m.withServer).toEqual(m.withLocal);
  });

  it("keeps additions from both sides, with the server's order first", () => {
    const local = payload({ docs: [page("p1", "Intro"), page("p2", "Guide"), page("mine", "Mine")] });
    const server = payload({ docs: [page("theirs", "Theirs"), page("p1", "Intro"), page("p2", "Guide")] });
    const m = mergeSection("docs", base.docs, local.docs, server.docs);
    expect(m.conflicts).toEqual([]);
    expect((m.withLocal as { id: string }[]).map((p) => p.id)).toEqual(["theirs", "p1", "p2", "mine"]);
  });

  it("a deletion on one side is taken when the other side left the item alone", () => {
    const local = payload({ docs: [page("p1", "Intro")] });
    const server = payload({ docs: [page("p1", "Intro"), page("p2", "Guide edited")] });
    // Deleted here, edited there: that is a clash.
    expect(mergeSection("docs", base.docs, local.docs, server.docs).conflicts.map((c) => c.key)).toEqual(["p2"]);
    // Deleted here, untouched there: gone.
    const untouched = mergeSection("docs", base.docs, local.docs, payload().docs);
    expect(untouched.conflicts).toEqual([]);
    expect((untouched.withLocal as { id: string }[]).map((p) => p.id)).toEqual(["p1"]);
    // Deleted there, untouched here: gone.
    const there = mergeSection("docs", base.docs, payload().docs, payload({ docs: [page("p1", "Intro")] }).docs);
    expect((there.withLocal as { id: string }[]).map((p) => p.id)).toEqual(["p1"]);
  });

  it("the same item changed differently by both is a clash, named, and each side's version is kept for the choice", () => {
    const local = payload({ tokens: { ...payload().tokens, colors: [color("a", "#AAA"), color("b", "#222")] } });
    const server = payload({ tokens: { ...payload().tokens, colors: [color("a", "#SSS"), color("b", "#BBB")] } });
    const m = mergeSection("tokens", base.tokens, local.tokens, server.tokens);
    expect(m.conflicts).toEqual([{ section: "tokens", key: "colors/a", name: "color-a" }]);
    expect(tokens({ tokens: m.withLocal } as ProjectPayload).colors.map((c) => c.value)).toEqual(["#AAA", "#BBB"]);
    expect(tokens({ tokens: m.withServer } as ProjectPayload).colors.map((c) => c.value)).toEqual(["#SSS", "#BBB"]);
  });

  it("two people making the very same change isn't a clash", () => {
    const both = payload({ tokens: { ...payload().tokens, colors: [color("a", "#SAME"), color("b", "#222")] } });
    expect(mergeSection("tokens", base.tokens, both.tokens, both.tokens).conflicts).toEqual([]);
  });

  it("keeps lists that are empty, and the other parts of the tokens", () => {
    const local = payload({ tokens: { sets: [], colors: [], spacing: [], flag: true } });
    const server = payload();
    const m = mergeSection("tokens", base.tokens, local.tokens, server.tokens);
    const out = m.withLocal as Record<string, unknown>;
    expect(out.sets).toEqual([]);
    expect(out.colors).toEqual([]);
    expect(out.flag).toBe(true);
  });
});

describe("a clash between a project here and on the server", () => {
  const agreed = payload();
  const meta = metaOf(3, agreed);

  it("merges at once when two people changed different items of the same parts", () => {
    const local = payload({ tokens: { ...agreed.tokens, colors: [color("a", "#AAA"), color("b", "#222")] }, docs: [page("p1", "Intro here"), page("p2", "Guide")] });
    const server = payload({ tokens: { ...agreed.tokens, colors: [color("a", "#111"), color("b", "#BBB")] }, docs: [page("p1", "Intro"), page("p2", "Guide there")] });
    const r = resolveClash(meta, local, server, ["tokens", "docs"]);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    expect(tokens(r.payload).colors.map((c) => c.value)).toEqual(["#AAA", "#BBB"]);
    expect((r.payload.docs as { title: string }[]).map((p) => p.title)).toEqual(["Intro here", "Guide there"]);
  });

  it("asks only about the items both changed, with everything else already merged", () => {
    const local = payload({ tokens: { ...agreed.tokens, colors: [color("a", "#AAA"), color("b", "#222")] }, docs: [page("p1", "Intro here"), page("p2", "Guide")] });
    const server = payload({ tokens: { ...agreed.tokens, colors: [color("a", "#SSS"), color("b", "#222")] }, docs: [page("p1", "Intro"), page("p2", "Guide there")] });
    const r = resolveClash(meta, local, server, ["tokens", "docs"]);
    expect(r.kind).toBe("conflict");
    if (r.kind !== "conflict") return;
    expect(r.sections).toEqual([]);
    expect(r.items.map((i) => i.name)).toEqual(["color-a"]);
    // Whichever side is chosen for the clash, the docs of both people are kept.
    for (const side of [r.withLocal, r.withServer]) expect((side.docs as { title: string }[]).map((p) => p.title)).toEqual(["Intro here", "Guide there"]);
    expect(tokens(r.withLocal).colors[0].value).toBe("#AAA");
    expect(tokens(r.withServer).colors[0].value).toBe("#SSS");
  });

  it("still asks about a whole part when it has no item history, or isn't made of items (name, repository)", () => {
    const local = payload({ name: "Mine", tokens: { ...agreed.tokens, colors: [color("a", "#AAA"), color("b", "#222")] } });
    const server = payload({ name: "Theirs", tokens: { ...agreed.tokens, colors: [color("a", "#111"), color("b", "#BBB")] } });
    const r = resolveClash(meta, local, server, ["name", "tokens"]);
    expect(r.kind).toBe("conflict");
    if (r.kind !== "conflict") return;
    expect(r.sections).toEqual(["name"]);
    expect(r.withLocal.name).toBe("Mine");
    expect(r.withServer.name).toBe("Theirs");
    // The tokens, which don't clash item by item, are merged either way.
    expect(tokens(r.withServer).colors.map((c) => c.value)).toEqual(["#AAA", "#BBB"]);
    // Without a record of the items, the tokens clash as a whole part, as before.
    const old = resolveClash({ version: 3, hashes: meta.hashes }, local, server, ["tokens"]);
    expect(old.kind === "conflict" && old.sections).toEqual(["tokens"]);
    expect(resolveClash(null, local, server, ["name", "tokens"]).kind).toBe("conflict");
  });

  it("takes a part only the server (or only this device) changed from that side", () => {
    const local = payload({ name: "Mine", tokens: { ...agreed.tokens, colors: [color("a", "#AAA"), color("b", "#222")] } });
    const server = payload({ docs: [page("p1", "Intro"), page("p2", "Guide there")], tokens: { ...agreed.tokens, colors: [color("a", "#111"), color("b", "#BBB")] } });
    const r = resolveClash(meta, local, server, ["tokens"]);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    expect(r.payload.name).toBe("Mine");
    expect((r.payload.docs as { title: string }[])[1].title).toBe("Guide there");
  });
});
