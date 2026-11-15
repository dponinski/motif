import { describe, expect, it } from "vitest";
import { applyPlan, planDrafts, type Draft } from "./drafts";
import { emptyTokenData, type TokenData } from "../../store/design-system";

const L = "theme-default";
const base = (): TokenData => ({
  ...emptyTokenData(),
  colors: [
    { id: "c1", name: "primary-500", value: "#6366f1", group: "primary", setId: "set-global", themeValues: { [L]: "#6366f1" } },
    { id: "c2", name: "brand", value: "#1d4ed8", group: "base", setId: "set-global", themeValues: { [L]: "#1d4ed8" }, repoName: "brand" },
    { id: "c3", name: "other-set", value: "#000000", group: "base", setId: "set-other", themeValues: { x: "#000000" } },
  ],
  spacing: [{ id: "s1", name: "space-4", value: 16, setId: "set-global" }],
});
const color = (name: string, hex: string, extra: Partial<Draft> = {}): Draft => ({ kind: "color", name, values: { [L]: hex }, ...extra }) as Draft;

describe("planning what adding drafts would do", () => {
  it("calls a token that isn't there new, one with another value an update, one as it is the same", () => {
    const plan = planDrafts([color("fresh", "#111111"), color("primary-500", "#ff0000"), color("primary-500", "#6366f1")], base(), "set-global");
    expect(plan.map((p) => [p.status, p.action])).toEqual([["new", "add"], ["update", "update"], ["same", "skip"]]);
    expect(plan[1].targetId).toBe("c1");
  });

  it("finds a token by the repository's name too", () => {
    const plan = planDrafts([color("brand", "#ff0000")], base(), "set-global");
    expect(plan[0]).toMatchObject({ status: "update", targetId: "c2" });
  });

  it("compares colors by what they are, not how they are written", () => {
    expect(planDrafts([color("primary-500", "rgb(99 102 241)")], base(), "set-global")[0].status).toBe("same");
  });

  it("looks only in the set it is for", () => {
    const plan = planDrafts([color("other-set", "#000000")], base(), "set-global");
    expect(plan[0].status).toBe("new");
  });

  it("gives a draft named by number the next free name, and never changes what is there", () => {
    const state = base();
    state.colors.push({ id: "c9", name: "color-1", value: "#abcdef", group: "base", setId: "set-global", themeValues: { [L]: "#abcdef" } });
    const plan = planDrafts([color("color-1", "#111111", { auto: { prefix: "color" } }), color("color-2", "#222222", { auto: { prefix: "color" } }), color("color-3", "#333333", { auto: { prefix: "color" } })], state, "set-global");
    expect(plan.map((p) => p.name)).toEqual(["color-2", "color-3", "color-4"].map((n, i) => (i === 0 ? "color-2" : n)));
    expect(new Set(plan.map((p) => p.name)).size).toBe(3);
    expect(plan.every((p) => p.status === "new")).toBe(true);
  });

  it("compares lengths", () => {
    const plan = planDrafts([{ kind: "spacing", name: "space-4", value: 16 }, { kind: "spacing", name: "space-4", value: 20 }], base(), "set-global");
    expect(plan.map((p) => p.status)).toEqual(["same", "update"]);
  });
});

