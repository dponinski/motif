import type { RepoComponent } from "../repo-scan/types";
import type { ModuleGraph } from "./graph";
import { initialProps, variantCombinations } from "./props";
import type { RenderMessage } from "./protocol";
import { buildSrcdoc, newNonce } from "./srcdoc";

export type PreviewView = "single" | "variants";

// What a documentation page shows of a component: it as it starts, or every combination of its variants.
export function previewMessage(component: RepoComponent, view: PreviewView): RenderMessage {
  const exportName = component.exported === "default" ? "default" : component.name;
  const base = initialProps(component);
  const showVariants = view === "variants" && component.variants.length > 0;
  const items = showVariants
    ? variantCombinations(component, base).combinations.map((c) => ({ key: c.key, label: c.label, path: component.file, exportName, props: c.props }))
    : [{ key: "main", path: component.file, exportName, props: base }];
  // One component is shown as big as it is; a set of them is laid out in a grid.
  return { type: "render", id: 1, items, layout: showVariants ? "grid" : "bare", fit: !showVariants, dark: false, overrides: "" };
}

// A page that runs by itself: it carries its own runtime and says what to show, so it works inside an exported
// site as well as in Motif.
export function previewPage(input: { graph: ModuleGraph; tailwindVersion: 3 | 4 | null; runtimeSource: string; component: RepoComponent; view: PreviewView }): string {
  return buildSrcdoc({
    graph: input.graph,
    tailwindVersion: input.tailwindVersion,
    runtimeUrl: "",
    runtimeSource: input.runtimeSource,
    nonce: newNonce(),
    initial: previewMessage(input.component, input.view),
  });
}
