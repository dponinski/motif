export interface Edit {
  start: number;
  end: number;
  text: string;
}

// Applies edits that don't overlap, and moves a position in the file (the selected element) along with them.
export function applyEdits(code: string, edits: Edit[], selection: number | null = null): { code: string; selection: number | null } {
  let out = code;
  let sel = selection;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    if (sel !== null && e.end <= (selection as number)) sel += e.text.length - (e.end - e.start);
  }
  return { code: out, selection: sel };
}
