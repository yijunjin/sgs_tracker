import { describe, expect, it } from "vitest"

import {
  createDeckRemainingSamplerState,
  parseDeckRemainingFromText,
  updateDeckRemainingSample
} from "../src/deckRemaining"
import { oneVOneDeckProfile } from "../src/cards"
import { createInitialTrackerState, updateDeckRemainingState } from "../src/tracker"

describe("deck remaining OCR helpers", () => {
  it("parses preferred deck count formats", () => {
    expect(parseDeckRemainingFromText("剩余牌12", 52)).toBe(12)
    expect(parseDeckRemainingFromText("剩余牌 0", 52)).toBe(0)
  })

  it("rejects values beyond deck total", () => {
    expect(parseDeckRemainingFromText("剩余牌99", 52)).toBeUndefined()
  })

  it("corrects lightweight OCR mistakes", () => {
    expect(parseDeckRemainingFromText("余牌I2", 52)).toBe(12)
  })

  it("requires two equal samples before stable", () => {
    const sampler = createDeckRemainingSamplerState()
    expect(updateDeckRemainingSample(sampler, 12, 52)).toEqual({ stableRemaining: undefined, changed: false })
    expect(updateDeckRemainingSample(sampler, 12, 52)).toEqual({ stableRemaining: 12, changed: true })
  })

  it("creates pending reshuffle alert on low-to-high jump", () => {
    let state = createInitialTrackerState(oneVOneDeckProfile)
    state = updateDeckRemainingState(state, 1, "剩余牌1", 1000)
    state = updateDeckRemainingState(state, 31, "剩余牌31", 2000)

    expect(state.pendingReshuffleAlert).toMatchObject({
      previousRemaining: 1,
      currentRemaining: 31,
      status: "pending"
    })
  })
})
