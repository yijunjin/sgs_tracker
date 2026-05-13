import { describe, expect, it } from "vitest"

import {
  createAutoGameSessionState,
  defaultAutoListenConfig,
  enterGuardMode,
  enterMidGameMode,
  processAutoListenBatch
} from "../src/autoListen"
import { oneVOneDeckProfile } from "../src/cards"
import { createGameStartSignature } from "../src/startSignal"
import { applyEvent, createInitialTrackerState } from "../src/tracker"
import type { TrackerState } from "../src/types"

function applyEvents(state: TrackerState, events: ReturnType<typeof processAutoListenBatch>["events"]): TrackerState {
  return events.reduce((current, event) => applyEvent(current, event), state)
}

describe("auto listener state machine", () => {
  it("moves from armed into inGame after choose general signal", () => {
    const result = processAutoListenBatch({
      state: enterGuardMode(createAutoGameSessionState()),
      lines: [{ text: "小杀(普通)选择了刘谌作为武将", score: 0.98 }],
      deckProfile: oneVOneDeckProfile,
      now: 1
    })

    expect(result.resetTracker).toBe(true)
    expect(result.nextState.mode).toBe("inGame")
    expect(result.nextState.startMode).toBe("newGame")
  })

  it("keeps choose general lines out of deck updates", () => {
    const result = processAutoListenBatch({
      state: enterGuardMode(createAutoGameSessionState()),
      lines: [{ text: "小杀(普通)选择了刘谌作为武将", score: 0.98 }],
      deckProfile: oneVOneDeckProfile,
      now: 1
    })

    const trackerState = applyEvents(createInitialTrackerState(oneVOneDeckProfile), result.events)
    expect(result.events).toHaveLength(0)
    expect(trackerState.cycleSeenCounts["杀"]).toBe(0)
  })

  it("does not reset again for the same game-start signature inGame", () => {
    const signalLines = [{ text: "小杀(普通)选择了刘谌作为武将", score: 0.98 }]
    const initial = processAutoListenBatch({
      state: enterGuardMode(createAutoGameSessionState()),
      lines: signalLines,
      deckProfile: oneVOneDeckProfile,
      now: 1
    })

    const repeated = processAutoListenBatch({
      state: {
        ...initial.nextState,
        currentGameStartSignature: createGameStartSignature(initial.signal!),
        hasEnteredInGame: true
      },
      lines: signalLines,
      deckProfile: oneVOneDeckProfile,
      now: 5_000
    })

    expect(repeated.resetTracker).toBe(false)
  })

  it("continues parsing lines after the last choose-general line", () => {
    const result = processAutoListenBatch({
      state: enterGuardMode(createAutoGameSessionState()),
      lines: [
        { text: "小杀(普通)选择了刘谌作为武将", score: 0.98 },
        { text: "郭嘉（您）从摸牌堆获得过河拆桥", score: 0.97 }
      ],
      deckProfile: oneVOneDeckProfile,
      now: 1
    })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ action: "gainKnown", cardName: "过河拆桥", status: "accepted" })
  })

  it("auto accepts strict events when enabled", () => {
    const result = processAutoListenBatch({
      state: {
        ...createAutoGameSessionState(),
        mode: "inGame",
        hasEnteredInGame: true,
        startMode: "newGame",
        baselineStatus: "complete"
      },
      lines: [{ text: "黄月英对周泰（您）使用过河拆桥", score: 0.99 }],
      deckProfile: oneVOneDeckProfile,
      now: 2
    })

    expect(result.events[0]).toMatchObject({ quality: "strict", status: "accepted" })
  })

  it("does not auto accept ambiguous events", () => {
    const result = processAutoListenBatch({
      state: {
        ...createAutoGameSessionState(),
        mode: "inGame",
        hasEnteredInGame: true,
        startMode: "newGame",
        baselineStatus: "complete"
      },
      lines: [{ text: "青釭剑6", score: 0.99 }],
      deckProfile: oneVOneDeckProfile,
      now: 2
    })

    expect(result.events[0]).toMatchObject({ quality: "ambiguous", status: "pending" })
  })

  it("primes the first OCR batch in mid-game mode without updating deck", () => {
    const result = processAutoListenBatch({
      state: enterMidGameMode(createAutoGameSessionState()),
      lines: [{ text: "黄月英对周泰（您）使用过河拆桥", score: 0.99 }],
      deckProfile: oneVOneDeckProfile,
      now: 2
    })

    expect(result.events).toHaveLength(0)
    expect(result.primedLineCount).toBe(1)
    expect(result.nextState.baselineStatus).toBe("complete")
  })

  it("resets into newGame complete mode after choose general signal", () => {
    const result = processAutoListenBatch({
      state: enterGuardMode(createAutoGameSessionState()),
      lines: [
        { text: "小杀(普通)选择了刘谌作为武将", score: 0.98 },
        { text: "孙鲁班从摸牌堆获得5张牌", score: 0.97 }
      ],
      deckProfile: oneVOneDeckProfile,
      config: {
        ...defaultAutoListenConfig,
        autoAcceptStrictEvents: false
      },
      now: 10
    })

    expect(result.resetTracker).toBe(true)
    expect(result.nextState.startMode).toBe("newGame")
    expect(result.nextState.baselineStatus).toBe("complete")
    expect(result.nextState.hasEnteredInGame).toBe(true)
  })
})