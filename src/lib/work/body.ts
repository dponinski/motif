const MAX_LISTED = 60;

// The pull request's description: what the person wrote, what was done (one line per step, in order), and the files.
export function editPrBody(files: string[], log: string[], note: string): string {
  // The same change made twice in a row reads as one.
  const steps = log.filter((line, i) => line !== log[i - 1]);
  const lines = [note.trim() || "Design changes made in Motif's visual editor.", "", `### Changes (${steps.length})`, ""];
  for (const step of steps.slice(0, MAX_LISTED)) lines.push(`- ${step.replace(/\n/g, " ")}`);
  if (steps.length > MAX_LISTED) lines.push(`- …and ${steps.length - MAX_LISTED} more`);
  lines.push("", "### Files", "");
  for (const f of files) lines.push(`- \`${f}\``);
  lines.push("", "---", "Opened from Motif, which keeps this pull request up to date as more changes are synced. Only the files listed here were changed.");
  return lines.join("\n");
}
