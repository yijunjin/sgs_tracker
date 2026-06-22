import { defineManifest } from "@crxjs/vite-plugin"

const sanguoshaMatches = ["https://web.sanguosha.com/*", "https://*.sanguosha.com/*"]

export default defineManifest({
  manifest_version: 3,
  name: "三国杀记牌器",
  version: "0.1.4",
  description: "基于页面公开日志事件的三国杀记牌器，替代截图 OCR 识别。",
  permissions: ["clipboardWrite", "scripting", "tabs"],
  background: {
    service_worker: "src/background.js",
    type: "module"
  },
  host_permissions: [
    ...sanguoshaMatches,
    "http://127.0.0.1:18765/*",
    "http://localhost:18765/*"
  ],
  content_scripts: [
    {
      matches: sanguoshaMatches,
      js: ["src/content.ts"],
      run_at: "document_idle",
      all_frames: true,
      match_about_blank: true
    }
  ],
  web_accessible_resources: [
    {
      resources: ["pageHook.js", "assets/*.png"],
      matches: sanguoshaMatches
    }
  ]
})
