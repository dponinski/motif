export interface DiffLine {
  type: " " | "+" | "-";
  text: string;
}

// Lines that differ between two texts, each change with a few lines around it. Edits here are small and
// local, so a plain longest-common-subsequence over the lines is plenty.
export function diffLines(before: string, after: string, context = 2): { hunks: DiffLine[][]; added: number; removed: number } {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);

  // Table of common run lengths between the changed middles.
  const table: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);

  const lines: DiffLine[] = a.slice(0, head).map((text) => ({ type: " " as const, text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { lines.push({ type: " ", text: x[i] }); i++; j++; }
    else if (j < y.length && (i === x.length || table[i][j + 1] > table[i + 1][j])) lines.push({ type: "+", text: y[j++] });
    else lines.push({ type: "-", text: x[i++] });
  }
  for (const text of a.slice(a.length - tail)) lines.push({ type: " ", text });

  const changed = lines.map((l, k) => (l.type === " " ? -1 : k)).filter((k) => k >= 0);
  const hunks: DiffLine[][] = [];
  let from = -1;
  let to = -1;
  for (const k of changed) {
    if (from === -1) { from = Math.max(0, k - context); to = Math.min(lines.length - 1, k + context); continue; }
    if (k - context <= to + 1) to = Math.min(lines.length - 1, k + context);
    else { hunks.push(lines.slice(from, to + 1)); from = Math.max(0, k - context); to = Math.min(lines.length - 1, k + context); }
  }
  if (from !== -1) hunks.push(lines.slice(from, to + 1));
  return { hunks, added: lines.filter((l) => l.type === "+").length, removed: lines.filter((l) => l.type === "-").length };
}
