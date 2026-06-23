import { systemRuleLibrary, type RuleDefinition } from "@slt/shared"

/**
 * 自定义规则的 localStorage 适配层。
 *
 * 规则引擎本体在 @slt/shared 中，这个文件只负责浏览器侧持久化和结构校验。
 * content.ts 只需要拿到“已经清洗过的 RuleDefinition[]”，不应关心 JSON.parse、
 * 旧版本脏数据、系统规则 id 冲突这些存储细节。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function isValidRule(value: unknown): value is RuleDefinition {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || !Array.isArray(value.actions)) {
    return false
  }

  return value.actions.every((action) => isRecord(action) && typeof action.type === "string" && action.type.trim().length > 0)
}

// 用户规则从 localStorage 读出时必须“宽进严出”：
// localStorage 可能被手动编辑，或旧版本留下不完整字段，所以先做结构校验再补默认值。
export function normalizeRule(value: RuleDefinition): RuleDefinition {
  return {
    ...value,
    id: value.id.trim(),
    enabled: value.enabled !== false
  }
}

export function prepareCustomRule(value: RuleDefinition): RuleDefinition {
  if (!isValidRule(value)) {
    throw new Error("规则必须包含 id 和 actions[].type")
  }
  const rule = normalizeRule(value)
  if (systemRuleLibrary.rules.some((item) => item.id === rule.id)) {
    throw new Error("规则 id 已被系统规则占用")
  }
  return rule
}

export function loadCustomRules(storageKey: string): RuleDefinition[] {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isValidRule).map(normalizeRule) : []
  } catch {
    return []
  }
}

export function persistCustomRules(storageKey: string, rules: RuleDefinition[]): void {
  window.localStorage.setItem(storageKey, JSON.stringify(rules))
}
