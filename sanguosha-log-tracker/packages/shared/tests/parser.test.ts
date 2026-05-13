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
      cardName: "过河拆桥",
      quality: "strict",
      autoAcceptable: true
    })
  })

  it("parses direct use logs and prefers long card names", () => {
    const [event] = parseLogInput("郭嘉使用无懈可击", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "use", playerName: "郭嘉", cardName: "无懈可击", quality: "strict" })
  })

  it("parses direct use 闪", () => {
    const [event] = parseLogInput("郭嘉使用闪", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "use", playerName: "郭嘉", cardName: "闪", quality: "strict" })
  })

  it("parses judge result public cards by name only", () => {
    const [event] = parseLogInput("周泰（您）的乐不思蜀判定结果是寒冰剑9", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({
      action: "judge",
      playerName: "周泰（您）",
      cardName: "寒冰剑",
      quality: "strict",
      note: "判定结果公开牌"
    })
  })

  it("parses known draw pile gain by card name", () => {
    const [event] = parseLogInput("郭嘉（您）从摸牌堆获得过河拆桥", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({
      action: "gainKnown",
      playerName: "郭嘉（您）",
      cardName: "过河拆桥",
      quality: "strict"
    })
  })

  it("ignores numeric draw pile gain logs", () => {
    const [event] = parseLogInput("周泰从摸牌堆获得2张牌", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "ignore", quality: "ignored" })
  })

  it("ignores 集智 logs", () => {
    const [event] = parseLogInput("黄月英发动集智", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "ignore", quality: "ignored" })
  })

  it("ignores delayed trick effective logs", () => {
    const [event] = parseLogInput("周泰（您）的乐不思蜀生效", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "ignore", quality: "ignored" })
  })

  it("ignores choose general start logs", () => {
    const [event] = parseLogInput("小杀(普通)选择了刘谌作为武将", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({
      action: "ignore",
      quality: "ignored",
      status: "ignored",
      note: "开局选择武将标记，不计入牌库"
    })
  })

  it("does not auto-accept isolated card names", () => {
    const [event] = parseLogInput("青釭剑6", "manual", oneVOneDeckProfile)

    expect(event?.quality === "ambiguous" || event?.action === "unknown").toBe(true)
    expect(event).toMatchObject({ autoAcceptable: false })
    expect(event?.quality).not.toBe("strict")
  })

  it("marks abnormal multi-card text ambiguous", () => {
    const [event] = parseLogInput("周泰打出杀郭嘉（您）万箭齐发", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ quality: "ambiguous", autoAcceptable: false })
    expect(event?.quality).not.toBe("strict")
  })

  it("normalizes OCR mistakes before matching card names", () => {
    const [event] = parseLogInput("黄月英对周泰（您）使用过问拆桥", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({ action: "use", cardName: "过河拆桥", quality: "strict" })
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
