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

Nothing is written to the repository by a scan. Only React repositories are read so far.

## Previewing repository components

After a scan, **Import components** (Git panel or the repository view) adds the repository's components to the **Repository** group under Components. Opening one replaces the canvas with a stage that runs the real component from the repository, with its own styles and tokens.

- **Props**: the right panel has a control for each prop (dropdowns from `cva` variants and string unions, switches for booleans, text) plus the content inside the component. **All variants** shows every combination side by side, and the stage has Light/Dark and width switches.
- **Examples** show how the repository itself uses a component, taken from its demo, story and example files (`demo/`, `examples/`, `*.stories.tsx`, ...). Each usage becomes an example, and the parts of a compound component (`TabsTrigger`, `CardTitle`) are shown inside their parent. Values that only exist while the demo runs (state, props, local variables) are left out and handlers do nothing; the preview says what was left out. Overlays the demo opened with state are shown open.
- **Motif's tokens**: once tokens are linked to the repository, the tokens you have changed in Motif since the last sync are applied on top of the repository's own styles in every preview, so you see the components in your tokens before a pull request exists. The palette button in the stage toolbar counts them and switches them off.
- **Update from repository** rescans and reports what is new, changed or gone.
- **How it runs**: the code is fetched in the browser, compiled with Sucrase and run in a sandboxed iframe with no access to Motif's storage or GitHub token, a Content Security Policy that blocks network requests and loads only React and the repository's packages from esm.sh and Tailwind's browser build from jsDelivr. Previews need network access to those CDNs, and image requests to https hosts are allowed.
- **Not supported yet** (the stage says so): CSS modules, Tailwind v3, Sass and `next/*` imports. Compound parts such as `TabsTrigger` render on their own only through their examples.
- Nothing is written to the repository.

## Editing repository components

Open a repository component and press **Edit** in the stage toolbar. Click any element in the preview to select it; the right panel shows what can be changed, and every change is made to the component's real source and shown in the preview straight away.

- **Layout, spacing, size, type, fill and border** are controls over the element's Tailwind classes: display, direction, gap, alignment, padding, margin, width, height, text size and weight, color, background, border, radius and shadow. Colors take the linked token names. A change replaces the class where it already is, so the diff is the one class that changed. Classes with a modifier (`hover:`, `md:`, `dark:`) are left as written.
- **Classes are found** in a plain `className`, in `cn(...)` / `clsx(...)` strings, and in `cva` / `tailwind-variants` tables: the base and the variant that is showing are edited, and a string written as `"a " + "b"` keeps its shape. Classes built at runtime or defined in another file are shown as such and not edited.
- **States and breakpoints**: the **State** selector in the inspector switches the controls between the plain classes and the ones for hover, focus, active, disabled, dark mode and the `sm`/`md`/`lg`/`xl` breakpoints. A state's value is written as its own class (`hover:bg-muted`, `md:gap-6`) next to the plain class it belongs to, in the same string, and the plain class is never touched; a property only the plain class sets is shown as inherited. Choosing dark turns the dark theme on and choosing a breakpoint sets the preview to that width; hover shows when the pointer is over the element. Focus and active can't be forced in a browser, so their classes are edited but not shown.
- **Text, order and structure**: edit an element's text, move it up or down among its siblings, duplicate it or delete it. The root of a component can't be deleted.
- **Insert, wrap and change**: the Structure section adds an element inside (first or last), before or after the selected one, from a small set of HTML snippets (div, text, heading, paragraph, button, link, list) or from the repository's own components, which are written with their usual starting props and the import they need, in the file's own style (reusing an existing import of the same module, refusing a name the file already uses). **Wrap in** puts the element inside a new div, row, column, section or component, **Unwrap** takes a wrapper with one element in it off, and **Tag** changes `div` to `section`, `h2` to `h3` and so on without losing classes or content. A new element is selected straight away. Elements can only be added beside another element inside a parent element, and never inside `img`, `input` and other elements that can't hold children.
- **Undo and redo** step through every change, and **Create pull request** (toolbar) shows the diff of each file, then opens a branch and a pull request from the branch that was imported. Nothing is written to a branch directly, and a file that changed in the repository in the meantime stops the pull request instead of being overwritten.
- Edits live in the browser session until they are sent. After the pull request is merged, press Update from repository.

## Syncing tokens with a repository

Open **Sync tokens** in the Git panel (or **Repo sync** in the Tokens view) with a repository connected. Opening pull requests needs a token with Contents and Pull requests read and write.

- **The repository has tokens**: import them into a new Motif set, one theme per repository theme. Colors (in `oklch`, `hsl`, `rgb` or hex), radius, spacing and shadows are synced; fonts and other tokens are listed as left out.
- **Later syncs**: *Check* compares Motif and the repository against the last sync. Changes from the repository are applied to Motif; changes made in Motif go back as a pull request that edits the stylesheet in place, in the notation it already uses, so the diff is only the values you changed. New tokens are added following the repository's own conventions (variables per theme, the Tailwind alias, `@theme`).
- **Conflicts**: when both sides changed the same value you choose which to keep.
- **The repository has no tokens**: send a Motif set as a pull request that adds a `tokens.css` of CSS variables (wired into Tailwind v4 and imported from its stylesheet when there is one).
- **Syncing never deletes a token from a repository.** A token deleted in Motif comes back on the next sync, and one removed in the repository is removed from Motif.
- Tokens defined in a Tailwind v3 config or a token JSON file are read, but writing changes back to them is not supported yet.

```bash
npm test
```
