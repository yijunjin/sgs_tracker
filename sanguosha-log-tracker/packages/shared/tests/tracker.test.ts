import { describe, expect, it } from "vitest"

import { oneVOneDeckProfile } from "../src/cards"
import { applyEvent, createInitialTrackerState, undoLastEvent } from "../src/tracker"
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
    supportStatus: partial.supportStatus,
    note: partial.note,
    fingerprint: partial.fingerprint ?? partial.rawText ?? "黄月英对周泰（您）使用过河拆桥",
    createdAt: partial.createdAt ?? new Date().toISOString()
  }
}

describe("tracker", () => {
  it("uses the 1v1 deck by default in tests", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)

    expect(state.remainingCounts["杀"]).toBe(16)
    expect(Object.values(state.remainingCounts).reduce((sum, count) => sum + count, 0)).toBe(52)
  })

  it("updates seen count after accepted 过河拆桥", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(state, createEvent({ cardName: "过河拆桥" }))

    expect(nextState.seenCounts["过河拆桥"]).toBe(1)
    expect(nextState.remainingCounts["过河拆桥"]).toBe(2)
  })

  it("updates seen count after accepted 闪", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(
      state,
      createEvent({
        id: "event-flash",
        rawText: "郭嘉使用闪",
        normalizedText: "郭嘉使用闪",
        normalizedRawText: "郭嘉使用闪",
        playerName: "郭嘉",
        cardName: "闪",
        fingerprint: "郭嘉使用闪"
      })
    )

    expect(nextState.seenCounts["闪"]).toBe(1)
    expect(nextState.remainingCounts["闪"]).toBe(7)
  })

  it("does not update ignored events", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(
      state,
      createEvent({
        id: "ignored",
        rawText: "黄月英发动集智",
        normalizedText: "黄月英发动集智",
        normalizedRawText: "黄月英发动集智",
        action: "ignore",
        cardName: undefined,
        status: "ignored",
        fingerprint: "黄月英发动集智"
      })
    )

    expect(nextState.seenCounts["过河拆桥"]).toBe(0)
    expect(nextState.recentEvents).toHaveLength(0)
  })

  it("does not update unsupported cards", () => {
    const state = createInitialTrackerState(oneVOneDeckProfile)
    const nextState = applyEvent(
      state,
      createEvent({
        id: "unsupported",
        rawText: "黄盖使用酒",
        normalizedText: "黄盖使用酒",
        normalizedRawText: "黄盖使用酒",
        playerName: "黄盖",
        cardName: "酒",
        fingerprint: "黄盖使用酒"
      })
    )

    expect(nextState.seenCounts["酒"]).toBeUndefined()
    expect(nextState.events[0]).toMatchObject({ supportStatus: "unsupported" })
    expect(nextState.recentEvents).toHaveLength(0)
  })

  it("undoLastEvent restores counts", () => {
    const state = applyEvent(createInitialTrackerState(oneVOneDeckProfile), createEvent({ cardName: "闪" }))
    const undoneState = undoLastEvent(state)

    expect(undoneState.seenCounts["闪"]).toBe(0)
    expect(undoneState.remainingCounts["闪"]).toBe(8)
  })

  it("keeps remaining counts non-negative", () => {
    let state = createInitialTrackerState(oneVOneDeckProfile)
    for (let index = 0; index < 10; index += 1) {
      state = applyEvent(
        state,
        createEvent({
          id: `flash-${index}`,
          rawText: `郭嘉使用闪${index}`,
          normalizedText: `郭嘉使用闪${index}`,
          normalizedRawText: `郭嘉使用闪${index}`,
          cardName: "闪",
          fingerprint: `郭嘉使用闪${index}`
        })
      )
    }

    expect(state.remainingCounts["闪"]).toBe(0)
  })

  it("marks over-seen cards", () => {
    let state = createInitialTrackerState(oneVOneDeckProfile)
    for (let index = 0; index < 10; index += 1) {
      state = applyEvent(
        state,
        createEvent({
          id: `flash-over-${index}`,
          rawText: `郭嘉打出闪${index}`,
          normalizedText: `郭嘉打出闪${index}`,
          normalizedRawText: `郭嘉打出闪${index}`,
          action: "play",
          cardName: "闪",
          fingerprint: `郭嘉打出闪${index}`
        })
      )
    }

    expect(state.seenCounts["闪"]).toBe(10)
    expect(state.overSeenWarnings["闪"]).toBe(2)
  })
})
