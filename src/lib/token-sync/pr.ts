import { displayValue, type TokenChange } from "./merge";
import type { SkippedChange } from "./write";

const MAX_LISTED = 60;

const code = (text: string) => "`" + text.replace(/`/g, "'") + "`";
const short = (text: string) => (text.length > 70 ? text.slice(0, 69) + "…" : text);

// What a token change reads like in the pull request.
export function changeLine(c: TokenChange): string {
  const where = c.theme ? ` (${c.theme})` : "";
  return c.type === "changed"
    ? `${code(c.name)}${where}: ${code(short(displayValue(c.kind, c.before) ?? ""))} → ${code(short(displayValue(c.kind, c.after) ?? ""))}`
    : `${code(c.name)}${where}: ${code(short(displayValue(c.kind, c.after) ?? ""))}`;
}

// The step the editor records when token changes are put among its changes: the first line says what was done and the
// lines after it are the details, which the pull request description nests under it (lib/work/body.ts).
export function tokenSummary(changes: TokenChange[], skipped: SkippedChange[], options: { generated: boolean }): string {
  const n = `${changes.length} design token${changes.length === 1 ? "" : "s"}`;
  const lines = [options.generated ? `Add ${n} from Motif` : `Update ${n} from Motif`];
  for (const c of changes.slice(0, MAX_LISTED)) lines.push(changeLine(c));
  if (changes.length > MAX_LISTED) lines.push(`…and ${changes.length - MAX_LISTED} more`);
  for (const s of skipped.slice(0, MAX_LISTED)) lines.push(`Not included: ${code(s.name)}${s.theme ? ` (${s.theme})` : ""}: ${s.reason}`);
  return lines.join("\n");
}

export interface FileWrite {
  text: string;
  // The sha of the file when the edit was computed from it; null for a new file.
  sha: string | null;
}
