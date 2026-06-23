/**
 * Chrome 扩展 runtime URL 适配。
 *
 * 扩展热更新/重新加载后，旧 content script 里的 chrome.runtime.getURL 可能抛错。
 * 这里把“上下文是否仍有效”的状态封装起来，调用方只需要在失效回调里停止心跳、
 * 避免继续重试即可。这样 content.ts 不再保存一个裸露的 extensionContextValid 全局变量。
 */

export type RuntimeUrlResolver = {
  runtimeUrl(path: string): string
  isContextValid(): boolean
}

export function createRuntimeUrlResolver(onInvalidContext?: () => void): RuntimeUrlResolver {
  let contextValid = true

  return {
    runtimeUrl(path: string): string {
      if (!contextValid) {
        return ""
      }
      try {
        return (globalThis as { chrome?: { runtime?: { getURL(path: string): string } } }).chrome?.runtime?.getURL(path) ?? ""
      } catch {
        contextValid = false
        onInvalidContext?.()
        return ""
      }
    },
    isContextValid(): boolean {
      return contextValid
    }
  }
}
