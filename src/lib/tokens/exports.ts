import type { TokenData } from "../../store/design-system";
import { generateCss, HEADER } from "../dtcg/generate";
import { writeDtcg } from "../dtcg/write";
import { toStored } from "./migrate";

// What the Tokens screen downloads: the tokens as design tokens (DTCG) and as the stylesheet they come to, written by the same code that
// writes them into a repository, so a download and a push say the same.

const DIR = "src/tokens";

// The base values of every set, in one design tokens file (the values of the other themes are in files of their own that a push writes).
export function exportTokens(data: TokenData): string {
  const written = writeDtcg(toStored(data), { files: "single", dir: DIR });
  return written.files[`${DIR}/tokens.json`] ?? "{}\n";
}

// The variables: `@theme` for what Tailwind makes classes from, `:root` for the rest, and a block for each theme that changes something.
export function exportCss(data: TokenData): string {
  const written = writeDtcg(toStored(data), { files: "single", dir: DIR, tailwind: true });
  return generateCss(written.files).slice(HEADER.length).replace(/^\n/, "");
}
