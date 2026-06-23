import type { HookRecord } from "./contentTypes"

/**
 * 协议字段读取工具。
 *
 * pageHook 透传的 dataRaw 来源复杂：有些事件把消息放在 msg 字段，有些事件本身就是消息；
 * 同一个字段也可能是 number 或数字字符串。这里统一做“保守读取”，让协议处理代码只面对
 * 已经清洗过的 number/string/object，避免每个分支都重复写类型判断。
 */

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  return undefined
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

export function numberArrayValue(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(numberValue).filter((item): item is number => item !== undefined)
}

// pageHook.js 对 raw-protocol-event 的 dataRaw 会尽量深拷贝原始对象。
// 不同协议事件有的把真正消息放在 msg 字段，有的自身就是消息体，所以这里统一拆出消息对象。
export function rawProtocolMessage(record: HookRecord): Record<string, unknown> | undefined {
  if (!isObjectRecord(record.dataRaw)) {
    return undefined
  }
  if (isObjectRecord(record.dataRaw.msg)) {
    return record.dataRaw.msg
  }
  return record.dataRaw
}
