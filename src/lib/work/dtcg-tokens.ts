import type { GitHost, RepoReader } from "../github";
import { describeCheck, editStylesheets, type Sheet } from "../dtcg/convert-edit";
import { convertAnalysis } from "../dtcg/convert";
import { planDtcgExport } from "../dtcg/export";
import { generateCss, HEADER } from "../dtcg/generate";
import { applyRenames, patchFiles } from "../dtcg/patch";
import { readRepoTokenFiles } from "../dtcg/repo";
import { canonicalFiles, describeDtcgChanges, goneOf, mergeDtcg, planDtcgSync, removedHere, writeOptionsOf, type DtcgChange, type DtcgLink } from "../dtcg/sync";
import { writeDtcg } from "../dtcg/write";
import type { StoredTokenData } from "../tokens/model";
import { readRepoState } from "../token-sync/flow";
import { overlayReader, type Overlay } from "./overlay";
import { stageFiles } from "./stage";

// Putting Motif's token changes among the editor's changes when the repository's tokens are design tokens files: the files with what changed
// in them, and the stylesheet they come to, so Sync sends them with everything else. As with the tokens in stylesheets, the plan is made
// against the repository as the pull request will have it (the editor's changes in it), and the merge against what the repository really
// has, so a token the repository changed is found.

export interface DtcgStageResult {
  link: DtcgLink;
  // How many token changes were put in.
  staged: number;
  // Something the person has to look at, said after the sync.
  attention: string | null;
}

// What is waiting to be staged, without asking the repository: Motif's tokens against what was staged last (or, if nothing was, against the
// last merged state).
export function waitingDtcgChanges(link: DtcgLink | null, model: StoredTokenData): DtcgChange[] {
  if (!link) return [];
  // (Tokens still in the stylesheets are not waiting: moving them into files goes with the next push, whatever it is for, or with "Add to pull
  // request"; what is waiting is what Motif changed besides.)
  return describeDtcgChanges(link.staged?.files ?? applyRenames(link.base, link.renamed), writeDtcg(model, writeOptionsOf(link)).files);
}

const MAX_LISTED = 60;
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;
const short = (text: string) => (text.length > 70 ? `${text.slice(0, 69)}…` : text);

// The step the editor records, and the lines after it that the pull request nests under it.
export function dtcgSummary(changes: DtcgChange[], notes: string[], generated = false): string {
  const lines = [`${generated ? "Add" : "Update"} ${changes.length} design token${changes.length === 1 ? "" : "s"} from Motif`];
  for (const c of changes.slice(0, MAX_LISTED)) {
    const where = c.theme ? ` (${c.theme})` : "";
    lines.push(c.type === "removed" ? `${code(c.name)}${where}: removed` : c.type === "changed" ? `${code(c.name)}${where}: ${code(short(c.before ?? ""))} → ${code(short(c.after ?? ""))}` : `${code(c.name)}${where}: ${code(short(c.after ?? ""))}`);
  }
  if (changes.length > MAX_LISTED) lines.push(`…and ${changes.length - MAX_LISTED} more`);
  for (const n of notes) lines.push(n);
  return lines.join("\n");
}

