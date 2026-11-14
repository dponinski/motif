// Reads the editor's unsent changes from the browser, as the app keeps them: each step holds only what it changed (a patch
// against the file's text before it), so the full history is built back up here.
function applyPatch(before, patch) {
  if (typeof patch === "string") return patch;
  const [prefix, suffix, middle] = patch;
  return before.slice(0, prefix) + middle + before.slice(before.length - suffix);
}
function decode(state) {
  if (!state) return { scope: null, bases: {}, history: [{ texts: {}, summary: "" }], index: 0 };
  if (Array.isArray(state.history)) return state;
  const history = [{ texts: state.start || {}, summary: "" }];
  for (const step of state.steps || []) {
    const prev = history[history.length - 1];
    const texts = { ...prev.texts };
    for (const [path, patch] of Object.entries(step.set || {})) texts[path] = applyPatch(prev.texts[path] ?? state.bases[path]?.text, patch);
    history.push({ texts, summary: step.summary });
  }
  return { scope: state.scope, bases: state.bases, history, index: state.index };
}
// The app writes a moment after the last change.
async function readEdits(page, wait = 800) {
  await page.waitForTimeout(wait);
  const raw = await page.evaluate(() => JSON.parse(localStorage.getItem("motif-edits") || "{}"));
  return { ...raw, state: decode(raw.state) };
}
module.exports = { readEdits, decode };
