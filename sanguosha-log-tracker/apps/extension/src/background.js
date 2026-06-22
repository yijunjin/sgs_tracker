const MATCH_URLS = ["https://web.sanguosha.com/*", "https://*.sanguosha.com/*"]

// background service worker 不做记牌逻辑，只负责在扩展安装/启动/页面完成加载时，
// 把 manifest 里声明的 content script 补注入到已经打开的三国杀标签页。
function isSanguoshaUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" && (parsed.hostname === "web.sanguosha.com" || parsed.hostname.endsWith(".sanguosha.com"))
  } catch (_) {
    return false
  }
}

// 从当前 manifest 读取 content_scripts，而不是手写文件名。
// 这样以后入口文件或 CSS 文件名变化时，background 不需要同步改路径。
function getContentScriptFiles() {
  const contentScripts = chrome.runtime.getManifest().content_scripts || []
  const script = contentScripts.find((item) => item.matches && item.matches.some((match) => MATCH_URLS.includes(match)))

  return {
    css: script && Array.isArray(script.css) ? script.css : [],
    js: script && Array.isArray(script.js) ? script.js : []
  }
}

// 对单个 tab 执行补注入。CSS 和 JS 分开注入，是因为 chrome.scripting 的 API 分离。
// allFrames=true 对应 manifest 里的 all_frames：iframe 内的 Laya/协议事件也需要采集。
async function injectIntoTab(tabId) {
  const files = getContentScriptFiles()

  for (const file of files.css) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: [file]
      })
    } catch (_) {
      // The declarative content script may already own the CSS, or the tab may be gone.
    }
  }

  for (const file of files.js) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [file]
      })
    } catch (_) {
      // Ignore restricted frames and tabs that navigate during injection.
    }
  }
}

// 找到当前已经打开的所有三国杀页面，逐个补注入。
// 主要解决“用户先打开游戏页，后安装/重载扩展”时 content script 没自动进入的问题。
async function injectIntoMatchingTabs() {
  const tabs = await chrome.tabs.query({ url: MATCH_URLS })
  await Promise.all(tabs.filter((tab) => typeof tab.id === "number").map((tab) => injectIntoTab(tab.id)))
}

chrome.runtime.onInstalled.addListener(() => {
  void injectIntoMatchingTabs()
})

chrome.runtime.onStartup.addListener(() => {
  void injectIntoMatchingTabs()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || !isSanguoshaUrl(tab.url)) {
    return
  }
  void injectIntoTab(tabId)
})