export async function stageDtcgTokens(input: {
  host: GitHost & RepoReader;
  link: DtcgLink;
  model: StoredTokenData;
  overlay: Overlay;
  scope: string;
}): Promise<DtcgStageResult> {
  const { host, link, model, overlay } = input;
  const branch = link.branch;
  const oh = overlayReader(host, overlay);

  const [real, planned] = await Promise.all([readRepoTokenFiles(host, branch), readRepoTokenFiles(oh, branch)]);
  if (!planned) {
    // Nothing in the repository or in the pull request. A link that never sent anything is waiting for its first push: every set goes in as
    // files, with the stylesheet they come to and what builds it. One that had files has lost them.
    if (link.convert) return convertExport(input, oh);
    if (Object.keys(link.base).length === 0) return firstExport(input, oh);
    return { link, staged: 0, attention: "The design tokens files aren't in the repository, so the tokens can't be added to the pull request. Pull to see what the repository has." };
  }
  // (Tokens that are still in the stylesheets: the repository has no files, so what it has is what the last pull found.)
  const plan = planDtcgSync(link, model, real?.files ?? (link.convert ? link.base : {}));
  if (plan.merge.conflicts.length > 0 || plan.toMotif.length > 0) {
    return { link, staged: 0, attention: "The repository has token changes that Motif hasn't taken yet. Pull to bring them in; the tokens are not in the pull request until then." };
  }

  const mine = writeDtcg(model, writeOptionsOf(link)).files;
  const merge = mergeDtcg(link.base, mine, planned.files);
  const toRepo = describeDtcgChanges(planned.files, merge.files);
  const done = (paths: string[]): DtcgLink => ({ ...link, staged: { files: merge.files, paths: [...new Set([...(link.staged?.paths ?? []), ...paths])] } });
  if (toRepo.length === 0) return { link: done([]), staged: 0, attention: null };

  // What was renamed or deleted here is taken out of the files where it was.
  const files = patchFiles(planned.files, merge.files, { gone: new Set([...goneOf(link), ...removedHere(link.base, mine)]) });
  const notes: string[] = [];
  let attention: string | null = null;

  // The stylesheet the files come to, when it is one Motif's build writes (or there isn't one yet): a stylesheet the repository builds in its
  // own way is left to its build.
  const output = planned.config.output;
  const current = await oh.getFile(output, branch);
  const css = generateCss({ ...planned.files, ...files });
  if (!current || current.text.startsWith(HEADER)) {
    if (current?.text !== css) files[output] = css;
  } else {
    attention = `${output} isn't a file Motif's build writes, so it wasn't changed: run the repository's own tokens build.`;
    notes.push(`Not changed: ${code(output)} (build it from the token files)`);
  }

  if (Object.keys(files).length === 0) return { link: done([]), staged: 0, attention };
  await stageFiles({ host, branch, scope: input.scope, files, summary: dtcgSummary(toRepo, notes) });
  return { link: done(Object.keys(files)), staged: toRepo.length, attention };
}

// A repository with no tokens: every set of the project, as files; the stylesheet; the build; the import. As one step to undo.
async function firstExport(input: { host: GitHost & RepoReader; link: DtcgLink; model: StoredTokenData; scope: string }, oh: ReturnType<typeof overlayReader>): Promise<DtcgStageResult> {
  const { host, link, model } = input;
  const state = await readRepoState(oh, link.repo, link.branch);
  const exported = await planDtcgExport(oh, state.analysis, link.branch, model, { files: link.files });
  if (exported.changes.length === 0) return { link, staged: 0, attention: null };

  const notes = [...exported.skipped.map((s) => `Not included: ${code(s.name)}: ${s.reason}`), ...exported.notes];
  if (!exported.imported) notes.push(`To do: import \`${exported.link.output}\` from your stylesheet${exported.link.tailwind ? " after the Tailwind import" : ""} to use these tokens.`);
  const files = Object.fromEntries(Object.entries(exported.files).map(([path, f]) => [path, f.text]));
  await stageFiles({ host, branch: link.branch, scope: input.scope, files, summary: dtcgSummary(exported.changes, notes, true) });
  const left = exported.skipped.length ? `${exported.skipped.length} token${exported.skipped.length === 1 ? " was" : "s were"} left out: ${exported.skipped[0].reason}.` : null;
  return {
    link: { ...link, ...exported.link, base: link.base, staged: { files: exported.link.base, paths: Object.keys(files) } },
    staged: exported.changes.length,
    attention: left ?? exported.notes[0] ?? null,
  };
}

const MAX_DIFFERENCES = 20;

