A new design tool built for design systems first

## What Motif is

A design system builder. It works on the React components and design tokens of a GitHub repository: it reads them, shows them running, lets a designer change them visually and assign tokens to them, documents them, and sends every change back as a pull request. The code in the repository is the source of truth; Motif keeps nothing that the repository doesn't have except documentation and unsent edits. It is not a prototyping tool.

## Projects

Each design system is a **project**: one GitHub repository, with its tokens, documentation, imported components and unsent edits. The dashboard lists them. **New project** (or **Connect a repository** on an empty dashboard) takes `owner/name` or a GitHub URL and an access token. Public repositories can be read without one; private ones, and opening pull requests, need a fine-grained token limited to the repository with Contents and Pull requests read and write. The repository is checked before the project is made, so a typo or a missing token shows in the dialog. A token already entered for another project can be reused.

Projects are kept in this browser (local storage), token included, and are saved a moment after every change. Renaming or deleting a project only affects this browser: the repository is not touched, and edits waiting to be sent as a pull request are kept. A new project starts with no tokens and no components: scan the repository (see below) and sync its tokens.

Versions of Motif that were built around design files (`.motif.json` files saved to a branch, with their own sync) are gone, and so are the files, connections and token sets they left in the browser: they are cleared the first time the dashboard opens. Documentation now lives in the project in this browser, not in the repository.

## Documentation

The Docs view in the editor builds design system documentation from the project. Every component and token category has a page from the start (preview, props table, usage code, token specimens); add your own pages and blocks for principles, guidelines and do / don't examples. Preview shows the finished site and Export HTML downloads it as a single file. Docs are saved with the project.


**Repository components in the documentation.** Once a repository's components are imported, the documentation has a **Repository components** section with a page for each one: its name, a live preview of every variant (or just the one, for a component without variants), a props table (types, defaults, the options of each variant and the descriptions from the code) and usage code with the import and the variants it can take. The preview is the real component running as it does in the repository, in a sandboxed frame; it is a block like any other, so the designer can add one to any page (**Add block**, then *Repository component preview*, *props* or *usage*), pick which component it shows, and switch it between one and all variants. The page for a component is named after where it is declared, so everyone who edits it edits the same page.

- **Preview** shows the site as it will be exported, with the live previews running, and **Export HTML** includes them: each preview is a page that carries its own runtime and is told what to show, so the exported file runs anywhere with network access to the package CDN, with no dependency on Motif being online. Without the repository connected the editor says what is missing, and the props and usage are still shown.
- Parts of a compound component (such as `TabsTrigger`) can't be shown without their parent, so their default page's preview shows the component's own error; change or remove that block, or document the parent.
## Reading a repository

Open the Git panel in a project and press Scan to see how its repository is built. No token is needed for public repositories; private ones need a token with Contents read access. Motif parses the code without running it and reports:

- the stack: framework, language, build tool, styling system (Tailwind v3/v4, CSS modules, styled-components, Emotion, plain CSS), variants helper, entry files
- design tokens from CSS custom properties (with `.dark`, `[data-theme]` and `prefers-color-scheme` themes), Tailwind v4 `@theme` blocks, a Tailwind v3 config, and token JSON files
- React components with their props, defaults, doc comments, variants (from `cva` / `tailwind-variants` tables, `keyof typeof` lookups and string unions), hooks, and whether the package entry exports them
- how editable each component will be in the visual editor, and why

Nothing is written to the repository by a scan. Only React repositories are read so far.

**Where to start.** With no repository components imported, the Components panel has a **Repository components** section: **Scan and import components** scans the project's repository (its default branch) and brings the components in, in one step. They then appear in the same panel under **Repository**. A repository with no React components says so, and a private one needs an access token. The Git panel has the same scan with its report, a choice of branch, and a separate Import button.

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
- **Props and variants**: in Edit mode the right panel has a **Props and variants** section. For each `cva` variant group it lists the options: add one (it starts with the classes of the default option, so it looks the same until you change it, and then it is edited like any other option), rename one, remove one, and choose which is the default. **New variant group** adds a group to a `cva` call and wires it in: the cva call passes it and the component takes it from its props. For plain props it adds a prop (to the props interface or type and to the destructured parameters, with an optional default), changes or removes a default, and removes a prop that nothing in the component uses. The controls, All variants and defaults shown for the component follow these edits straight away. Renaming an option that is also used somewhere else in the file, removing the default or the only option, and removing a prop that is still used are refused with the reason, and so are shapes it can't place safely (props that aren't destructured, `cva` called without an object, variants that come from a type or a lookup table rather than `cva`).
- **Undo and redo** step through every change, and **Create pull request** (toolbar) shows the diff of each file, then opens a branch and a pull request from the branch that was imported. Nothing is written to a branch directly, and a file that changed in the repository in the meantime stops the pull request instead of being overwritten.
- **Edits are kept** in this browser, for the repository and branch they were made on, so a reload (or closing the tab) doesn't lose them: the changes, their undo history (the last 60 steps) and the original text of each changed file. Updating from the repository keeps them too. If the repository has changed a file you edited since, the stage says so and offers to give up the edits to those files, because a pull request couldn't be made for them as they are. Because the original text of the files is kept, for a private repository this includes its code, which stays in this browser like the access token does. Once edits are sent as a pull request they are gone. After it is merged, press Update from repository.

## Repository components on the design canvas

A repository component can be placed in a design as the real thing. **Place on canvas** (the icon on a row in the Repository list, or the button in the component panel) puts it where you are looking, or in the corner of the selected frame, and shows the canvas. The component is drawn by a layer of sandboxed pages above the canvas that follows its zoom and pan exactly, so it stays sharp at any zoom; the canvas keeps selecting, moving, resizing, undoing and saving it through a box of the same size underneath.

- **Size**: it takes the component's own size (a button is as wide as its text) until you resize it by hand, after which the component fills the size you set. **Fit to the component's size** in the panel goes back.
- **Props**: selecting it shows the component's props and variants as controls (the same ones as in the stage), kept in the document as plain values. Reset restores the starting values. **Open component** goes to the stage for it, in Edit mode if you like, to change the component itself.
- **In the document**: it is saved with the design (repository, branch, file, name and props), so it comes back after a reload. Without the repository connected, or when its components aren't imported, it shows a labelled box saying what is missing.
- **Limits**: repository components are drawn above the canvas, so they sit over Motif's own shapes whatever their order; at most twelve are live at once, the rest show a labelled box; they show the repository's version of the component (not unsent edits from the stage), with the stage's theme and Motif's token changes; and a Docs block for them isn't there yet.

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

## Building on a server with an old glibc

`npm run build` uses Webpack (`next build --webpack`). Next 16 builds with Turbopack by default, which needs Next's native compiler, and that needs glibc 2.29 or newer; on an older host (some shared hosting) Next falls back to its WebAssembly compiler, which only Webpack supports. Webpack builds the same app everywhere, so the build doesn't depend on the host. `npm run dev` still uses Turbopack.
