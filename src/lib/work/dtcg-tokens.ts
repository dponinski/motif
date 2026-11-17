import type { GitHost, RepoReader } from "../github";
import { generateCss, HEADER } from "../dtcg/generate";
import { patchFiles } from "../dtcg/patch";
import { readRepoTokenFiles } from "../dtcg/repo";
import { describeDtcgChanges, mergeDtcg, planDtcgSync, writeOptionsOf, type DtcgChange, type DtcgLink } from "../dtcg/sync";
import { writeDtcg } from "../dtcg/write";
import type { StoredTokenData } from "../tokens/model";
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
  return describeDtcgChanges(link.staged?.files ?? link.base, writeDtcg(model, writeOptionsOf(link)).files);
}

const MAX_LISTED = 60;
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;
const short = (text: string) => (text.length > 70 ? `${text.slice(0, 69)}…` : text);

// The step the editor records, and the lines after it that the pull request nests under it.
export function dtcgSummary(changes: DtcgChange[], notes: string[]): string {
  const lines = [`Update ${changes.length} design token${changes.length === 1 ? "" : "s"} from Motif`];
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
  if (!real || !planned) return { link, staged: 0, attention: "The design tokens files aren't in the repository, so the tokens can't be added to the pull request. Pull to see what the repository has." };
  const plan = planDtcgSync(link, model, real.files);
  if (plan.merge.conflicts.length > 0 || plan.toMotif.length > 0 || plan.merge.restored.length > 0) {
    return { link, staged: 0, attention: "The repository has token changes that Motif hasn't taken yet. Pull to bring them in; the tokens are not in the pull request until then." };
  }

  const mine = writeDtcg(model, writeOptionsOf(link)).files;
  const merge = mergeDtcg(link.base, mine, planned.files);
  const toRepo = describeDtcgChanges(planned.files, merge.files);
  const done = (paths: string[]): DtcgLink => ({ ...link, staged: { files: merge.files, paths: [...new Set([...(link.staged?.paths ?? []), ...paths])] } });
  if (toRepo.length === 0) return { link: done([]), staged: 0, attention: null };

  const files = patchFiles(planned.files, merge.files);
  const notes: string[] = [];
  let attention: string | null = null;

  // The stylesheet the files come to, when it is one Motif's build writes (or there isn't one yet): a stylesheet the repository builds in its
  // own way is left to its build.
  const output = real.config.output;
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