// Tokens that are variables in the stylesheets of the repository: every set as files; the stylesheet they generate; the build; the variables
// taken out of the stylesheets and the generated one imported; and the check that nothing changed. As one step to undo.
async function convertExport(input: { host: GitHost & RepoReader; link: DtcgLink; model: StoredTokenData; scope: string }, oh: ReturnType<typeof overlayReader>): Promise<DtcgStageResult> {
  const { host, link, model } = input;
  const convert = link.convert!;
  const state = await readRepoState(host, link.repo, link.branch);
  // The stylesheets have changed since the tokens were pulled: they come first, or a value the repository changed would be written over.
  const now = convertAnalysis(state.analysis, link.repo);
  if (!now || JSON.stringify(canonicalFiles(now.files)) !== JSON.stringify(canonicalFiles(link.base))) {
    return { link, staged: 0, attention: "The repository's tokens have changed since they were pulled. Pull to bring the changes in; the tokens are not in the pull request until then." };
  }

  const exported = await planDtcgExport(oh, state.analysis, link.branch, model, { files: link.files, selectors: convert.selectors, output: link.output, skipImport: true });

  const wanted = new Set(convert.converted);
  const paths = new Set<string>(state.analysis.tailwindEntry ? [state.analysis.tailwindEntry] : []);
  for (const t of state.analysis.tokens) if (wanted.has(t.name)) for (const l of Object.values(t.locations)) paths.add(l.file);
  const sheets: Sheet[] = [];
  for (const path of paths) {
    const file = await oh.getFile(path, link.branch);
    if (file) sheets.push({ path, text: file.text, sha: file.sha });
  }
  // The check is of the conversion: the stylesheet the repository's own values come to, not one with what Motif changed since (those are the
  // token changes listed above it).
  const edit = await editStylesheets({ sheets, conversion: convert, entry: state.analysis.tailwindEntry ?? null, tailwind: exported.link.tailwind, output: exported.link.output, generated: generateCss(applyRenames(link.base, link.renamed)), renamed: Object.fromEntries(Object.entries(link.renamed ?? {}).map(([a, b]) => [a.split(".").join("-"), b.split(".").join("-")])) });

  const notes = [
    `Check: ${describeCheck(edit.check)}`,
    ...edit.check.differences.slice(0, MAX_DIFFERENCES).map((d) => `${code(`--${d.name}`)} (${d.theme}): ${code(short(d.before))} → ${code(short(d.after))}`),
    ...(edit.check.differences.length > MAX_DIFFERENCES ? [`…and ${edit.check.differences.length - MAX_DIFFERENCES} more`] : []),
    ...(convert.left.length ? [`Left in the stylesheets (${convert.left.length}): ${convert.left.slice(0, 8).map((l) => `${code(`--${l.name}`)}`).join(", ")}${convert.left.length > 8 ? ", …" : ""}`] : []),
    ...exported.skipped.map((s) => `Not included: ${code(s.name)}: ${s.reason}`),
    ...exported.notes,
  ];
  if (!edit.imported) notes.push(`To do: import \`${exported.link.output}\` from your stylesheet${exported.link.tailwind ? " after the Tailwind import" : ""} to use these tokens.`);

  const files: Record<string, string> = Object.fromEntries(Object.entries(exported.files).map(([path, f]) => [path, f.text]));
  for (const [path, f] of Object.entries(edit.files)) files[path] = f.text;
  const lines = dtcgSummary(exported.changes, notes, true).split("\n");
  lines[0] = `Move ${exported.changes.length} design token${exported.changes.length === 1 ? "" : "s"} from the stylesheets into design tokens files`;
  await stageFiles({ host, branch: link.branch, scope: input.scope, files, summary: lines.join("\n") });
  return {
    link: { ...link, ...exported.link, base: link.base, staged: { files: exported.link.base, paths: Object.keys(files) } },
    staged: exported.changes.length,
    attention: edit.check.differences.length > 0 ? `${new Set(edit.check.differences.map((d) => d.name)).size} variable${new Set(edit.check.differences.map((d) => d.name)).size === 1 ? "" : "s"} would come to a different value: see the first step of the pull request.` : exported.notes[0] ?? null,
  };
}
