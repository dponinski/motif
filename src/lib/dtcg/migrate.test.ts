import { describe, expect, it } from "vitest";
import { finalizeTokens, newAccumulator, scanCss } from "../repo-scan/tokens";
import { readMotifTokens } from "../token-sync/doc";
import type { TokenLink } from "../token-sync/flow";
import { fromStored } from "../tokens/migrate";
import type { StoredTokenData } from "../tokens/model";
import { ALL_THEMES } from "../tokens/model";
import { convertTokens } from "./convert";
import { migrateStylesheetLink } from "./migrate";

const CSS = `@import "tailwindcss";

:root {
  --radius: 0.5rem;
  --background: oklch(1 0 0);
  --primary: oklch(0.55 0.2 260);
}

.dark {
  --background: oklch(0.145 0 0);
  --primary: oklch(0.7 0.15 260);
}

@theme {
  --color-brand: #4f46e5;
  --spacing-18: 4.5rem;
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.1);
}
`;

async function setup() {
  const acc = newAccumulator();
  await scanCss([{ path: "src/app.css", text: CSS }], acc, []);
  const found = finalizeTokens(acc);
  const conversion = { ...convertTokens({ tokens: found.tokens, themes: found.themes, tailwind: true, name: "acme", dir: "src/tokens", output: "src/styles/tokens.css" })!, dir: "src/tokens", output: "src/styles/tokens.css", tailwind: true };
  // The project as the old link left it: the same tokens, one set, and a link whose base is what they were at the last sync.
  const legacy: StoredTokenData = JSON.parse(JSON.stringify(conversion.model));
  // (What the old link imported: the repository's own names, and lengths in px.)
  for (const t of legacy.tokens) {
    if (t.repoName?.startsWith("dtcg:")) t.repoName = t.repoName.slice(5);
    else if (t.use === "spacing") t.repoName = `spacing-${t.name}`;
    if (t.type === "number" && (t.use === "radius" || t.use === "spacing") && t.unit === "rem") { t.values[ALL_THEMES] = String(parseFloat(t.values[ALL_THEMES]) * 16); t.unit = "px"; }
  }
  const set = legacy.sets[0];
  const themes = Object.fromEntries(set.themes.map((t) => [t.repoKey ?? t.name.toLowerCase(), t.id]));
  const link: TokenLink = { repo: "acme/ds", branch: "main", setId: set.id, themes, prefixes: { color: "color-", radius: "radius-", spacing: "spacing-", shadow: "shadow-" }, baseTheme: Object.keys(themes)[0], base: {}, staged: null, syncedAt: 0 };
  const slices = () => { const d = fromStored(legacy); return { colors: d.colors, spacing: d.spacing, radii: d.radii, shadows: d.shadows }; };
  link.base = readMotifTokens(slices(), link);
  return { conversion, legacy, link, slices, set };
}

describe("moving a stylesheet link to design tokens files", () => {
  it("is the repository's tokens again when nothing was waiting, with the files as what they come to", async () => {
    const { conversion, legacy, link, slices } = await setup();
    const out = migrateStylesheetLink({ link, slices: slices(), legacy, conversion, repo: "acme/ds" });
    expect(out.carried).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(out.link.format).toBe("dtcg");
    expect(out.link.base).toEqual(conversion.files);
    expect(out.link.convert?.converted).toEqual(conversion.converted);
    expect(out.data.tokens.map((t) => t.name).sort()).toEqual(conversion.model.tokens.map((t) => t.name).sort());
  });

  it("keeps what was made and changed here and not sent", async () => {
    const { conversion, legacy, link, slices, set } = await setup();
    const light = set.themes[0].id;
    // A color changed, a color made, a Number and a String made (which the old link never carried), a token of another set, one deleted.
    const primary = legacy.tokens.find((t) => t.name === "primary")!;
    primary.values[light] = "#112233"; primary.value = "#112233";
    legacy.tokens.push({ id: "t-new", name: "accent", setId: set.id, type: "color", values: { [light]: "#ff00aa" }, value: "#ff00aa" } as never);
    legacy.tokens.push({ id: "t-num", name: "scale", setId: set.id, type: "number", values: { [ALL_THEMES]: "12" }, unit: "px" } as never);
    legacy.tokens.push({ id: "t-str", name: "family", setId: set.id, type: "string", values: { [ALL_THEMES]: "Inter" } } as never);
    legacy.sets.push({ id: "set-other", name: "Other", themes: [{ id: "th-o", name: "Default" }], activeThemeId: "th-o" } as never);
    legacy.tokens.push({ id: "t-other", name: "ink", setId: "set-other", type: "color", values: { "th-o": "#000000" }, value: "#000000" } as never);
    const gone = legacy.tokens.findIndex((t) => t.name === "brand");
    legacy.tokens.splice(gone, 1);

    const out = migrateStylesheetLink({ link, slices: slices(), legacy, conversion, repo: "acme/ds" });
    expect(out.carried.changed).toBe(1);
    expect(out.carried.added).toBe(1);
    expect(out.carried.removed).toBe(1);
    const names = out.data.tokens.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["accent", "scale", "family", "ink", "primary"]));
    expect(names).not.toContain("brand");
    const main = out.data.sets[0];
    expect(out.data.tokens.find((t) => t.name === "primary")!.values[main.themes[0].id]).toBe("#112233");
    // The ones made here are in the repository's set, in its themes; the other set is as it was.
    expect(out.data.tokens.find((t) => t.name === "accent")!.setId).toBe(main.id);
    expect(Object.keys(out.data.tokens.find((t) => t.name === "accent")!.values)).toEqual([main.themes[0].id]);
    expect(out.data.tokens.find((t) => t.name === "scale")!.values[ALL_THEMES]).toBe("12");
    expect(out.data.tokens.find((t) => t.name === "ink")!.setId).toBe("set-other");
    expect(out.data.sets.map((s) => s.id)).toContain("set-other");
  });

  it("puts a changed length into the token in the unit the repository has", async () => {
    const { conversion, legacy, link, slices } = await setup();
    // Here lengths are px; the repository wrote this one in rem.
    legacy.tokens.find((t) => t.use === "spacing")!.values[ALL_THEMES] = "80";
    const out = migrateStylesheetLink({ link, slices: slices(), legacy, conversion, repo: "acme/ds" });
    expect(out.carried.changed).toBe(1);
    const token = out.data.tokens.find((t) => t.use === "spacing")!;
    expect(conversion.model.tokens.find((t) => t.use === "spacing")!.unit).toBe("rem");
    expect(token.unit).toBe("rem");
    expect(token.values[ALL_THEMES]).toBe("5");
  });
});
