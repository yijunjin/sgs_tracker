import { defineManifest } from "@crxjs/vite-plugin"

// 所有插件入口共用同一组匹配规则：content script、host permissions、
// web_accessible_resources 和 background 补注入都应该覆盖这些页面。
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
      // document_idle 让页面主体和 Laya 运行时先有机会初始化；
      // pageHook.js 内部也会轮询等待 Laya，双层兜底。
      run_at: "document_idle",
      // 三国杀页面可能把游戏内容放在 iframe，all_frames 确保 iframe 内的文本/协议也能 hook。
      all_frames: true,
      match_about_blank: true
    }
  ],
  web_accessible_resources: [
    {
      // pageHook.js 必须作为页面脚本注入真实上下文，所以需要声明为 web accessible。
      // 花色 png 由 shadow DOM 面板通过 chrome.runtime.getURL 加载，也需要放开。
      resources: ["pageHook.js", "assets/*.png"],
      matches: sanguoshaMatches
    }
  ]
})
