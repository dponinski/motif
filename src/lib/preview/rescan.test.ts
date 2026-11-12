import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memoryReader, memorySource, scanRepository } from "../repo-scan";
import { addVariantOption, setVariantDefault } from "../edit/props";
import { toLibrary } from "./library";
import { rescanComponent } from "./rescan";

describe("reading a component again from edited text", async () => {
  const files = loadFixture("motif-test-system");
  const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" });
  const badge = toLibrary(analysis.components).find((c) => c.name === "Badge")!;
  const input = (overlay: Record<string, string>) => ({ reader: memoryReader(files), ref: "main", paths: Object.keys(files), overlay, component: badge });

  it("returns the same component when nothing was edited", async () => {
    const same = await rescanComponent(input({}));
    expect(same?.variants).toEqual(badge.variants);
    expect(same?.props).toEqual(badge.props);
  });

  it("sees an option and a default that were only written in memory", async () => {
    let text = (await addVariantOption(badge.file, files[badge.file], "variant", "ghost")).code;
    text = (await setVariantDefault(badge.file, text, "variant", "ghost")).code;
    const next = (await rescanComponent(input({ [badge.file]: text })))!;
    const variant = next.variants.find((v) => v.name === "variant")!;
    expect(variant.options).toContain("ghost");
    expect(variant.default).toBe("ghost");
    // What the scan of one file can't know is kept.
    expect(next.id).toBe(badge.id);
    expect(next.support).toEqual(badge.support);
    expect(next.public).toBe(badge.public);
    // The repository's own file is as it was.
    expect(files[badge.file]).not.toContain("ghost");
  });

  it("gives up cleanly on text that doesn't parse or a component that is gone", async () => {
    expect(await rescanComponent(input({ [badge.file]: "export const = ;" }))).toBeNull();
    expect(await rescanComponent(input({ [badge.file]: "export const Other = () => <i />;" }))).toBeNull();
  });
});
