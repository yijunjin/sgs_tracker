import { describe, expect, it } from "vitest"

import { oneVOneDeckProfile } from "../src/cards"
import { mergeBrokenOcrLines, parseLogInput } from "../src/parser"

describe("parseLogInput", () => {
  it("parses target use logs without brackets", () => {
    const [event] = parseLogInput("黄月英对周泰（您）使用过河拆桥", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({
      action: "use",
      playerName: "黄月英",
      targetName: "周泰（您）",
      cardName: "过河拆桥"
    })
  })

  it("parses direct use logs without brackets", () => {
    const [event] = parseLogInput("郭嘉使用闪", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "use", playerName: "郭嘉", cardName: "闪" })
  })

  it("prefers long card names", () => {
    const [event] = parseLogInput("郭嘉使用无懈可击", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "use", playerName: "郭嘉", cardName: "无懈可击" })
  })

  it("parses judge result public cards by name only", () => {
    const [event] = parseLogInput("周泰（您）的乐不思蜀判定结果是寒冰剑9", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({
      action: "judge",
      playerName: "周泰（您）",
      cardName: "寒冰剑",
      note: "判定结果公开牌"
    })
  })

  it("merges broken OCR lines for 过河拆桥", () => {
    const merged = mergeBrokenOcrLines(
      [
        { text: "黄月英对周泰（您）使用过河拆", score: 0.96 },
        { text: "桥", score: 0.94 }
      ],
      oneVOneDeckProfile
    )

    expect(merged.map((line) => line.text)).toEqual(["黄月英对周泰（您）使用过河拆桥"])
    expect(parseLogInput(merged, "ocr", oneVOneDeckProfile)[0]).toMatchObject({ cardName: "过河拆桥" })
  })

  it("merges broken OCR lines for 无懈可击", () => {
    const merged = mergeBrokenOcrLines(
      [
        { text: "郭嘉使用无懈可", score: 0.96 },
        { text: "击", score: 0.94 }
      ],
      oneVOneDeckProfile
    )

    expect(merged.map((line) => line.text)).toEqual(["郭嘉使用无懈可击"])
    expect(parseLogInput(merged, "ocr", oneVOneDeckProfile)[0]).toMatchObject({ cardName: "无懈可击" })
  })

  it("ignores draw pile gain logs", () => {
    const [event] = parseLogInput("黄月英从摸牌堆获得1张牌", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "ignore", status: "ignored" })
  })

  it("ignores 集智 logs", () => {
    const [event] = parseLogInput("黄月英发动集智", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "ignore", status: "ignored" })
  })

  it("ignores delayed trick effective logs", () => {
    const [event] = parseLogInput("周泰（您）的乐不思蜀生效", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "ignore", status: "ignored" })
  })

  it("normalizes OCR mistakes before matching card names", () => {
    const [event] = parseLogInput("黄月英对周泰（您）使用过问拆桥", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "use", cardName: "过河拆桥" })
  })

  it("keeps bracketed logs compatible", () => {
    const events = parseLogInput(
      [
        "刘备 使用了【杀】",
        "曹操 打出了【闪】",
        "孙权 弃置了【桃】",
        "司马懿 判定牌为【黑桃2 八卦阵】"
      ].join("\n"),
      "manual",
      oneVOneDeckProfile
    )

    expect(events[0]).toMatchObject({ playerName: "刘备", action: "use", cardName: "杀" })
    expect(events[1]).toMatchObject({ playerName: "曹操", action: "play", cardName: "闪" })
    expect(events[2]).toMatchObject({ playerName: "孙权", action: "discard", cardName: "桃" })
    expect(events[3]).toMatchObject({ playerName: "司马懿", action: "judge", suit: "黑桃", rank: "2", cardName: "八卦阵" })
  })
})
