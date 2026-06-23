import { describe, expect, it } from "vitest"

import {
  addDeckOrderPreviewDetails,
  applyDeckOrderPreviewMove,
  consumeDeckOrderPreviewTop,
  createDeckOrderPreviewState,
  type DeckOrderPreviewConfig
} from "../src/deckOrderPreview"

const config: DeckOrderPreviewConfig = {
  drawPileZone: 1,
  previewZone: 8,
  topPosition: 65280,
  topOrder: "reverse",
  bottomOrder: "as-is"
}

describe("deckOrderPreview", () => {
  it("tracks a generic preview zone without naming the skill", () => {
    let state = createDeckOrderPreviewState()
    const start = applyDeckOrderPreviewMove(state, config, {
      fromZone: 1,
      toZone: 8,
      cardIds: [101, 102, 103],
      at: 10
    })
    expect(start.handled).toBe(true)
    expect(start.started).toBe(true)
    expect(start.state.peekCount).toBe(3)
    state = start.state

    const top = applyDeckOrderPreviewMove(state, config, {
      fromZone: 8,
      toZone: 1,
      toPosition: 65280,
      cardIds: [101, 102],
      at: 20
    })
    expect(top.state.top.map((card) => card.cardId)).toEqual([102, 101])
    expect(top.placedTop).toBe(2)
    state = top.state

    const bottom = applyDeckOrderPreviewMove(state, config, {
      fromZone: 8,
      toZone: 1,
      toPosition: 0,
      cardIds: [103],
      at: 30
    })
    expect(bottom.state.bottom.map((card) => card.cardId)).toEqual([103])
    expect(bottom.placedBottom).toBe(1)
  })

  it("consumes tracked top cards on draw", () => {
    let state = createDeckOrderPreviewState()
    state = applyDeckOrderPreviewMove(state, config, { fromZone: 1, toZone: 8, cardIds: [1, 2, 3], at: 1 }).state
    state = applyDeckOrderPreviewMove(state, config, {
      fromZone: 8,
      toZone: 1,
      toPosition: 65280,
      cardIds: [1, 2, 3],
      at: 2
    }).state

    state = consumeDeckOrderPreviewTop(state, 2)
    expect(state.top.map((card) => card.cardId)).toEqual([1])
  })

  it("queues text details before protocol cards return", () => {
    let state = createDeckOrderPreviewState()
    state = applyDeckOrderPreviewMove(state, config, { fromZone: 1, toZone: 8, cardIds: [11, 12], at: 1 }).state
    state = addDeckOrderPreviewDetails(
      state,
      config,
      "top",
      [
        { name: "杀", suit: "spade", rank: "7" },
        { name: "闪", suit: "heart", rank: "2" }
      ],
      2
    )
    state = applyDeckOrderPreviewMove(state, config, {
      fromZone: 8,
      toZone: 1,
      toPosition: 65280,
      cardIds: [11, 12],
      at: 3
    }).state

    expect(state.top.map((card) => card.detail?.name)).toEqual(["杀", "闪"])
    expect(state.pendingTopDetails).toHaveLength(0)
  })
})
