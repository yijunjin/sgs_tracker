/**
 * localStorage 基础值读取工具。
 *
 * 这里不理解“面板宽度”“日志折叠”这些业务语义，只负责把浏览器存储里的字符串转成
 * number/boolean，并在读取失败时返回调用方给定的默认值。业务范围限制由调用方传入。
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function loadNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = window.localStorage.getItem(key)
  const value = raw ? Number(raw) : Number.NaN
  return Number.isFinite(value) ? clamp(value, min, max) : fallback
}

export function loadBoolean(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(key)
  return raw === null ? fallback : raw === "true"
}
