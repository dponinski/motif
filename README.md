A new design tool built for design systems first

## Git sync

Design files can be stored on a branch of a GitHub repository. Connect a repository from the dashboard or the Git panel in the editor (a fine-grained personal access token with Contents read/write on that repository is enough; it stays in the browser's local storage), then track a file and push it.

Each file is written as `<design folder>/<name>.motif.json`: components with their variant props, elements keyed by id, and layer order. Keys are sorted and every value sits on its own line, so diffs stay small and `git pull` gives engineers a stable input for codegen.

Pushing or pulling when the branch has moved runs a three-way merge against the last synced version. Changes to different elements or different properties merge automatically; when both sides changed the same property, or one side deleted what the other edited, the Git panel asks which to keep.

## Documentation

The Docs view in the editor builds design system documentation from the file itself. Every component and token category has a page from the start (preview, props table, usage code, token specimens); add your own pages and blocks for principles, guidelines and do / don't examples. Preview shows the finished site and Export HTML downloads it as a single file. Docs are stored in the design file, so they sync and merge through Git with everything else.

## Reading a repository

Connect a GitHub repository from the Git panel and press Scan to see how it is built. No token is needed for public repositories; private ones need a token with Contents read access. Motif parses the code without running it and reports:

- the stack: framework, language, build tool, styling system (Tailwind v3/v4, CSS modules, styled-components, Emotion, plain CSS), variants helper, entry files
- design tokens from CSS custom properties (with `.dark`, `[data-theme]` and `prefers-color-scheme` themes), Tailwind v4 `@theme` blocks, a Tailwind v3 config, and token JSON files
- React components with their props, defaults, doc comments, variants (from `cva` / `tailwind-variants` tables, `keyof typeof` lookups and string unions), hooks, and whether the package entry exports them
- how editable each component will be in the visual editor, and why

Nothing is written to the repository and nothing is imported into Motif yet. Only React repositories are read so far.

```bash
npm test
```
