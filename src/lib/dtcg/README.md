# Design tokens files

Motif keeps a repository's design tokens as [design tokens (DTCG 2025.10)](https://www.designtokens.org/) JSON, and builds the stylesheet from
them with [Style Dictionary](https://styledictionary.com/). This folder is that format: what Motif writes, what it reads back, the
stylesheet the files come to, and what a repository needs to build the same stylesheet itself. (Pull, Push and starting an empty repository use it: see Syncing.)

```
src/tokens/
  tokens.config.json     how the files are laid out, where the stylesheet goes, the sets and their themes
  tokens.json            the base values of every set      (files: "single")
  tokens.dark.json       what the Dark theme changes
  <set>.json             the base values of a set          (files: "per-set")
  <set>.dark.json        what the Dark theme changes in it
style-dictionary.config.mjs   builds the stylesheet (npm run tokens:build)
src/styles/tokens.css         generated, committed
```

- **Names are paths.** The groups at the top are Tailwind's namespaces (`color`, `spacing`, `radius`, `text`, `leading`, `tracking`, `font`,
  `font-weight`, `shadow`), so `color.brand` is `--color-brand`. A Number or String with no use is a token of the top level (`--ratio`).
  A name that starts with what its namespace says is written without it (`space-4` is `spacing.4`) and kept in `$extensions["com.motif"].name`.
- **Types**: a color is a 2025.10 color object in the notation it was written in (`srgb` with its hex, `hsl`, `oklch`, `display-p3`); a
  Number is a `dimension` (`px` and `rem` as `{ value, unit }`, other units as text), a `number` or a `fontWeight`; a String is a
  `fontFamily` or a `string`. A text style is a `typography` token and a shadow a `shadow` token; a composition of your own is a group
  whose extension says so, of the tokens it is made of.
- **References**: a token that is another token is `{color.gray-50}`, in any file; the part of a composition that is a token is the same.
- **Themes**: the first theme of a set is its base, in the base file. Every other theme has a file with only what it changes (a token that is the
  same is left out). The config gives each theme's selector (`.dark`).
- **The stylesheet**: with Tailwind 4 the variables of the namespaces are in `@theme`, the others in `:root`; each theme's values are under its
  selector. A reference is `var()`, so a theme that changes a token changes what refers to it. A text style is `--text-<name>` (its size) with
  `--text-<name>--line-height` and so on after it.

`generate.ts` writes the stylesheet in Motif; `scaffold.ts` writes the Style Dictionary config that writes it in the repository, with the same
rules. `style-dictionary.test.ts` runs the real package over the files Motif writes and checks both write the same file (it needs Node 22).

## Syncing

A sync of Motif and a repository of design tokens files is a **three-way merge of JSON** (`sync.ts`): `base` is the files as of the last sync,
`mine` what `writeDtcg` writes from Motif's tokens now, `theirs` what the repository has. A token is a place in a file, so one changed on a
single side is taken, and one changed on both sides is a clash only when the two disagree (a color or a dimension is one value, so two
changes to the same color clash as a whole). Clashes name the token and the theme (`color.gray-50 · dark`). Nothing is ever deleted from a
repository by a sync: a token deleted in Motif is brought back (`restored`), as with the CSS sync.

- `planDtcgSync(link, model, theirs)`: the merge, what taking it changes in Motif (`toMotif`) and what a pull request would change (`toRepo`).
- `resolveDtcg(merge, takeTheirs)`: the files once the person chose the repository's side for some clashes.
- `takeDtcg(files, model)`: Motif's tokens from the merged files (ids kept, found by set and path).
- `planDtcgExport(host, analysis, branch, model)`: a repository with no tokens: the files, the stylesheet, `style-dictionary.config.mjs`, the
  `tokens:build` script and dependency in `package.json`, and the stylesheet imported after Tailwind's. A config the repository wrote itself is
  left alone (and said so).

## Converting a repository's stylesheets

A repository whose tokens are variables in its stylesheets is read as design tokens files without touching the repository (`convert.ts`),
and the first Push is what makes them real (`convert-edit.ts`).

- **What becomes a token.** Colors, lengths in px or rem, and shadows, declared in `:root` (and the selector of each other theme: `.dark`,
  `[data-theme="dark"]`) or in `@theme`. A variable of a rule is a token of the top level of the files, so `--primary` is written back as
  `--primary`; a variable of `@theme` named by a Tailwind namespace (`--color-brand`, `--spacing-18`) is that token in that group, so the
  classes Tailwind makes from it stay. A color that is another variable is a reference.
- **What stays in the stylesheet.** Everything else: `@theme inline` aliases (`--color-primary: var(--primary)`; `inline` is what makes them
  follow a theme, so they are not moved), anything with `calc()` or `color-mix()`, fonts, a variable inside `@media` or `@layer`, in a
  selector that isn't the base or its theme's, a shadow in a rule, and a name that is also the group of other tokens (`--radius` and
  `--radius-lg`). Each is listed with why.
- **The first Push** adds the files, the config, the Style Dictionary config and script, and the generated stylesheet to its pull request, takes
  the converted declarations out of the stylesheets (a rule or `@theme` that is left empty goes too) and imports the generated stylesheet
  after the Tailwind import (or after the imports a plain stylesheet starts with).
- **The check** reads the stylesheets as they will be, the generated one included, and compares every variable in every theme as it is
  resolved: colors as colors, lengths in px, shadows layer by layer, aliases followed. `41 variables, all identical`, or the ones that differ.
