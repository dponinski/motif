import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "fixtures");

// Fixture files carry a ".fixture" suffix so the build does not type-check or lint them.
export function loadFixture(name: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(join(dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name.replace(/\.fixture$/, "")}`] = readFileSync(join(dir, entry.name), "utf8");
    }
  };
  walk(join(ROOT, name), "");
  return files;
}
