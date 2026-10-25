import { readFile } from "node:fs/promises";
import type { Plugin as EsbuildPlugin } from "esbuild";
import type { Plugin } from "vite";

const wasmModule =
  /[\\/]react-native-enriched-markdown[\\/]lib[\\/]module[\\/]web[\\/]wasm[\\/]md4c\.js$/;

// The published lib/module tree declares type=module, but this generated file
// still only exports its real, embedded WASM factory via CommonJS/AMD. Metro
// supplies interop; Vite needs the equivalent ESM boundary during both scanning
// and normal module loading. Do not replace the parser or its WASM payload.
function exposeWasmFactory(source: string): string {
  if (
    !source.includes("var createMd4cModule =") ||
    !source.includes("module.exports = createMd4cModule;")
  ) {
    throw new Error("Review enriched-markdown WASM interop: the generated module format changed");
  }
  return `${source}\nexport default createMd4cModule;\n`;
}

export const enrichedMarkdownWasm: Plugin = {
  name: "enriched-markdown-wasm-interop",
  enforce: "pre",
  transform(source, id) {
    if (wasmModule.test(id.split("?")[0])) {
      return { code: exposeWasmFactory(source), map: null };
    }
  },
};

export const enrichedMarkdownWasmOptimizer: EsbuildPlugin = {
  name: "enriched-markdown-wasm-interop",
  setup(build) {
    build.onLoad({ filter: wasmModule }, async ({ path }) => ({
      contents: exposeWasmFactory(await readFile(path, "utf8")),
      loader: "js",
    }));
  },
};
