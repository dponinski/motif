import { describe, expect, it } from "vitest";
import { readDtcg } from "./read";
import { stringify, writeDtcg } from "./write";
import { fixture } from "./fixture";

const json = (o: unknown) => JSON.stringify(o);

describe("writing", () => {
  it("puts the components of a color on one line", () => {
    const text = stringify({ a: { components: [0.1, 0.2, 0.3], list: ["x", "y"] } });
    expect(text).toContain('"components": [0.1, 0.2, 0.3]');
    expect(text).toContain('"list": ["x", "y"]');
    expect(JSON.parse(text)).toEqual({ a: { components: [0.1, 0.2, 0.3], list: ["x", "y"] } });
  });

  it("writes one file for all the sets, or a file for each, with the base values in it and the other themes in files of their own", () => {
    const single = writeDtcg(fixture(), { files: "single" }).files;
    expect(Object.keys(single).sort()).toEqual(["src/tokens/tokens.config.json", "src/tokens/tokens.dark.json", "src/tokens/tokens.json"]);
    const each = writeDtcg(fixture(), { files: "per-set" }).files;
    expect(Object.keys(each).sort()).toEqual(["src/tokens/primitives.dark.json", "src/tokens/primitives.json", "src/tokens/semantic.dark.json", "src/tokens/semantic.json", "src/tokens/tokens.config.json"]);
  });

  it("writes a theme file with only what is different from the base", () => {
    const dark = JSON.parse(writeDtcg(fixture(), { files: "per-set" }).files["src/tokens/semantic.dark.json"]);
    // `surface` is gray-50 in both themes; `text` is gray-900 in Light and white in Dark.
    expect(Object.keys(dark.color)).toEqual(["text"]);
    expect(dark.color.text.$value.hex).toBe("#ffffff");
  });

  it("makes a color that is another token a reference, in any set", () => {
    const sem = JSON.parse(writeDtcg(fixture(), { files: "per-set" }).files["src/tokens/semantic.json"]);
    expect(sem.color.surface).toMatchObject({ $type: "color", $value: "{color.gray-50}" });
  });

  it("writes compositions as the composite types, with their parts as references", () => {
    const sem = JSON.parse(writeDtcg(fixture(), { files: "per-set" }).files["src/tokens/semantic.json"]);
    expect(sem.text.heading).toMatchObject({ $type: "typography", $value: { fontFamily: "{font.sans}", fontSize: "{text.xl}", fontWeight: "{font-weight.bold}", lineHeight: 1.2, letterSpacing: { value: -0.5, unit: "px" } } });
    expect(sem.shadow.card).toMatchObject({ $type: "shadow", $value: { color: "{color.overlay}", offsetY: { value: 4, unit: "px" }, inset: true } });
    expect(sem.composition.badge.background).toMatchObject({ $type: "color", $value: "{color.brand}" });
    expect(sem.composition.badge["padding-x"]).toMatchObject({ $value: "{spacing.4}" });
  });

  it("leaves a token out when another has its path, and says so", () => {
    const data = fixture();
    data.tokens.push({ ...data.tokens.find((t) => t.id === "brand")!, id: "brand2", setId: "set-sem" });
    const w = writeDtcg(data);
    expect(w.skipped).toEqual([{ name: "brand", reason: "Another token is already color.brand" }]);
  });

  it("leaves out a color it can't write", () => {
    const data = fixture();
    const t = data.tokens.find((x) => x.id === "overlay")!;
    t.values = { [data.sets[0].themes[0].id]: "color-mix(in srgb, red, blue)", [data.sets[0].themes[1].id]: "#fff" };
    expect(writeDtcg(data).skipped[0]).toMatchObject({ name: "overlay" });
  });

  it("writes the config: layout, output, the sets with their themes and a selector for each other theme", () => {
    const { config } = writeDtcg(fixture(), { files: "per-set", output: "styles/tokens.css", tailwind: false });
    expect(config).toEqual({
      files: "per-set", output: "styles/tokens.css", tailwind: false, selectors: { dark: ".dark" },
      sets: [
        { name: "Primitives", key: "primitives", description: "Raw values", themes: [{ key: "light", name: "Light" }, { key: "dark", name: "Dark" }] },
        { name: "Semantic", key: "semantic", themes: [{ key: "light", name: "Light" }, { key: "dark", name: "Dark" }] },
      ],
    });
  });
});

