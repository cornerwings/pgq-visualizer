import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};
const externals = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.peerDependencies)];

export default defineConfig({
  publicDir: false,
  build: {
    lib: { entry: resolve(import.meta.dirname, "index.ts"), formats: ["es"], fileName: "index", cssFileName: "style" },
    rolldownOptions: { external: id => externals.some(name => id === name || id.startsWith(`${name}/`)) },
  },
});
