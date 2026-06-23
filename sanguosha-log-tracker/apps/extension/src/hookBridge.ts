import type { HookMessage } from "./contentTypes"

/**
 * pageHook 消息桥接工具。
 *
 * content script 运行在隔离世界，页面真实上下文里的 pageHook.js 通过 postMessage 发回数据。
 * iframe 中的 content script 还需要把消息转发给 top frame。这里集中处理消息形状校验和
 * iframe 转发，content.ts 只负责收到合法 record 后进入业务分流。
 */

export function isHookMessage(value: unknown): value is HookMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as HookMessage).source === "sgs-tracker-page-hook" || (value as HookMessage).source === "sgs-tracker-frame-hook") &&
      (value as HookMessage).record
  )
}

export function forwardFrameHookMessage(message: HookMessage, frameUrl = location.href): void {
  try {
    window.top?.postMessage(
      {
        source: "sgs-tracker-frame-hook",
        hookVersion: message.hookVersion,
        frameUrl,
        record: {
          ...message.record,
          frameUrl
        }
      } satisfies HookMessage,
      "*"
    )
  } catch {
    // Cross-frame forwarding is best-effort; collector diagnostics will reveal gaps.
  }
}
