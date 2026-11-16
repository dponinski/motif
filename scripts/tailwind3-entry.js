// The Tailwind 3 engine for a page that has no files: the preview's sandbox loads this (public/motif-tailwind3.js, made by
// scripts/build-tailwind3.mjs) to build the stylesheet of a Tailwind 3 repository in the browser, the way its own build would.
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import plugin from "tailwindcss/plugin";
import colors from "tailwindcss/colors";
import defaultTheme from "tailwindcss/defaultTheme";
import resolveConfig from "tailwindcss/resolveConfig";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";
import forms from "@tailwindcss/forms";
import aspectRatio from "@tailwindcss/aspect-ratio";
import containerQueries from "@tailwindcss/container-queries";

// `css` has the repository's `@tailwind` directives, `@layer` and `@apply`; `config` is its config as the page evaluated it; `html` is
// the text the engine reads class names from (the page's own markup).
async function compile({ css, config, html }) {
  const result = await postcss([tailwindcss({ ...config, content: [{ raw: html, extension: "html" }] })]).process(css, { from: undefined });
  return result.css;
}

// What a config can `require`, by name.
const modules = {
  tailwindcss,
  "tailwindcss/plugin": plugin,
  "tailwindcss/colors": colors,
  "tailwindcss/defaultTheme": defaultTheme,
  "tailwindcss/resolveConfig": resolveConfig,
  "tailwindcss-animate": animate,
  "@tailwindcss/typography": typography,
  "@tailwindcss/forms": forms,
  "@tailwindcss/aspect-ratio": aspectRatio,
  "@tailwindcss/container-queries": containerQueries,
};

window.motifTailwind3 = { compile, modules };
