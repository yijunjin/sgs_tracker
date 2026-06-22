const MATCH_URLS = ["https://web.sanguosha.com/*", "https://*.sanguosha.com/*"]

function isSanguoshaUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" && (parsed.hostname === "web.sanguosha.com" || parsed.hostname.endsWith(".sanguosha.com"))
  } catch (_) {
    return false
  }
}

function getContentScriptFiles() {
  const contentScripts = chrome.runtime.getManifest().content_scripts || []
  const script = contentScripts.find((item) => item.matches && item.matches.some((match) => MATCH_URLS.includes(match)))

  return {
    css: script && Array.isArray(script.css) ? script.css : [],
    js: script && Array.isArray(script.js) ? script.js : []
  }
}

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
