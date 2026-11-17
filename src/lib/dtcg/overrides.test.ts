import { describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { dtcgOverrides } from "./overrides";
import { writeDtcg } from "./write";

const OPTS = { files: "single" as const, dir: "src/tokens", output: "src/styles/tokens.css", tailwind: true };
const linked = () => {
  const model = fixture();
  return { model, link: { ...OPTS, base: writeDtcg(model, OPTS).files } };
};
const edit = (m: ReturnType<typeof fixture>, id: string, theme: string, value: string) => ({
  ...m, tokens: m.tokens.map((t) => (t.id === id ? { ...t, values: { ...t.values, [theme]: value }, ...(theme === "p-l" ? { value } : {}) } : t)),
});

describe("what Motif changed, as CSS for a preview", () => {
  it("is nothing when the tokens are what the files say", () => {
    const { model, link } = linked();
    expect(dtcgOverrides(link, model)).toEqual({ css: "", changed: [], theme: "" });
  });

  it("puts a changed base color under :root, with the variable the files generate", () => {
    const { model, link } = linked();
    const out = dtcgOverrides(link, edit(model, "g50", "p-l", "#ff0000"));
    expect(out.css).toBe("html:root:not(.dark) {\n  --color-gray-50: #ff0000;\n}");
    expect(out.changed).toEqual(["color-gray-50"]);
    expect(out.theme).toBe("");
  });

  it("puts a change of another theme under that theme's selector", () => {
    const { model, link } = linked();
    const out = dtcgOverrides(link, edit(model, "g50", "p-d", "#000000"));
    expect(out.css).toBe("html.dark {\n  --color-gray-50: #000000;\n}");
  });

  it("follows the tokens that are that token", () => {
    const { model, link } = linked();
    const out = dtcgOverrides(link, edit(model, "g50", "p-l", "#ff0000"));
    // `--color-surface` is `var(--color-gray-50)`: it changes by itself, so it isn't listed.
    expect(out.changed).not.toContain("color-surface");
  });

  it("offers a token the repository doesn't have to Tailwind, in @theme", () => {
    const { model, link } = linked();
    const withNew = { ...model, tokens: [...model.tokens, { id: "n1", name: "new", setId: "set-prim", type: "color" as const, values: { "p-l": "#123456", "p-d": "#123456" }, value: "#123456", use: "color" }] };
    const out = dtcgOverrides(link, withNew);
    expect(out.css).toContain("--color-new: #123456;");
    expect(out.theme).toBe("@theme {\n  --color-new: #123456;\n}");
  });

  it("is every variable for a repository that has no files yet", () => {
    const { model } = linked();
    const out = dtcgOverrides({ ...OPTS, base: {} }, model);
    expect(out.changed).toContain("color-gray-50");
    expect(out.css.startsWith("html:root")).toBe(true);
  });
});
