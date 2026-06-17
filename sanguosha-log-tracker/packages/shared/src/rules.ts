import type { RuleDefinition, RuleLibrary } from "./ruleEngine"
import defaultRuleLibrary from "./rules.json"

export const systemRuleLibrary = defaultRuleLibrary as RuleLibrary

export function createRuleLibrary(customRules: RuleDefinition[] = []): RuleLibrary {
  return {
    version: systemRuleLibrary.version,
    rules: [...systemRuleLibrary.rules, ...customRules]
  }
}
