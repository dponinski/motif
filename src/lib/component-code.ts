import type { VariantProp } from "../store/canvas";

interface Named {
  name: string;
  variantProps: VariantProp[];
}

export const componentTag = (def: Named) => def.name.replace(/\s+/g, "");

export function componentInterface(def: Named): string {
  const fields = def.variantProps.map((p) => `  ${p.name}?: ${p.values.map((v) => `"${v}"`).join(" | ")};`);
  return `interface ${componentTag(def)}Props {\n${fields.join("\n")}\n}`;
}

export function componentJsx(def: Named, values: Record<string, string> = {}): string {
  const props = def.variantProps.map((p) => `${p.name}="${values[p.name] ?? p.default}"`).join(" ");
  return `<${componentTag(def)}${props ? " " + props : ""} />`;
}
