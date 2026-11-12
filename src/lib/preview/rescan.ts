import type { RepoReader } from "../github";
import { scanComponentFile } from "../repo-scan/components";
import { Resolver, } from "../repo-scan/model";
import { isIgnoredPath, readerSource } from "../repo-scan/source";
import type { LibraryComponent } from "./library";

// Reads a component again from edited text, so the controls, variants and defaults shown for it follow an edit
// before it is in the repository. What the scan can't know from one file (whether the package exports it, how
// well Motif supports it) stays as it was.
export async function rescanComponent(input: {
  reader: RepoReader;
  ref: string;
  paths: string[];
  // Edited files by path, which replace the repository's.
  overlay: Record<string, string>;
  component: LibraryComponent;
}): Promise<LibraryComponent | null> {
  const { reader, ref, component, overlay } = input;
  const base = readerSource(reader, ref);
  const warnings: string[] = [];
  const paths = new Set([...input.paths.filter((p) => !isIgnoredPath(p)), ...Object.keys(overlay)]);
  const resolver = new Resolver({ ...base, readText: async (p) => (p in overlay ? overlay[p] : base.readText(p)) }, paths, warnings);
  const model = await resolver.model(component.file);
  if (!model) return null;
  const scanned = await scanComponentFile(model, resolver);
  const next = scanned.components.find((c) => c.name === component.name);
  if (!next) return null;
  return { ...component, line: next.line, root: next.root, props: next.props, nativeProps: next.nativeProps, variants: next.variants, hooks: next.hooks, notes: next.notes };
}
