// Turns a repository file into a CommonJS module the preview runtime can run. This runs in Motif's page
// but only rewrites text; the result is executed inside the sandboxed iframe, never here.

const EXTENSION = /\.([cm]?[jt]sx?|json)$/;

export const isScript = (path: string) => /\.([cm]?[jt]sx?)$/.test(path);
export const isJson = (path: string) => path.endsWith(".json");

export async function transformModule(path: string, source: string): Promise<string> {
  if (isJson(path)) {
    JSON.parse(source);
    return `module.exports = ${source};`;
  }
  const ext = EXTENSION.exec(path)?.[1] ?? "js";
  const transforms: ("typescript" | "jsx" | "imports")[] =
    ext.endsWith("tsx") ? ["typescript", "jsx", "imports"] : ext.endsWith("ts") ? ["typescript", "imports"] : ["jsx", "imports"];

  // Vite's import.meta has no meaning in a CommonJS wrapper; the runtime provides a stand-in.
  const prepared = source.replace(/\bimport\.meta\b/g, "__importMeta");

  const { transform } = await import("sucrase");
  try {
    return transform(prepared, { transforms, jsxRuntime: "automatic", production: true, filePath: path }).code;
  } catch (err) {
    throw new Error(`Could not compile ${path}: ${err instanceof Error ? err.message.split("\n")[0] : "syntax error"}`);
  }
}