describe("adding what the plan says", () => {
  const set = (d: Draft[], state = base(), actions?: (p: ReturnType<typeof planDrafts>) => void) => {
    const plan = planDrafts(d, state, "set-global");
    actions?.(plan);
    return applyPlan(state, "set-global", plan);
  };

  it("adds colors with a value in every theme of the set, and the group from the names", () => {
    const state = base();
    state.sets = [{ ...state.sets[0], themes: [{ id: L, name: "Light" }, { id: "theme-dark", name: "Dark" }] }];
    const out = set([color("gray-50", "#f9fafb"), color("gray-900", "#111827"), color("lonely", "#123456")], state);
    const gray = out.colors.filter((c) => c.name.startsWith("gray"));
    expect(gray.map((c) => c.group)).toEqual(["gray", "gray"]);
    expect(out.colors.find((c) => c.name === "lonely")!.group).toBe("base");
    expect(gray[0].themeValues).toEqual({ [L]: "#f9fafb", "theme-dark": "#f9fafb" });
    expect(gray[0].value).toBe("#f9fafb");
  });

  it("updates only the themes that were given, and keeps the rest of the token", () => {
    const state = base();
    state.sets = [{ ...state.sets[0], themes: [{ id: L, name: "Light" }, { id: "theme-dark", name: "Dark" }] }];
    state.colors[0].themeValues = { [L]: "#6366f1", "theme-dark": "#818cf8" };
    const out = set([color("primary-500", "#ff0000")], state);
    const c = out.colors.find((x) => x.id === "c1")!;
    expect(c.themeValues).toEqual({ [L]: "#ff0000", "theme-dark": "#818cf8" });
    expect(c.value).toBe("#ff0000");
    expect(c.group).toBe("primary");
  });

  it("skips what is skipped, and doesn't change what it was given", () => {
    const state = base();
    const before = JSON.stringify(state);
    const out = set([color("fresh", "#111111"), color("primary-500", "#ff0000")], state, (plan) => { plan[0].action = "skip"; plan[1].action = "skip"; });
    expect(out.colors).toHaveLength(state.colors.length);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("adds the other kinds", () => {
    const out = set([
      { kind: "spacing", name: "space-8", value: 32 },
      { kind: "radius", name: "radius-lg", value: 12, group: "corners" },
      { kind: "shadow", name: "shadow-sm", x: 0, y: 1, blur: 2, spread: 0, color: "#00000020" },
      { kind: "typography", name: "text-lg", fontFamily: "Inter", fontSize: 20, fontWeight: 400, lineHeight: 28 },
    ]);
    expect(out.spacing.map((s) => s.name)).toEqual(["space-4", "space-8"]);
    expect(out.radii[0]).toMatchObject({ name: "radius-lg", value: 12, group: "corners", setId: "set-global" });
    expect(out.shadows[0]).toMatchObject({ name: "shadow-sm", group: "base" });
    expect(out.typography[0]).toMatchObject({ name: "text-lg", fontSize: 20 });
  });

  it("changes a length, a shadow and a text style in place", () => {
    const state = base();
    state.shadows = [{ id: "h1", name: "shadow-sm", x: 0, y: 1, blur: 2, spread: 0, color: "#000000", group: "default", setId: "set-global" }];
    const out = set([{ kind: "spacing", name: "space-4", value: 20 }, { kind: "shadow", name: "shadow-sm", x: 0, y: 4, blur: 8, spread: 0, color: "#000000" }], state);
    expect(out.spacing[0].value).toBe(20);
    expect(out.shadows[0]).toMatchObject({ id: "h1", y: 4, blur: 8, group: "default" });
  });
});

describe("drafts that are other tokens", () => {
  const withGray = (): TokenData => ({ ...base(), colors: [{ id: "g", name: "gray-50", value: "#f9fafb", group: "gray", setId: base().sets[0].id, themeValues: { [L]: "#f9fafb" } }] });
  const bg: Draft = { kind: "color", name: "background", values: { [L]: "#f9fafb" }, aliases: { [L]: "gray-50" } };

  it("adds a color that is another token", () => {
    const state = withGray();
    const out = applyPlan(state, state.sets[0].id, planDrafts([bg], state, state.sets[0].id));
    expect(out.colors.find((c) => c.name === "background")).toMatchObject({ themeValues: { [L]: "#f9fafb" }, themeAlias: { [L]: "gray-50" } });
  });

  it("is the same only when it is the same token, and a plain color over it detaches it", () => {
    const state = withGray();
    const first = applyPlan(state, state.sets[0].id, planDrafts([bg], state, state.sets[0].id));
    expect(planDrafts([bg], first, first.sets[0].id)[0].status).toBe("same");
    const plain: Draft = { kind: "color", name: "background", values: { [L]: "#f9fafb" } };
    const plan = planDrafts([plain], first, first.sets[0].id);
    expect(plan[0].status).toBe("update");
    const out = applyPlan(first, first.sets[0].id, plan);
    expect(out.colors.find((c) => c.name === "background")!.themeAlias).toBeUndefined();
  });

  it("keeps the color but not the link when the other token isn't there", () => {
    const state = base();
    const out = applyPlan(state, state.sets[0].id, planDrafts([bg], state, state.sets[0].id));
    const made = out.colors.find((c) => c.name === "background")!;
    expect(made.themeAlias).toBeUndefined();
    expect(made.themeValues[L]).toBe("#f9fafb");
  });
});
