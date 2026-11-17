# Design tokens files

Motif keeps a repository's design tokens as [design tokens (DTCG 2025.10)](https://www.designtokens.org/) JSON, and builds the stylesheet from
them with [Style Dictionary](https://styledictionary.com/). This folder is that format: what Motif writes, what it reads back, the
stylesheet the files come to, and what a repository needs to build the same stylesheet itself. (Not wired into the app yet: see Syncing.)

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
