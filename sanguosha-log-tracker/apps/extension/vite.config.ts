import { defineConfig } from "vite"
import { cpSync, existsSync } from "node:fs"
import { resolve } from "node:path"

export default defineConfig({
  publicDir: "public",
  plugins: [
    {
      name: "copy-extension-assets",
      writeBundle() {
        const source = resolve(__dirname, "assets")
        if (existsSync(source)) {
          cpSync(source, resolve(__dirname, "dist/assets"), { recursive: true })
        }
      }
    }
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/content.ts"),
      name: "SgsTrackerExtension",
      formats: ["iife"],
      fileName: () => "content.js"
    },
    rollupOptions: {
      output: {
        assetFileNames: "[name][extname]"
      }
    }
  }
})
