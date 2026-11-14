import type { GitHost } from "../github";
import { NEW_FILE, useEditStore, type Base } from "../../store/edit";

// Puts file changes that were planned against the repository (tokens, the Tailwind add-on) among the editor's changes, so
// one Sync sends them with everything else. A file the editor already holds keeps the starting point it has; any other
// starts from what the default branch has now (or from nothing, for a file that is new). One step to undo.
export async function stageFiles(input: {
  host: Pick<GitHost, "getFile">;
  branch: string;
  // The repository and branch the editor's changes belong to (store/edit.ts `adopt`).
  scope: string;
  files: Record<string, string>;
  // What was done: the first line is the step, the lines after it are its details (they go into the pull request).
  summary: string;
}): Promise<void> {
  useEditStore.getState().adopt(input.scope);
  const bases: Record<string, Base> = {};
  for (const path of Object.keys(input.files)) {
    if (useEditStore.getState().bases[path]) continue;
    const file = await input.host.getFile(path, input.branch);
    bases[path] = file ? { text: file.text, sha: file.sha } : NEW_FILE;
  }
  useEditStore.getState().changeMany(input.files, null, input.summary, bases);
}
