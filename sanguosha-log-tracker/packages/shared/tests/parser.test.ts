import { describe, expect, it } from "vitest"

import { happyTwoVTwoDeckProfile, oneVOneDeckProfile } from "../src/cards"
import { findCardNameByPartialMatch, mergeBrokenOcrLines, parseLogInput } from "../src/parser"

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

  it("keeps clean self draw pile gain strict", () => {
    const [event] = parseLogInput("界孙坚（您）从摸牌堆获得闪电", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "gainKnown",
      playerName: "界孙坚（您）",
      canonicalPlayerKey: "__self__",
      cardName: "闪电",
      quality: "strict",
      autoAcceptable: true
    })
  })

  it("downgrades suspicious draw pile gain to ambiguous", () => {
    const [event] = parseLogInput("流马5英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "gainKnown",
      cardName: "闪电",
      quality: "ambiguous",
      autoAcceptable: false,
      suspiciousPlayerName: true
    })
    expect(event.note).toContain("玩家名区域异常")
  })

  it("parses public known gain from 五谷丰登", () => {
    const [event] = parseLogInput("公孙現（您）从五谷丰登获得桃", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "gainKnown",
      playerName: "公孙現（您）",
      canonicalPlayerKey: "__self__",
      cardName: "桃",
      quality: "strict",
      autoAcceptable: true,
      note: "公开日志显示从五谷丰登获得具名牌"
    })
  })

  it("maps 挑 to 桃 in public known gain logs", () => {
    const [event] = parseLogInput("公孙環（您）从五谷丰登获得挑", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "gainKnown",
      cardName: "桃",
      quality: "strict",
      autoAcceptable: true
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

  it("finds unique truncated suffix card names conservatively", () => {
    expect(findCardNameByPartialMatch("园结义", happyTwoVTwoDeckProfile)).toMatchObject({
      cardName: "桃园结义",
      matchType: "truncated-suffix"
    })
  })

  it("keeps partial card matches ambiguous and non-auto-acceptable", () => {
    const [event] = parseLogInput("黄月英对周泰（您）使用园结义", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "use",
      cardName: "桃园结义",
      quality: "ambiguous",
      autoAcceptable: false
    })
    expect(event.note).toContain("疑似牌名截断补全")
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
