import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next 16 removed `next lint`: ESLint is run directly (`npm run lint`).
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Unused names that start with an underscore are on purpose (the rest of a destructuring, an ignored argument).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // Avatars come from whichever identity provider a person used: next/image would need every host allow-listed.
      "@next/next/no-img-element": "off",
      // React Compiler checks that flag patterns which work here (loading into state in an effect, reading a ref the stage
      // keeps for its pan/zoom); they are shown as warnings to be tidied, not failures.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "node_modules/**", "src-tauri/**", "next-env.d.ts", "public/**", "src/lib/repo-scan/fixtures/**", "e2e/**"]),
]);
