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

  it("maps the harmonized 借刀 label to 借刀杀人", () => {
    const [event] = parseLogInput("刘协使用借刀♣Q", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "use",
      playerName: "刘协",
      cardName: "借刀杀人",
      suit: "梅花",
      rank: "Q",
      quality: "strict",
      autoAcceptable: true
    })
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

  it("parses 洛神/再起 获得判定牌 as owner-visible gainKnown", () => {
    const [event] = parseLogInput("甄姬获得判定牌青釭剑♠6", "manual", oneVOneDeckProfile)

    expect(event).toMatchObject({
      action: "gainKnown",
      playerName: "甄姬",
      cardName: "青釭剑",
      suit: "黑桃",
      rank: "6",
      quality: "strict"
    })
  })

  it("keeps clean self draw pile gain strict", () => {    const [event] = parseLogInput("界孙坚（您）从摸牌堆获得闪电", "manual", happyTwoVTwoDeckProfile)

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

  it("parses comma-separated discarded cards as one multi-card event", () => {
    const [event] = parseLogInput("界华佗弃置杀♣8,闪♦J", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "discard",
      playerName: "界华佗",
      cardName: "杀",
      cardNames: ["杀", "闪"],
      quality: "strict",
      autoAcceptable: true
    })
    expect(event?.note).toContain("弃置多张牌")
  })

  it("parses pindian cards as discarded public cards", () => {
    const [event] = parseLogInput(
      "界荀彧与界张辽(您)拼点，界荀彧的拼点牌为闪电♥Q,界张辽(您)的拼点牌为铁索连环♠J,界荀彧赢",
      "manual",
      happyTwoVTwoDeckProfile
    )

    expect(event).toMatchObject({
      action: "discard",
      playerName: "界荀彧",
      targetName: "界张辽(您)",
      cardName: "闪电",
      cardNames: ["闪电", "铁索连环"],
      quality: "strict",
      autoAcceptable: true
    })
    expect(event?.note).toContain("拼点公开并弃置多张牌")
  })

  it("parses cards gained from another player's equipment as known hand transfer", () => {
    const [event] = parseLogInput("沮授从简雍(您)的装备区获得青龙偃月刀♠5", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "gainKnown",
      playerName: "沮授",
      targetName: "简雍（您）",
      sourcePlayerName: "简雍（您）",
      sourceZone: "装备区",
      cardName: "青龙偃月刀",
      quality: "strict",
      autoAcceptable: true
    })
  })

  it("parses discarding another player's card with that player as the source", () => {
    const [event] = parseLogInput("简雍(您)弃置沮授的八卦阵♠2", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "discard",
      playerName: "简雍（您）",
      targetName: "沮授",
      sourcePlayerName: "沮授",
      cardName: "八卦阵",
      quality: "strict",
      autoAcceptable: true
    })
  })

  it("parses recast cards as discarded public cards", () => {
    const [event] = parseLogInput("简雍(您)重铸铁索连环♣J", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "discard",
      playerName: "简雍（您）",
      cardName: "铁索连环",
      quality: "strict",
      autoAcceptable: true,
      note: "重铸牌进入弃牌堆"
    })
  })

  it("parses skill discards as discarded public cards", () => {
    const [event] = parseLogInput("孙权发动制衡，弃置杀♣8,闪♦J", "manual", happyTwoVTwoDeckProfile)

    expect(event).toMatchObject({
      action: "discard",
      playerName: "孙权",
      cardName: "杀",
      cardNames: ["杀", "闪"],
      quality: "strict",
      autoAcceptable: true
    })
    expect(event?.note).toContain("制衡弃置多张牌")
  })

  it("ignores card description text for recast", () => {
    const [event] = parseLogInput(
      "出牌阶段，对一至两名角色使用。目标进入或解除“连环”状态。重铸：出牌阶段，你可以将此牌置入弃牌堆，然后摸一张牌。",
      "manual",
      happyTwoVTwoDeckProfile
    )

    expect(event).toMatchObject({ action: "ignore", quality: "ignored" })
  })
})
