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
      decrementDrawPile: (params) => {
        decrements.push(params)
      },
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

  it("runs higher-priority rules first and stops later rules when requested", () => {
    const [gameEvent] = parseGameEvents("黄月英发动集智", "manual", oneVOneDeckProfile)
    const calls: string[] = []
    const engine = new RuleEngine(
      [
        {
          id: "low",
          priority: 0,
          when: { path: "event.event", op: "==", value: "OnSkillInvoke" },
          actions: [{ type: "record", params: { label: "low" } }]
        },
        {
          id: "high",
          priority: 10,
          when: { path: "event.event", op: "==", value: "OnSkillInvoke" },
          actions: [{ type: "record", params: { label: "high" } }]
        }
      ],
      {
        record: (params) => {
          calls.push(String(params.label))
          return params.label === "high" ? { stopPropagation: true } : undefined
        }
      }
    )

    const result = engine.trigger(gameEvent!)

    expect(calls).toEqual(["high"])
    expect(result).toMatchObject({
      matchedRuleIds: ["high"],
      stoppedPropagation: true,
      stoppedByRuleId: "high",
      stoppedByActionType: "record"
    })
  })

  it("clones object and array params resolved from event payload paths", () => {
    const [gameEvent] = parseGameEvents("甄姬获得判定牌青釭剑♠6", "manual", oneVOneDeckProfile)
    const engine = new RuleEngine(
      [
        {
          id: "clone",
          actions: [{ type: "mutate", params: { cards: "$event.cards", card: "$event.card" } }]
        }
      ],
      {
        mutate: (params) => {
          const cards = params.cards as Array<{ name?: string }>
          const card = params.card as { name?: string }
          cards[0]!.name = "污染"
          card.name = "污染"
        }
      }
    )

    engine.trigger(gameEvent!)

    expect(gameEvent?.cards?.[0]?.name).toBe("青釭剑")
    expect(gameEvent?.card?.name).toBe("青釭剑")
  })

  it("trims and case-folds defensive string comparisons", () => {
    const [gameEvent] = parseGameEvents("黄月英发动集智", "manual", oneVOneDeckProfile)
    const calls: string[] = []
    const engine = new RuleEngine(
      [
        {
          id: "eq",
          when: { path: "event.skill", op: "==", value: " 集智 " },
          actions: [{ type: "record", params: { label: "eq" } }]
        },
        {
          id: "contains",
          when: { path: "event.player", op: "contains", value: " 月英 " },
          actions: [{ type: "record", params: { label: "contains" } }]
        },
        {
          id: "in",
          when: { path: "event.event", op: "in", value: [" onskillinvoke "] },
          actions: [{ type: "record", params: { label: "in" } }]
        }
      ],
      {
        record: (params) => {
          calls.push(String(params.label))
        }
      }
    )

    engine.trigger(gameEvent!)

    expect(calls).toEqual(["eq", "contains", "in"])
  })
})
