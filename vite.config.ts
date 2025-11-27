import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env": "{}",
    global: "window",
  },
  build: {
    outDir: "dist",
    target: "esnext",
    minify: "esbuild",
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "RoamTodoistBackup",
      formats: ["es"],
      fileName: () => "extension.js",
    },
  },
});
