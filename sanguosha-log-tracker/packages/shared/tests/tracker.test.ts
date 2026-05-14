import { describe, expect, it } from "vitest"

import { happyTwoVTwoDeckProfile, oneVOneDeckProfile } from "../src/cards"
import { applyEvent, confirmReshuffle, createInitialTrackerState, rejectEvent, undoLastEvent, wouldExceedCycleTotal } from "../src/tracker"
import type { ParsedLogEvent } from "../src/types"

function createEvent(partial: Partial<ParsedLogEvent>): ParsedLogEvent {
  return {
    id: partial.id ?? "event-1",
    rawText: partial.rawText ?? "黄月英对周泰（您）使用过河拆桥",
    normalizedText: partial.normalizedText ?? "黄月英对周泰（您）使用过河拆桥",
    normalizedRawText: partial.normalizedRawText ?? "黄月英对周泰（您）使用过河拆桥",
    playerName: partial.playerName ?? "黄月英",
    targetName: partial.targetName,
    action: partial.action ?? "use",
    cardName: partial.cardName ?? "过河拆桥",
    confidence: partial.confidence ?? 0.99,
    source: partial.source ?? "manual",
    status: partial.status ?? "accepted",
    quality: partial.quality ?? "strict",
    autoAcceptable: partial.autoAcceptable ?? true,
    supportStatus: partial.supportStatus,
    note: partial.note,
    fingerprint: partial.fingerprint ?? partial.rawText ?? "黄月英对周泰（您）使用过河拆桥",
    createdAt: partial.createdAt ?? new Date().toISOString()
  }
}

