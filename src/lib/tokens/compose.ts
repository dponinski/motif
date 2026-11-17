import type { Composition, Slot, TokenType, Unit } from "./model";

// Compositions: tokens that go together as one (a text style is a font family String, a size Number, a weight, a line height). Each part (a
// slot) is a value of its own or another token of the same type, so changing that token changes every composition that uses it.

// The tokens a slot can be, wherever they are kept in the store.
export interface ComposeData {
  colors: { id: string; name: string; setId: string; value: string }[];
  numbers: { id: string; name: string; setId: string; value: number; unit: Unit }[];
  strings: { id: string; name: string; setId: string; value: string }[];
  spacing: { id: string; name: string; setId: string; value: number }[];
  radii: { id: string; name: string; setId: string; value: number }[];
}

export type CompositionKind = Composition["kind"];

export interface Choice { id: string; name: string; setId: string; text: string }

// The tokens of a type that a slot can point at: a Number is a Number, a spacing or a radius (those are lengths in pixels), a String is a
// String, a Color is a Color.
export function choicesFor(data: ComposeData, type: TokenType): Choice[] {
  if (type === "color") return data.colors.map((c) => ({ id: c.id, name: c.name, setId: c.setId, text: c.value }));
  if (type === "string") return data.strings.map((s) => ({ id: s.id, name: s.name, setId: s.setId, text: s.value }));
  return [
    ...data.numbers.map((n) => ({ id: n.id, name: n.name, setId: n.setId, text: `${n.value}${n.unit}` })),
    ...data.spacing.map((n) => ({ id: n.id, name: n.name, setId: n.setId, text: `${n.value}px` })),
    ...data.radii.map((n) => ({ id: n.id, name: n.name, setId: n.setId, text: `${n.value}px` })),
  ];
}

// What a slot is: the token it points at (as that token is now), else the value it has of its own. Null when there is nothing.
export function slotText(slot: Slot, data: ComposeData): string | null {
  if (slot.ref) {
    const hit = choicesFor(data, slot.type).find((c) => c.id === slot.ref);
    if (hit) return hit.text;
  }
  if (slot.value === undefined || slot.value === "") return null;
  return slot.type === "number" ? `${slot.value}${slot.unit ?? ""}` : slot.value;
}

// Whether a slot points at a token that is gone (it keeps the value it had).
export const slotMissing = (slot: Slot, data: ComposeData): boolean => !!slot.ref && !choicesFor(data, slot.type).some((c) => c.id === slot.ref);

// The slots of a composition as text, by name.
export function resolve(c: Pick<Composition, "slots">, data: ComposeData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of c.slots) { const t = slotText(slot, data); if (t !== null) out[slot.name] = t; }
  return out;
}

// Compositions in which the tokens `gone` were slots: each slot keeps the value the token had (`data` is the tokens as they were).
export function releaseSlots(compositions: Composition[], data: ComposeData, gone: ReadonlySet<string>): Composition[] {
  if (!compositions.some((c) => c.slots.some((s) => s.ref && gone.has(s.ref)))) return compositions;
  return compositions.map((c) => {
    if (!c.slots.some((s) => s.ref && gone.has(s.ref))) return c;
    return {
      ...c,
      slots: c.slots.map((s): Slot => {
        if (!s.ref || !gone.has(s.ref)) return s;
        const { ref: _, ...rest } = s;
        const text = slotText(s, data);
        // A number slot keeps its number and its unit apart.
        if (s.type === "number" && text !== null) { const m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(text); if (m) return { ...rest, value: m[1], unit: (m[2] ?? "") as Unit }; }
        return text === null ? rest : { ...rest, value: text };
      }),
    };
  });
}

// The compositions that have a token as a slot.
export const usersOf = (compositions: Composition[], id: string): Composition[] => compositions.filter((c) => c.slots.some((s) => s.ref === id));

// ── Presets ───────────────────────────────────────────────────────────────────

const slot = (name: string, type: TokenType, value: string, unit?: Unit): Slot => ({ name, type, value, ...(unit !== undefined ? { unit } : {}) });

export const PRESETS: { id: "typography" | "shadow" | "custom"; label: string; hint: string }[] = [
  { id: "typography", label: "Typography", hint: "a font family, a size, a weight, a line height" },
  { id: "shadow", label: "Shadow", hint: "offsets, blur, spread and a color" },
  { id: "custom", label: "Custom", hint: "parts of your own" },
];

export function presetSlots(kind: CompositionKind): Slot[] {
  if (kind === "typography") return [slot("font-family", "string", "Inter, sans-serif"), slot("font-size", "number", "16", "px"), slot("font-weight", "number", "400", ""), slot("line-height", "number", "24", "px"), slot("letter-spacing", "number", "0", "px")];
  if (kind === "shadow") return [slot("x", "number", "0", "px"), slot("y", "number", "4", "px"), slot("blur", "number", "8", "px"), slot("spread", "number", "0", "px"), slot("color", "color", "rgba(0,0,0,0.1)")];
  return [];
}

// A name for a part that a person adds to a custom composition: `part-1`, `part-2`…
export function newSlotName(slots: Slot[]): string {
  for (let i = 1; ; i++) if (!slots.some((s) => s.name === `part-${i}`)) return `part-${i}`;
}

// ── What a composition looks like ─────────────────────────────────────────────

const length = (t: string | undefined, fallback = "0px") => (t === undefined ? fallback : /^-?[\d.]+$/.test(t) ? `${t}px` : t);

// The style a composition gives a sample: a text style the font, a shadow the box shadow. Nothing for a custom one.
export function previewStyle(c: Pick<Composition, "kind" | "slots" | "inset">, data: ComposeData): Record<string, string | number> {
  const v = resolve(c, data);
  if (c.kind === "typography") {
    const style: Record<string, string | number> = {};
    if (v["font-family"]) style.fontFamily = v["font-family"];
    if (v["font-size"]) style.fontSize = length(v["font-size"]);
    if (v["font-weight"]) style.fontWeight = v["font-weight"];
    if (v["line-height"]) style.lineHeight = v["line-height"];
    if (v["letter-spacing"]) style.letterSpacing = length(v["letter-spacing"]);
    return style;
  }
  if (c.kind === "shadow") {
    return { boxShadow: `${c.inset ? "inset " : ""}${length(v.x)} ${length(v.y)} ${length(v.blur)} ${length(v.spread)} ${v.color ?? "rgba(0,0,0,0.25)"}` };
  }
  return {};
}

// What the composition says in a line, for a list and for search.
export function summary(c: Pick<Composition, "slots">, data: ComposeData): string {
  return c.slots.map((s) => `${s.name} ${slotText(s, data) ?? "—"}`).join(" · ");
}