describe("reading a repository's own files", () => {
  const read = (files: Record<string, unknown>) => readDtcg(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, json(v)])));

  it("reads tokens with the type their group gives them, and names them by their path", () => {
    const { data, notes } = read({ "tokens/base.json": {
      color: { $type: "color", brand: { $value: { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" } } },
      spacing: { $type: "dimension", "4": { $value: { value: 16, unit: "px" } }, nested: { sm: { $value: "0.5rem" } } },
    } });
    expect(notes).toEqual([]);
    expect(data.sets).toHaveLength(1);
    expect(data.tokens.map((t) => [t.name, t.type, t.use, t.unit])).toEqual([["brand", "color", "color", undefined], ["4", "number", "spacing", "px"], ["nested-sm", "number", "spacing", "rem"]]);
    expect(data.tokens[0].values[data.sets[0].themes[0].id]).toBe("#ff0000");
  });

  it("follows a reference into another file, and is the color it comes to", () => {
    const { data } = read({
      "tokens/primitives.json": { color: { gray: { $type: "color", $value: { colorSpace: "oklch", components: [0.9, 0.01, 250] } } } },
      "tokens/semantic.json": { color: { surface: { $type: "color", $value: "{color.gray}" } } },
    });
    expect(data.sets.map((s) => s.name)).toEqual(["Primitives", "Semantic"]);
    const [gray, surface] = data.tokens;
    expect(surface.ref).toEqual({ [data.sets[1].themes[0].id]: gray.id });
    expect(surface.values[data.sets[1].themes[0].id]).toBe("oklch(0.9 0.01 250)");
  });

  it("follows a reference of a number or a string to its value, since Motif keeps those as values", () => {
    const { data } = read({ "tokens/tokens.json": {
      spacing: { base: { $type: "dimension", $value: { value: 4, unit: "px" } }, gap: { $type: "dimension", $value: "{spacing.base}" } },
      font: { sans: { $type: "fontFamily", $value: ["Inter", "sans-serif"] }, body: { $type: "fontFamily", $value: "{font.sans}" } },
    } });
    expect(data.tokens.find((t) => t.name === "gap")!.values["*"]).toBe("4");
    expect(data.tokens.find((t) => t.name === "body")!.values["*"]).toBe("Inter, sans-serif");
  });

  it("says what it can't keep", () => {
    const { data, notes } = read({ "tokens/tokens.json": {
      a: { $type: "gradient", $value: [] },
      color: { bad: { $type: "color", $value: { colorSpace: "lab", components: [50, 10, 10] } }, dangling: { $type: "color", $value: "{color.nothing}" } },
    } });
    expect(data.tokens).toEqual([]);
    expect(notes).toHaveLength(3);
  });

  it("keeps the id of a token that is already there, found by its set and path", () => {
    const stored = fixture();
    const { data } = readDtcg(writeDtcg(stored).files, stored);
    expect(data.tokens.map((t) => t.id).sort()).toEqual(stored.tokens.map((t) => t.id).sort());
    const fresh = readDtcg(writeDtcg(stored).files).data;
    expect(fresh.tokens.some((t) => t.id === "g50")).toBe(false);
    expect(fresh.tokens).toHaveLength(stored.tokens.length);
  });

  it("reads themes from the files when there's no config", () => {
    const { data } = read({
      "tokens/tokens.json": { color: { bg: { $type: "color", $value: { colorSpace: "srgb", components: [1, 1, 1] } } } },
      "tokens/tokens.dark.json": { color: { bg: { $value: { colorSpace: "srgb", components: [0, 0, 0] } } } },
    });
    expect(data.sets[0].themes.map((t) => t.name)).toEqual(["Default", "Dark"]);
    const [light, dark] = data.sets[0].themes;
    expect(data.tokens[0].values).toEqual({ [light.id]: "#ffffff", [dark.id]: "#000000" });
  });

  it("is told when a file isn't JSON", () => {
    const { notes } = readDtcg({ "tokens/x.json": "{nope" });
    expect(notes).toEqual(["tokens/x.json isn't valid JSON"]);
  });
});
