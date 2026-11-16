// A project's tokens are saved as tokens and compositions (lib/tokens/model.ts). The suites that look at what was saved read them as the
// five lists the token store holds (colors, spacing, radii, shadows, typography), which is what these say; `colorOf` / `numberOf` are for
// the scripts that edit the saved tokens in the browser (they are given as text, so they can't import: the same lookups are in
// `editSource`).

const ALL = "*";

function legacyView(stored) {
  const tokens = stored.tokens ?? [];
  const colorTokens = tokens.filter((t) => t.type === "color");
  const byId = new Map(colorTokens.map((t) => [t.id, t]));
  const keyOf = (t) => t.repoName ?? t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const colors = colorTokens.map((t) => {
    const themeAlias = {};
    for (const [theme, id] of Object.entries(t.ref ?? {})) if (byId.has(id)) themeAlias[theme] = keyOf(byId.get(id));
    return { id: t.id, name: t.name, value: t.value, group: t.group, setId: t.setId, themeValues: t.values, ...(Object.keys(themeAlias).length ? { themeAlias } : {}), ...(t.repoName ? { repoName: t.repoName } : {}) };
  });
  const lengths = (use) => tokens.filter((t) => t.type === "number" && t.use === use).map((t) => ({ id: t.id, name: t.name, value: parseFloat(t.values[ALL]), setId: t.setId, ...(t.group ? { group: t.group } : {}), ...(t.repoName ? { repoName: t.repoName } : {}) }));
  const slot = (c, name) => c.slots.find((s) => s.name === name)?.value;
  const shadows = (stored.compositions ?? []).filter((c) => c.kind === "shadow").map((c) => ({ id: c.id, name: c.name, setId: c.setId, group: c.group, x: parseFloat(slot(c, "x")), y: parseFloat(slot(c, "y")), blur: parseFloat(slot(c, "blur")), spread: parseFloat(slot(c, "spread")), color: slot(c, "color"), ...(c.repoName ? { repoName: c.repoName } : {}) }));
  const typography = (stored.compositions ?? []).filter((c) => c.kind === "typography").map((c) => ({ id: c.id, name: c.name, setId: c.setId, fontFamily: slot(c, "font-family"), fontSize: parseFloat(slot(c, "font-size")), fontWeight: parseFloat(slot(c, "font-weight")), lineHeight: parseFloat(slot(c, "line-height")) }));
  return { sets: stored.sets, colors, spacing: lengths("spacing"), radii: lengths("radius"), shadows, typography };
}

module.exports = { legacyView, ALL };
