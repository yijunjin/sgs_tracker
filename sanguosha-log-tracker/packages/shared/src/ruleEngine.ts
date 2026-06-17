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

export type RuleActionHandler = (
  params: Record<string, unknown>,
  context: RuleEvaluationContext,
  rule: RuleDefinition,
  action: RuleAction
) => void

export type RuleActionHandlers = Record<string, RuleActionHandler>

export type RuleActionExecution = {
  ruleId: string
  actionType: string
  params: Record<string, unknown>
  handled: boolean
}

export type RuleTriggerResult = {
  matchedRuleIds: string[]
  actions: RuleActionExecution[]
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
  if (op === "==") return deepEqual(left, right)
  if (op === "!=") return !deepEqual(left, right)
  if (op === "exists") return left !== undefined && left !== null && left !== ""
  if (op === ">") return compareNumbers(left, right, ">")
  if (op === ">=") return compareNumbers(left, right, ">=")
  if (op === "<") return compareNumbers(left, right, "<")
  if (op === "<=") return compareNumbers(left, right, "<=")
  if (op === "in") return asArray(right).some((item) => deepEqual(item, left))
  if (op === "notIn") return !asArray(right).some((item) => deepEqual(item, left))
  if (op === "contains") {
    if (Array.isArray(left)) return left.some((item) => deepEqual(item, right))
    return typeof left === "string" && typeof right === "string" ? left.includes(right) : false
  }
  if (op === "startsWith") return typeof left === "string" && typeof right === "string" && left.startsWith(right)
  if (op === "endsWith") return typeof left === "string" && typeof right === "string" && left.endsWith(right)
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

function resolveActionParams(action: RuleAction, context: RuleEvaluationContext): Record<string, unknown> {
  if (!action.params) {
    return {}
  }
  return resolveTemplate(action.params, context) as Record<string, unknown>
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
      actions: []
    }

    for (const rule of this.rules) {
      if (rule.enabled === false || !evaluateCondition(rule.when, evaluationContext)) {
        continue
      }
      result.matchedRuleIds.push(rule.id)
      for (const action of rule.actions) {
        const params = resolveActionParams(action, evaluationContext)
        const handler = this.handlers[action.type]
        if (handler) {
          handler(params, evaluationContext, rule, action)
        }
        result.actions.push({
          ruleId: rule.id,
          actionType: action.type,
          params,
          handled: Boolean(handler)
        })
      }
    }

    return result
  }
}
