import { describe, expect, it } from "vitest"

import { oneVOneDeckProfile } from "../src/cards"
import { parseGameEvents, parseLogInput } from "../src/parser"
import { RuleEngine, type RuleActionHandlers } from "../src/ruleEngine"
import rules from "../src/rules.json"

describe("rule engine event projection", () => {
  it("parses 洛神/再起 judge-card gains as events before rules mark known hand cards", () => {
    const [gameEvent] = parseGameEvents("甄姬获得判定牌青釭剑♠6", "manual", oneVOneDeckProfile)
    const [trackerEvent] = parseLogInput("甄姬获得判定牌青釭剑♠6", "manual", oneVOneDeckProfile)

    expect(gameEvent).toMatchObject({
      event: "OnCardGain",
      player: "甄姬",
      gainSource: "judge",
      card: { name: "青釭剑", suit: "黑桃", rank: "6" }
    })
    expect(trackerEvent).toMatchObject({
      action: "gainKnown",
      playerName: "甄姬",
      cardName: "青釭剑"
    })
  })

  it("triggers 集智 draw-pile decrement through an adapter action", () => {
    const [gameEvent] = parseGameEvents("黄月英发动集智", "manual", oneVOneDeckProfile)
    const decrements: Array<Record<string, unknown>> = []
    const handlers: RuleActionHandlers = {
      decrementDrawPile: (params) => decrements.push(params),
      emitTrackerEvent: () => {}
    }

    const result = new RuleEngine(rules, handlers).trigger(gameEvent!)

    expect(result.matchedRuleIds).toContain("jizhi-expected-draw-pile-decrement")
    expect(decrements).toEqual([{ amount: 1, reason: "黄月英发动集智" }])
  })

  it("keeps converted-card intent while counting the original card", () => {
    const [event] = parseLogInput("关羽将【闪】当【杀】使用", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({
      action: "use",
      playerName: "关羽",
      cardName: "闪",
      virtualCardName: "杀",
      note: "转化牌事件，按原始牌计入已见，并记录视为使用的目标牌。"
    })
  })
})
