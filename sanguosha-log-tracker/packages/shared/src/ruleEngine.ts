import type { GameEvent, TrackerState } from "./types"

export type RulePrimitive = string | number | boolean | null
export type RuleJsonValue = RulePrimitive | RuleJsonValue[] | { [key: string]: RuleJsonValue }

export type RuleOperator =
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "in"
  | "notIn"
  | "contains"
  | "exists"
  | "startsWith"
  | "endsWith"

export type RuleCondition =
  | {
      all: RuleCondition[]
    }
  | {
      any: RuleCondition[]
    }
  | {
      not: RuleCondition
    }
  | {
      path: string
      op: RuleOperator
      value?: RuleJsonValue | undefined
    }

export type RuleAction = {
  type: string
  params?: Record<string, RuleJsonValue> | undefined
}

export type RuleDefinition = {
  id: string
  description?: string | undefined
  enabled?: boolean | undefined
  priority?: number | undefined
  when?: RuleCondition | undefined
  actions: RuleAction[]
}

export type RuleLibrary = {
  version: number
  rules: RuleDefinition[]
}

export type RuleEvaluationContext = {
  event: GameEvent
  state?: TrackerState | undefined
  vars: Record<string, unknown>
}

export type RuleActionHandlerResult = void | boolean | { stopPropagation?: boolean | undefined }

export type RuleActionHandler = (
  params: Record<string, unknown>,
  context: RuleEvaluationContext,
  rule: RuleDefinition,
  action: RuleAction
) => RuleActionHandlerResult

export type RuleActionHandlers = Record<string, RuleActionHandler>

export type RuleActionExecution = {
  ruleId: string
  actionType: string
  params: Record<string, unknown>
  handled: boolean
  stopPropagation?: boolean | undefined
}

export type RuleTriggerResult = {
  matchedRuleIds: string[]
  actions: RuleActionExecution[]
  stoppedPropagation: boolean
  stoppedByRuleId?: string | undefined
  stoppedByActionType?: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function readPath(root: unknown, path: string): unknown {
  if (!path) {
    return root
  }

  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) {
      return undefined
    }
    if (Array.isArray(current)) {
      const index = Number(segment)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (!isRecord(current)) {
      return undefined
    }
    return current[segment]
  }, root)
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => deepEqual(left[key], right[key]))
  }
  return false
}

function normalizeString(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function valuesEqualForCondition(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return normalizeString(left) === normalizeString(right)
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => valuesEqualForCondition(item, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => valuesEqualForCondition(left[key], right[key]))
  }
  return deepEqual(left, right)
}

function compareNumbers(left: unknown, right: unknown, op: ">" | ">=" | "<" | "<="): boolean {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false
  }
  if (op === ">") return leftNumber > rightNumber
  if (op === ">=") return leftNumber >= rightNumber
  if (op === "<") return leftNumber < rightNumber
  return leftNumber <= rightNumber
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function evaluateLeafCondition(left: unknown, op: RuleOperator, right: unknown): boolean {
  if (op === "==") return valuesEqualForCondition(left, right)
  if (op === "!=") return !valuesEqualForCondition(left, right)
  if (op === "exists") return left !== undefined && left !== null && (typeof left !== "string" || left.trim() !== "")
  if (op === ">") return compareNumbers(left, right, ">")
  if (op === ">=") return compareNumbers(left, right, ">=")
  if (op === "<") return compareNumbers(left, right, "<")
  if (op === "<=") return compareNumbers(left, right, "<=")
  if (op === "in") return asArray(right).some((item) => valuesEqualForCondition(item, left))
  if (op === "notIn") return !asArray(right).some((item) => valuesEqualForCondition(item, left))
  if (op === "contains") {
    if (Array.isArray(left)) return left.some((item) => valuesEqualForCondition(item, right))
    return typeof left === "string" && typeof right === "string"
      ? normalizeString(left).includes(normalizeString(right))
      : false
  }
  if (op === "startsWith") return typeof left === "string" && typeof right === "string" && normalizeString(left).startsWith(normalizeString(right))
  if (op === "endsWith") return typeof left === "string" && typeof right === "string" && normalizeString(left).endsWith(normalizeString(right))
  return false
}

function evaluateCondition(condition: RuleCondition | undefined, context: RuleEvaluationContext): boolean {
  if (!condition) {
    return true
  }
  if ("all" in condition) {
    return condition.all.every((item) => evaluateCondition(item, context))
  }
  if ("any" in condition) {
    return condition.any.some((item) => evaluateCondition(item, context))
  }
  if ("not" in condition) {
    return !evaluateCondition(condition.not, context)
  }

  const left = readPath(context, condition.path)
  return evaluateLeafCondition(left, condition.op, condition.value)
}

function resolveTemplate(value: RuleJsonValue, context: RuleEvaluationContext): unknown {
  if (typeof value === "string") {
    if (value.startsWith("$")) {
      return readPath(context, value.slice(1))
    }
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => {
      const resolved = readPath(context, path)
      return resolved === undefined || resolved === null ? "" : String(resolved)
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplate(item, context))
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, resolveTemplate(item, context)] as const)
        .filter(([, item]) => item !== undefined)
    )
  }
  return value
}

function cloneResolvedValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value
  }

  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value)
    } catch {
      // Fall through to the small recursive clone below for non-cloneable values.
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneResolvedValue(item)) as T
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneResolvedValue(item)])) as T
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

function resolveActionParams(action: RuleAction, context: RuleEvaluationContext): Record<string, unknown> {
  if (!action.params) {
    return {}
  }
  return cloneResolvedValue(resolveTemplate(action.params, context)) as Record<string, unknown>
}

function shouldStopPropagation(handlerResult: RuleActionHandlerResult): boolean {
  if (handlerResult === true) {
    return true
  }
  return Boolean(handlerResult && typeof handlerResult === "object" && handlerResult.stopPropagation)
}

export class RuleEngine {
  private readonly rules: RuleDefinition[]

  private readonly handlers: RuleActionHandlers

  constructor(library: RuleLibrary | RuleDefinition[], handlers: RuleActionHandlers = {}) {
    this.rules = Array.isArray(library) ? library : library.rules
    this.handlers = handlers
  }

  trigger(event: GameEvent, context: Omit<Partial<RuleEvaluationContext>, "event"> = {}): RuleTriggerResult {
    const evaluationContext: RuleEvaluationContext = {
      event,
      state: context.state,
      vars: context.vars ?? {}
    }
    const result: RuleTriggerResult = {
      matchedRuleIds: [],
      actions: [],
      stoppedPropagation: false
    }

    const sortedRules = this.rules
      .map((rule, index) => ({ rule, index }))
      .sort((left, right) => (right.rule.priority ?? 0) - (left.rule.priority ?? 0) || left.index - right.index)
      .map(({ rule }) => rule)

    for (const rule of sortedRules) {
      if (rule.enabled === false || !evaluateCondition(rule.when, evaluationContext)) {
        continue
      }
      result.matchedRuleIds.push(rule.id)
      for (const action of rule.actions) {
        const params = resolveActionParams(action, evaluationContext)
        const handler = this.handlers[action.type]
        let stopPropagation = false
        if (handler) {
          stopPropagation = shouldStopPropagation(handler(params, evaluationContext, rule, action))
        }
        result.actions.push({
          ruleId: rule.id,
          actionType: action.type,
          params,
          handled: Boolean(handler),
          stopPropagation
        })
        if (stopPropagation) {
          result.stoppedPropagation = true
          result.stoppedByRuleId = rule.id
          result.stoppedByActionType = action.type
          return result
        }
      }
    }

    return result
  }
}
