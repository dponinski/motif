A new design tool built for design systems first

## Git sync

Design files can be stored on a branch of a GitHub repository. Connect a repository from the dashboard or the Git panel in the editor (a fine-grained personal access token with Contents read/write on that repository is enough; it stays in the browser's local storage), then track a file and push it.

Each file is written as `<design folder>/<name>.motif.json`: components with their variant props, elements keyed by id, and layer order. Keys are sorted and every value sits on its own line, so diffs stay small and `git pull` gives engineers a stable input for codegen.

Pushing or pulling when the branch has moved runs a three-way merge against the last synced version. Changes to different elements or different properties merge automatically; when both sides changed the same property, or one side deleted what the other edited, the Git panel asks which to keep.

```bash
npm test
```
