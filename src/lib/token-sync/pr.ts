import { GitHostError, type GitHost, type PrHost } from "../github";
import { displayValue, type TokenChange } from "./merge";
import type { SkippedChange } from "./write";

export interface TokenPr {
  number: number;
  url: string;
  branch: string;
}

const MAX_LISTED = 60;

const code = (text: string) => "`" + text.replace(/`/g, "'") + "`";
const short = (text: string) => (text.length > 70 ? text.slice(0, 69) + "…" : text);

export function prBody(changes: TokenChange[], skipped: SkippedChange[], options: { generated: boolean }): string {
  const lines: string[] = [
    options.generated
      ? "Adds the design tokens from Motif as a stylesheet, so they can be used in code and kept in sync."
      : "Updates design tokens to match the changes made in Motif.",
    "",
  ];
  const shown = changes.slice(0, MAX_LISTED);
  lines.push(`### ${options.generated ? "Tokens" : "Changes"} (${changes.length})`, "");
  for (const c of shown) {
    const where = c.theme ? ` (${c.theme})` : "";
    lines.push(
      c.type === "changed"
        ? `- ${code(c.name)}${where}: ${code(short(displayValue(c.kind, c.before) ?? ""))} → ${code(short(displayValue(c.kind, c.after) ?? ""))}`
        : `- ${code(c.name)}${where}: ${code(short(displayValue(c.kind, c.after) ?? ""))}`
    );
  }
  if (changes.length > shown.length) lines.push(`- …and ${changes.length - shown.length} more`);
  if (skipped.length) {
    lines.push("", "### Not included", "");
    for (const s of skipped.slice(0, MAX_LISTED)) lines.push(`- ${code(s.name)}${s.theme ? ` (${s.theme})` : ""}: ${s.reason}`);
  }
  lines.push("", "---", "Opened from Motif. Tokens are never deleted by a sync, so removals are left to this repository.");
  return lines.join("\n");
}

export const prBranchName = (now = Date.now()) => `motif/tokens-${now.toString(36)}`;

export interface FileWrite {
  text: string;
  // The sha of the file when the edit was computed from it; null for a new file.
  sha: string | null;
}

// Branch, one commit per file, then the pull request. Each write carries the sha the file had when the edit
// was computed, so it fails instead of overwriting a change made in between.
export async function openTokenPr(input: {
  host: Pick<GitHost, "createBranch" | "putFile"> & Pick<PrHost, "createPullRequest">;
  base: string;
  files: Record<string, FileWrite>;
  title: string;
  body: string;
  message: string;
  branch?: string;
}): Promise<TokenPr> {
  const { host, base } = input;
  const branch = input.branch ?? prBranchName();
  await host.createBranch(branch, base);
  for (const [path, file] of Object.entries(input.files)) {
    try {
      await host.putFile({ path, branch, text: file.text, message: input.message, sha: file.sha ?? undefined });
    } catch (err) {
      if (err instanceof GitHostError && err.isStale) {
        throw new Error(`${path} changed in the repository while the pull request was being prepared. Check again and retry.`);
      }
      throw err;
    }
  }
  const pr = await host.createPullRequest({ title: input.title, body: input.body, head: branch, base });
  return { number: pr.number, url: pr.url, branch };
}
