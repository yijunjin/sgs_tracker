import { crx } from "@crxjs/vite-plugin"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import manifest from "./manifest.config"

export default defineConfig(({ mode }) => ({
  publicDir: "public",
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development")
  },
  plugins: [
    vue(),
    crx({ manifest })
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: "[name][extname]",
        chunkFileNames: "[name].js",
        entryFileNames: "[name].js"
      }
    }
  }
}))
