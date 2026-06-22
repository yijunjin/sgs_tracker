import { crx } from "@crxjs/vite-plugin"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import manifest from "./manifest.config"

export default defineConfig(({ mode }) => ({
  // public/pageHook.js 会原样复制到 dist，并通过 manifest 的 web_accessible_resources 暴露。
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
        // 扩展调试时文件名保持稳定，避免每次构建后 manifest/chrome 调试面板里全是 hash 文件。
        assetFileNames: "[name][extname]",
        chunkFileNames: "[name].js",
        entryFileNames: "[name].js"
      }
    }
  }
}))
