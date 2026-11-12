import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import { addProp, addVariantGroup, addVariantOption, checkParses, literalFor, removeProp, removeVariantOption, renameVariantOption, setPropDefault, setVariantDefault } from "./props";

const files = loadFixture("motif-test-system");
const badge = files["src/components/Badge.tsx"];
const button = files["src/components/Button.tsx"];
const alert = files["src/components/Alert.tsx"];
const avatar = files["src/components/Avatar.tsx"];

const lines = (a: string, b: string) => a.split("\n").map((l, i) => [l, b.split("\n")[i]]);
void lines;

describe("variant options", () => {
  it("adds an option that looks like the default until it is changed, one line in the file", async () => {
    const out = await addVariantOption("Badge.tsx", badge, "variant", "ghost");
    expect(out.code).toContain('        outline: "border border-border text-foreground",\n        ghost: "bg-muted text-foreground",\n      },');
    expect(out.code.split("\n").length).toBe(badge.split("\n").length + 1);
    expect(out.summary).toBe("variant: added option ghost");
    await expect(checkParses("Badge.tsx", out.code)).resolves.toBeUndefined();
    const copied = await addVariantOption("Badge.tsx", badge, "variant", "soft", "danger");
    expect(copied.code).toContain('soft: "bg-danger/12 text-danger",');
  });

  it("quotes a name that isn't an identifier", async () => {
    const out = await addVariantOption("Badge.tsx", badge, "variant", "extra-large");
    expect(out.code).toContain('"extra-large": "bg-muted text-foreground",');
  });

  it("refuses a name that is taken, malformed, or a group that isn't there", async () => {
    await expect(addVariantOption("Badge.tsx", badge, "variant", "danger")).rejects.toThrow(/already has an option/);
    await expect(addVariantOption("Badge.tsx", badge, "variant", "has space")).rejects.toThrow(/can't be an option name/);
    await expect(addVariantOption("Badge.tsx", badge, "tone", "x")).rejects.toThrow(/no variant group called tone/);
  });

  it("removes an option and its line, but never the default or the last one", async () => {
    const out = await removeVariantOption("Badge.tsx", badge, "variant", "outline");
    expect(out.code).not.toContain("outline");
    expect(out.code.split("\n").length).toBe(badge.split("\n").length - 1);
    await expect(removeVariantOption("Badge.tsx", badge, "variant", "neutral")).rejects.toThrow(/is the default/);
    await expect(removeVariantOption("Badge.tsx", badge, "variant", "nope")).rejects.toThrow(/no option called nope/);
    const alone = 'import { cva } from "class-variance-authority";\nconst v = cva("a", { variants: { size: { only: "x" } } });\n';
    await expect(removeVariantOption("v.ts", alone, "size", "only")).rejects.toThrow(/at least one option/);
  });

  it("removes an option from a single-line group", async () => {
    const one = 'import { cva } from "class-variance-authority";\nconst v = cva("a", { variants: { size: { sm: "x", md: "y", lg: "z" } } });\n';
    expect((await removeVariantOption("v.ts", one, "size", "lg")).code).toContain('size: { sm: "x", md: "y" }');
    expect((await removeVariantOption("v.ts", one, "size", "sm")).code).toContain('size: { md: "y", lg: "z" }');
  });

  it("renames an option and the default that names it", async () => {
    const out = await renameVariantOption("Badge.tsx", badge, "variant", "neutral", "plain");
    expect(out.code).toContain('plain: "bg-muted text-foreground",');
    expect(out.code).toContain('defaultVariants: { variant: "plain" }');
    expect(out.code).not.toContain("neutral");
  });

  it("won't rename an option that something else in the file is keyed by", async () => {
    await expect(renameVariantOption("Alert.tsx", alert, "variant", "info", "note")).rejects.toThrow(/also used on line \d+/);
  });
});

describe("variant defaults", () => {
  it("changes, removes and adds a default", async () => {
    const changed = await setVariantDefault("Badge.tsx", badge, "variant", "danger");
    expect(changed.code).toContain('defaultVariants: { variant: "danger" }');
    expect(changed.summary).toBe("variant: default neutral → danger");
    const removed = await setVariantDefault("Badge.tsx", badge, "variant", null);
    expect(removed.code).not.toContain("defaultVariants");
    expect(removed.code.split("\n").length).toBe(badge.split("\n").length - 1);
    const none = 'import { cva } from "class-variance-authority";\nconst v = cva("a", {\n  variants: { size: { sm: "x", md: "y" } },\n});\n';
    const added = await setVariantDefault("v.ts", none, "size", "md");
    expect(added.code).toContain('  variants: { size: { sm: "x", md: "y" } },\n  defaultVariants: { size: "md" },\n');
    await expect(setVariantDefault("Badge.tsx", badge, "variant", "nope")).rejects.toThrow(/no option called nope/);
  });

  it("adds a default beside the others in the same object", async () => {
    const out = await setVariantDefault("Button.tsx", button, "size", "lg");
    expect(out.code).toContain('defaultVariants: { variant: "primary", size: "lg" }');
  });
});

describe("variant groups", () => {
  it("adds a group and passes it from the component to the cva call", async () => {
    const out = await addVariantGroup("Badge.tsx", badge, "badgeVariants", "tone", "soft");
    expect(out.code).toContain('        outline: "border border-border text-foreground",\n      },\n      tone: {\n        soft: "",\n      },\n    },');
    expect(out.code).toContain("export function Badge({ className, variant, tone, ...props }: BadgeProps)");
    expect(out.code).toContain("badgeVariants({ variant, tone })");
    await expect(checkParses("Badge.tsx", out.code)).resolves.toBeUndefined();
    expect(out.summary).toBe("badgeVariants: added variant group tone");
  });

  it("refuses what it can't wire in", async () => {
    await expect(addVariantGroup("Badge.tsx", badge, "badgeVariants", "variant", "x")).rejects.toThrow(/already has a group/);
    await expect(addVariantGroup("Badge.tsx", badge, "badgeVariants", "class", "x")).rejects.toThrow(/can't be a prop name/);
    await expect(addVariantGroup("Badge.tsx", badge, "other", "tone", "x")).rejects.toThrow(/no cva call called other/);
    const props = badge.replace("({ className, variant, ...props }: BadgeProps)", "(props: BadgeProps)").replace("badgeVariants({ variant })", "badgeVariants({})");
    await expect(addVariantGroup("Badge.tsx", props, "badgeVariants", "tone", "x")).rejects.toThrow(/aren't destructured/);
    const bare = badge.replace("badgeVariants({ variant })", "badgeVariants()");
    await expect(addVariantGroup("Badge.tsx", bare, "badgeVariants", "tone", "x")).rejects.toThrow(/without an object/);
  });

  it("wires a group into a component whose props are spread across lines", async () => {
    const out = await addVariantGroup("Button.tsx", button, "buttonVariants", "tone", "soft");
    expect(out.code).toContain("({ className, variant, size, loading, disabled, children, type = \"button\", tone, ...props }, ref)");
    expect(out.code).toContain("buttonVariants({ variant, size, tone })");
    await expect(checkParses("Button.tsx", out.code)).resolves.toBeUndefined();
  });
});

describe("plain props", () => {
  it("adds a prop to the interface and the parameters, with its default", async () => {
    const out = await addProp("Avatar.tsx", avatar, "Avatar", "ring", "boolean", "false");
    expect(out.code).toContain("  className?: string;\n  ring?: boolean;\n}");
    expect(out.code).toContain('export function Avatar({ name, src, size = "md", className, ring = false }: AvatarProps)');
    await expect(checkParses("Avatar.tsx", out.code)).resolves.toBeUndefined();
    const noDefault = await addProp("Avatar.tsx", avatar, "Avatar", "label", "string", null);
    expect(noDefault.code).toContain("className, label }: AvatarProps)");
  });

  it("adds a prop to an interface with an empty body, and one written with commas", async () => {
    const empty = await addProp("Badge.tsx", badge, "Badge", "dot", "boolean", "true");
    expect(empty.code).toContain("VariantProps<typeof badgeVariants> {\n  dot?: boolean;\n}");
    expect(empty.code).toContain("{ className, variant, dot = true, ...props }");
    const commas = "interface P { a: string, b?: number }\nexport function C({ a, b }: P) { return <i>{a}{b}</i>; }\n";
    const out = await addProp("C.tsx", commas, "C", "c", "number", "3");
    expect(out.code).toContain("interface P { a: string, b?: number, c?: number }");
    expect(out.code).toContain("{ a, b, c = 3 }: P");
  });

  it("refuses a name that exists or is reserved, and props it can't reach", async () => {
    await expect(addProp("Avatar.tsx", avatar, "Avatar", "size", "string", null)).rejects.toThrow(/already has a prop/);
    await expect(addProp("Avatar.tsx", avatar, "Avatar", "children", "string", null)).rejects.toThrow(/can't be a prop name/);
    await expect(addProp("Avatar.tsx", avatar, "Missing", "x", "string", null)).rejects.toThrow(/Couldn't find a component/);
    await expect(addProp("A.tsx", "export const A = (props: { a: string }) => <i />;", "A", "b", "string", null)).rejects.toThrow(/aren't destructured/);
  });

  it("removes a prop that is not used, and says where one that is used is", async () => {
    const unused = avatar.replace("src && !failed", "!failed").replace("src={src}", "");
    const out = await removeProp("Avatar.tsx", unused, "Avatar", "src");
    expect(out.code).not.toContain("src?: string");
    expect(out.code).toContain('export function Avatar({ name, size = "md", className }: AvatarProps)');
    await expect(removeProp("Avatar.tsx", avatar, "Avatar", "src")).rejects.toThrow(/still used on line \d+/);
    await expect(removeProp("Avatar.tsx", avatar, "Avatar", "onClick")).rejects.toThrow(/isn't declared in Avatar's own props/);
  });

  it("changes and removes the default in the parameters", async () => {
    const out = await setPropDefault("Avatar.tsx", avatar, "Avatar", "size", '"lg"');
    expect(out.code).toContain('size = "lg"');
    expect(out.summary).toBe('Avatar: default of size "md" → "lg"');
    expect((await setPropDefault("Avatar.tsx", avatar, "Avatar", "size", null)).code).toContain("{ name, src, size, className }");
    expect((await setPropDefault("Avatar.tsx", avatar, "Avatar", "src", '"x.png"')).code).toContain('src = "x.png"');
    await expect(setPropDefault("Avatar.tsx", avatar, "Avatar", "missing", '"x"')).rejects.toThrow(/isn't taken from/);
  });

  it("writes a value for a type, and refuses one that isn't", () => {
    expect(literalFor("string", 'a "b"')).toBe('"a \\"b\\""');
    expect(literalFor("number", " 3.5 ")).toBe("3.5");
    expect(literalFor("number", "abc")).toBeNull();
    expect(literalFor("boolean", "true")).toBe("true");
    expect(literalFor("boolean", "yes")).toBeNull();
  });
});

describe("the scanner reads what an edit wrote", () => {
  it("sees the new option, default, group and prop in the edited files", async () => {
    let text = (await addVariantOption("src/components/Badge.tsx", badge, "variant", "ghost")).code;
    text = (await setVariantDefault("src/components/Badge.tsx", text, "variant", "ghost")).code;
    text = (await addVariantGroup("src/components/Badge.tsx", text, "badgeVariants", "tone", "soft")).code;
    text = (await addProp("src/components/Badge.tsx", text, "Badge", "dot", "boolean", "false")).code;
    const analysis = await scanRepository(memorySource({ ...files, "src/components/Badge.tsx": text }), { repo: "a/b", ref: "main" });
    const component = analysis.components.find((c) => c.name === "Badge")!;
    const variant = component.variants.find((v) => v.name === "variant")!;
    expect(variant.options).toContain("ghost");
    expect(variant.default).toBe("ghost");
    expect(component.variants.find((v) => v.name === "tone")?.options).toEqual(["soft"]);
    expect(component.props.find((p) => p.name === "dot")).toMatchObject({ type: "boolean", default: "false" });
  });
});
