import { describe, expect, it, vi } from "vitest"

import { detectGameStartSignal, isChooseGeneralLine, normalizeStartSignalText } from "../src/startSignal"

describe("startSignal", () => {
  it("detects choose general lines", () => {
    expect(isChooseGeneralLine("小杀(普通)选择了刘谌作为武将")).toBe(true)
    expect(isChooseGeneralLine("北伐军、呜呜选择了郭嘉作为武将")).toBe(true)
    expect(isChooseGeneralLine("小杀(普通)选择了孙鲁班作为武将")).toBe(true)
    expect(isChooseGeneralLine("郭嘉从摸牌堆获得2张牌")).toBe(false)
  })

  it("normalizes common OCR start-signal mistakes", () => {
    expect(normalizeStartSignalText("小杀选挥了刘谌作为武蒋")).toContain("选择了刘谌作为武将")
    expect(isChooseGeneralLine("小杀选挥了刘谌作为武蒋")).toBe(true)
  })

  it("builds a game start signal when choose lines are present", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"))

    const signal = detectGameStartSignal([
      { text: "小杀选挥了刘谌作为武蒋", score: 0.92 },
      { text: "郭嘉从摸牌堆获得2张牌", score: 0.95 },
      { text: "剩余牌 43", score: 0.88 }
    ])

    expect(signal).toMatchObject({
      chooseLines: ["小杀选择了刘谌作为武将"],
      chooseLineIndexes: [0],
      detectedAt: new Date("2026-05-14T12:00:00Z").getTime()
    })
    expect(signal?.confidence).toBeGreaterThan(0.7)

    vi.useRealTimers()
  })
})