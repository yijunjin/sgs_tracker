/**
 * 页面/iframe 身份工具。
 *
 * content.ts 需要在顶层 frame 和子 frame 都能运行；这里把容易抛跨域异常或需要生成
 * 会话 id 的小逻辑集中起来。它们没有业务含义，只回答“我在哪个 frame”和“本次页面实例是谁”。
 */

export function isTopFrame(): boolean {
  try {
    return window.self === window.top
  } catch {
    return false
  }
}

export function createPageInstanceId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${random}`
}
