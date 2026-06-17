import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  applyDeckPileMove,
  createDeckPileState,
  deckMoveCount,
  seedDeckPile,
  type DeckMoveInput,
  type DeckPileState
} from "../src/deckPile"

const TOTAL = 52

type RawMove = {
  fromZone: number | undefined
  toZone: number | undefined
  cardCount: number | undefined
  moveType: number | undefined
  cardIds: number[]
}

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const realMoves: RawMove[] = JSON.parse(
  readFileSync(join(fixtureDir, "fixtures/oneVOne-moves.json"), "utf8")
)

// 1v1 实体牌号固定区间 2001..2052
const isKnown1v1 = (id: number) => id >= 2001 && id <= 2052

function replay(state: DeckPileState): {
  state: DeckPileState
  reshuffles: number
  discardSyncs: number
  minRemaining: number
  maxRemaining: number
  sawNegativeAttempt: boolean
} {
  let s = state
  let reshuffles = 0
  let discardSyncs = 0
  let minRemaining = Infinity
  let maxRemaining = -Infinity
  let sawNegativeAttempt = false
  for (const m of realMoves) {
    const ev: DeckMoveInput = {
      fromZone: m.fromZone,
      toZone: m.toZone,
      cardCount: m.cardCount,
      moveType: m.moveType,
      deckCardCount: deckMoveCount(m.cardIds, m.cardCount ?? 0, isKnown1v1)
    }
    if (m.fromZone === 1 && m.toZone !== 1 && s.remaining !== undefined && s.remaining - ev.deckCardCount < 0) {
      sawNegativeAttempt = true
    }
    const out = applyDeckPileMove(s, ev, TOTAL)
    s = out.state
    if (out.didReshuffle) reshuffles++
    if (out.discardSync) discardSyncs++
    if (s.remaining !== undefined) {
      minRemaining = Math.min(minRemaining, s.remaining)
      maxRemaining = Math.max(maxRemaining, s.remaining)
    }
  }
  return { state: s, reshuffles, discardSyncs, minRemaining, maxRemaining, sawNegativeAttempt }
}

describe("deckPile core logic", () => {
  it("deckMoveCount counts hidden draw cards by CardCount (not by known ids)", () => {
    // 暗牌摸牌：cardIds=[0,0]，旧逻辑返回 0 导致漏减；现按 cardCount 计
    expect(deckMoveCount([0, 0], 2, isKnown1v1)).toBe(2)
    expect(deckMoveCount([0, 0, 0, 0], 4, isKnown1v1)).toBe(4)
    // 明置摸牌：真实 id 可识别
    expect(deckMoveCount([2039], 1, isKnown1v1)).toBe(1)
    // 无 cardIds：回退 cardCount
    expect(deckMoveCount([], 3, isKnown1v1)).toBe(3)
    // 未知 id 但确有牌移动：按张数计，不返回 0
    expect(deckMoveCount([9999], 1, isKnown1v1)).toBe(1)
  })

  it("seed sets calibrated and full deck", () => {
    const s = seedDeckPile(TOTAL)
    expect(s.remaining).toBe(TOTAL)
    expect(s.calibrated).toBe(true)
  })

  it("draw from deck decrements; clamps at 0 without phantom reshuffle", () => {
    let s = seedDeckPile(TOTAL)
    s = applyDeckPileMove(s, { fromZone: 1, toZone: 5, cardCount: 2, moveType: 1, deckCardCount: 2 }, TOTAL).state
    expect(s.remaining).toBe(50)
    // 连续摸到触底，只夹到 0，不应误判洗牌
    for (let i = 0; i < 60; i++) {
      s = applyDeckPileMove(s, { fromZone: 1, toZone: 5, cardCount: 2, moveType: 1, deckCardCount: 2 }, TOTAL).state
    }
    expect(s.remaining).toBe(0)
    expect(s.reshuffleCount).toBe(0)
  })

  it("discard-sync cardCount is authoritative deck remaining; growth means reshuffle", () => {
    // 已校准、牌堆剩 5：同步报 5 → 普通快照，不洗牌
    let s: DeckPileState = { remaining: 5, calibrated: true, reshuffleCount: 0 }
    const shrink = applyDeckPileMove(s, { fromZone: 2, toZone: 9, cardCount: 5, moveType: 255, deckCardCount: 0 }, TOTAL)
    expect(shrink.discardSync).toBe(true)
    expect(shrink.didReshuffle).toBe(false)
    expect(shrink.state.remaining).toBe(5)
    // 同步报 52（比 5 大）→ 弃牌洗回牌堆 → 洗牌
    s = shrink.state
    const grow = applyDeckPileMove(s, { fromZone: 2, toZone: 9, cardCount: 52, moveType: 255, deckCardCount: 0 }, TOTAL)
    expect(grow.didReshuffle).toBe(true)
    expect(grow.state.reshuffleCount).toBe(1)
    expect(grow.state.remaining).toBe(52)
    expect(grow.state.calibrated).toBe(true)
  })

  it("first discard-sync only calibrates (never counts as reshuffle)", () => {
    // 中途接入：未校准，本地起点是猜测的满牌堆，摸到 11
    let s: DeckPileState = { remaining: 11, calibrated: false, reshuffleCount: 0 }
    // 首次同步报 48（看似涨了）只是权威校准，不算洗牌
    const first = applyDeckPileMove(s, { fromZone: 2, toZone: 9, cardCount: 48, moveType: 255, deckCardCount: 0 }, TOTAL)
    expect(first.discardSync).toBe(true)
    expect(first.didReshuffle).toBe(false)
    expect(first.state.calibrated).toBe(true)
    expect(first.state.remaining).toBe(48)
  })

  it("replays 542 real captured moves: authoritative calibration, no negatives", () => {
    // 中途接入：起点未校准
    const r = replay(createDeckPileState())
    // 首次同步只校准；其后牌堆 4 次真实涨大（弃牌洗回）→ 5 次洗牌
    expect(r.reshuffles).toBe(5)
    // 弃牌堆同步事件总数
    expect(r.discardSyncs).toBe(9)
    // 牌堆数全程 0..52，权威校准后不为负
    expect(r.minRemaining).toBeGreaterThanOrEqual(0)
    expect(r.maxRemaining).toBeLessThanOrEqual(TOTAL)
    // 每个出牌循环都有权威同步校准，牌堆不会被摸到“想减成负数”——印证校准模型有效
    expect(r.sawNegativeAttempt).toBe(false)
    // 第一次弃牌堆同步后即完成校准
    expect(r.state.calibrated).toBe(true)
  })

  it("calibrates after the very first discard-sync snapshot", () => {
    // 从未校准开始，遇到第一个弃牌堆同步即转为已校准
    let s = createDeckPileState()
    expect(s.calibrated).toBe(false)
    for (const m of realMoves) {
      const out = applyDeckPileMove(
        s,
        {
          fromZone: m.fromZone,
          toZone: m.toZone,
          cardCount: m.cardCount,
          moveType: m.moveType,
          deckCardCount: deckMoveCount(m.cardIds, m.cardCount ?? 0, isKnown1v1)
        },
        TOTAL
      )
      s = out.state
      if (out.discardSync) break
    }
    expect(s.calibrated).toBe(true)
  })
})
