// The first push of a repository whose tokens are variables in a stylesheet also moves them into design tokens files (see tokens-convert.js).
// These are the files that does to the repository the suites use (`src/styles/motif.css` of the fixture), for the suites that are about
// something else and check that the pull request changes only what they changed.
const CONVERSION = [
  "package.json",
  "src/styles/motif.css",
  "src/styles/tokens.css",
  "src/tokens/tokens.config.json",
  "src/tokens/tokens.dark.json",
  "src/tokens/tokens.json",
  "style-dictionary.config.mjs",
];
const withoutConversion = (paths) => paths.filter((p) => !CONVERSION.includes(p));
module.exports = { CONVERSION, withoutConversion };
