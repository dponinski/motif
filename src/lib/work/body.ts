const MAX_LISTED = 60;

// The pull request's description: what the person wrote, what was done (one line per step, in order), and the files.
export function editPrBody(files: string[], log: string[], note: string): string {
  // The same change made twice in a row reads as one.
  const steps = log.filter((line, i) => line !== log[i - 1]);
  const lines = [note.trim() || "Design changes made in Motif's visual editor."];
  // Nothing to list after a merge or a discard, which start the history over.
  if (steps.length > 0) {
    lines.push("", `### Changes (${steps.length})`, "");
    for (const step of steps.slice(0, MAX_LISTED)) {
      // A step can carry details on the lines after its first (the tokens that changed, what to do about a framework).
      const [first, ...details] = step.split("\n");
      lines.push(`- ${first}`);
      for (const detail of details) if (detail.trim()) lines.push(`  - ${detail.trim()}`);
    }
    if (steps.length > MAX_LISTED) lines.push(`- …and ${steps.length - MAX_LISTED} more`);
  }
  lines.push("", "### Files", "");
  for (const f of files) lines.push(`- \`${f}\``);
  lines.push("", "---", "Opened from Motif, which keeps this pull request up to date as more changes are synced. Only the files listed here were changed.");
  return lines.join("\n");
}