describe("tracker", () => {
  it("uses the 1v1 deck by default in tests", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)

    expect(state.cycleRemainingCounts["杀"]).toBe(16)
    expect(Object.values(state.cycleRemainingCounts).reduce((sum, count) => sum + count, 0)).toBe(52)
  })

  it("updates cycle and history counts after accepted use 闪", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(state, createEvent({ id: "flash", rawText: "郭嘉使用闪", playerName: "郭嘉", cardName: "闪" }))

    expect(nextState.cycleSeenCounts["闪"]).toBe(1)
    expect(nextState.historySeenCounts["闪"]).toBe(1)
    expect(nextState.cycleRemainingCounts["闪"]).toBe(7)
  })

  it("does not update ignored events", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(
      state,
      createEvent({
        id: "ignored",
        rawText: "黄月英发动集智",
        action: "ignore",
        cardName: undefined,
        status: "ignored",
        quality: "ignored",
        autoAcceptable: false
      })
    )

    expect(nextState.cycleSeenCounts["过河拆桥"]).toBe(0)
    expect(nextState.recentEvents).toHaveLength(0)
  })

  it("does not update unsupported cards", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(
      state,
      createEvent({
        id: "unsupported",
        rawText: "黄盖使用酒",
        playerName: "黄盖",
        cardName: "酒"
      })
    )

    expect(nextState.cycleSeenCounts["酒"]).toBeUndefined()
    expect(nextState.events[0]).toMatchObject({ supportStatus: "unsupported", quality: "unsupported" })
    expect(nextState.recentEvents).toHaveLength(0)
  })

  it("tracks gainKnown cards by player", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(
      state,
      createEvent({
        id: "gain-known",
        rawText: "郭嘉（您）从摸牌堆获得过河拆桥",
        playerName: "郭嘉（您）",
        action: "gainKnown",
        cardName: "过河拆桥"
      })
    )

    expect(nextState.cycleSeenCounts["过河拆桥"]).toBe(1)
    expect(nextState.knownCardsByPlayer["__self__"]?.["过河拆桥"]).toBe(1)
  })

  it("consumes known hand card without double-counting later use", () => {
    let state = createInitialTrackerState(happyTwoVTwoDeckProfile)
    state = applyEvent(
      state,
      createEvent({
        id: "gain-known",
        playerName: "郭嘉（您）",
        action: "gainKnown",
        cardName: "过河拆桥"
      })
    )
    state = applyEvent(
      state,
      createEvent({
        id: "use-known",
        rawText: "郭嘉（您）对周泰使用过河拆桥",
        playerName: "郭嘉（您）",
        targetName: "周泰",
        action: "use",
        cardName: "过河拆桥"
      })
    )

    expect(state.cycleSeenCounts["过河拆桥"]).toBe(1)
    expect(state.historySeenCounts["过河拆桥"]).toBe(1)
    expect(state.knownCardsByPlayer["__self__"]?.["过河拆桥"]).toBeUndefined()
    expect(state.events.find((event) => event.id === "use-known")).toMatchObject({ impactCount: 0 })
  })

  it("uses canonical player key for dirty gainKnown then clean use", () => {
    let state = createInitialTrackerState(happyTwoVTwoDeckProfile)
    state = applyEvent(
      state,
      createEvent({
        id: "dirty-gain",
        rawText: "流马5英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电",
        playerName: "流马5英魂奔雷木牛流马界孙坚（您）",
        action: "gainKnown",
        cardName: "闪电",
        cardNames: ["闪电"]
      })
    )
    state = applyEvent(
      state,
      createEvent({
        id: "clean-use",
        rawText: "界孙坚（您）使用闪电",
        playerName: "界孙坚（您）",
        action: "use",
        cardName: "闪电"
      })
    )

    expect(state.cycleSeenCounts["闪电"]).toBe(1)
    expect(state.events.find((event) => event.id === "clean-use")).toMatchObject({ impactCount: 0, consumedKnownCard: true })
    expect(state.knownCardsByPlayer["__self__"]?.["闪电"]).toBeUndefined()
  })

  it("counts judge cards as newly seen", () => {
    const state = applyEvent(
      createInitialTrackerState(oneVOneDeckProfile),
      createEvent({
        id: "judge",
        action: "judge",
        cardName: "寒冰剑"
      })
    )

    expect(state.cycleSeenCounts["寒冰剑"]).toBe(1)
  })

  it("confirm reshuffle resets cycle counts and keeps history", () => {
    const state = applyEvent(createInitialTrackerState(oneVOneDeckProfile), createEvent({ id: "flash", cardName: "闪" }))
    const reshuffled = confirmReshuffle(state)

    expect(reshuffled.cycleId).toBe(2)
    expect(reshuffled.cycleSeenCounts["闪"]).toBe(0)
    expect(reshuffled.historySeenCounts["闪"]).toBe(1)
  })

  it("does not warn when only history exceeds total counts", () => {
    let state = createInitialTrackerState(happyTwoVTwoDeckProfile)
    for (let index = 0; index < 9; index += 1) {
      state = applyEvent(state, createEvent({ id: `flash-${index}`, cardName: "闪", rawText: `郭嘉使用闪${index}` }))
    }
    state = confirmReshuffle(state)

    expect(state.historySeenCounts["闪"]).toBe(9)
    expect(state.warnings).toHaveLength(0)
  })

  it("warns only when cycle counts exceed total counts", () => {
    let state = createInitialTrackerState(oneVOneDeckProfile)
    for (let index = 0; index < 9; index += 1) {
      state = applyEvent(state, createEvent({ id: `flash-over-${index}`, cardName: "闪", rawText: `郭嘉打出闪${index}`, action: "play" }))
    }

    expect(state.cycleSeenCounts["闪"]).toBe(9)
    expect(state.warnings.find((warning) => warning.cardName === "闪")).toBeTruthy()
  })

  it("undoLastEvent restores counts and known cards", () => {
    let state = createInitialTrackerState(oneVOneDeckProfile)
    state = applyEvent(state, createEvent({ id: "gain-known", playerName: "郭嘉（您）", action: "gainKnown", cardName: "过河拆桥" }))
    state = applyEvent(state, createEvent({ id: "use-known", playerName: "郭嘉（您）", action: "use", cardName: "过河拆桥" }))

    const undoneUse = undoLastEvent(state)
    expect(undoneUse.knownCardsByPlayer["__self__"]?.["过河拆桥"]).toBe(1)
    expect(undoneUse.cycleSeenCounts["过河拆桥"]).toBe(1)

    const undoneGain = undoLastEvent(undoneUse)
    expect(undoneGain.knownCardsByPlayer["__self__"]?.["过河拆桥"]).toBeUndefined()
    expect(undoneGain.cycleSeenCounts["过河拆桥"]).toBe(0)
  })

  it("rolls back counts when marking an accepted event misrecognized", () => {
    let state = createInitialTrackerState(happyTwoVTwoDeckProfile)
    state = applyEvent(state, createEvent({ id: "lightning", playerName: "界孙坚（您）", cardName: "闪电" }))

    const rejected = rejectEvent(state, "lightning")
    expect(rejected.cycleSeenCounts["闪电"]).toBe(0)
    expect(rejected.historySeenCounts["闪电"]).toBe(0)
  })

  it("detects over-limit before auto accept", () => {
    let state = createInitialTrackerState(happyTwoVTwoDeckProfile)
    state = applyEvent(state, createEvent({ id: "lightning-1", playerName: "界孙坚（您）", cardName: "闪电" }))
    state = applyEvent(state, createEvent({ id: "lightning-2", playerName: "郭嘉", cardName: "闪电" }))

    expect(wouldExceedCycleTotal(state, createEvent({ id: "lightning-3", playerName: "黄月英", cardName: "闪电", status: "pending" }))).toBe(true)
  })
})

