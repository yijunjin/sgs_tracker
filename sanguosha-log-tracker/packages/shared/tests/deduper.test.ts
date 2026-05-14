import { describe, expect, it } from "vitest"

import { applySemanticEventDedupe, createSemanticEventDeduper, createSemanticEventKey, createVisibleLogDeduper } from "../src/dedupe"

describe("createVisibleLogDeduper", () => {
  it("skips unchanged visible lines", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(0)
  })

  it("counts repeated occurrences in the visible window", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
    expect(deduper.getNewLines(["郭嘉使用闪", "郭嘉使用闪"])).toHaveLength(1)
  })

  it("treats first visible line as new", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
  })

  it("allows the same text again after it rolled out", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
    expect(deduper.getNewLines([])).toHaveLength(0)
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
  })

  it("treats semantic-equivalent OCR variants as duplicates", () => {
    const deduper = createSemanticEventDeduper()
    const raw1 = {
      id: "evt-1",
      rawText: "流马5英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电",
      normalizedText: "流马5英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电",
      normalizedRawText: "流马5英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电",
      playerName: "流马5英魂奔雷木牛流马界孙坚（您）",
      canonicalPlayerKey: "__self__",
      action: "gainKnown",
      cardName: "闪电",
      cardNames: ["闪电"],
      confidence: 0.95,
      source: "ocr" as const,
      status: "pending" as const,
      quality: "ambiguous" as const,
      autoAcceptable: false,
      cycleId: 1,
      fingerprint: "a",
      createdAt: new Date().toISOString()
    }
    const raw2 = {
      ...raw1,
      id: "evt-2",
      rawText: "流马英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电",
      normalizedText: "流马英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电",
      normalizedRawText: "流马英魂奔雷木牛流马界孙坚（您）从摸牌堆获得闪电",
      fingerprint: "b"
    }

    expect(createSemanticEventKey(raw1)).toBe("1|__self__|-|gainKnown|闪电")
    expect(createSemanticEventKey(raw2)).toBe("1|__self__|-|gainKnown|闪电")

    expect(deduper.markAndCheck(raw1)).toMatchObject({ duplicate: false })
    expect(deduper.markAndCheck(raw2)).toMatchObject({ duplicate: true })
  })

  it("marks duplicate semantic events ignored when applied as a batch", () => {
    const deduper = createSemanticEventDeduper()
    const first = {
      id: "evt-fire-1",
      rawText: "周仓从摸牌堆获得4张牌神吕蒙（您）从摸牌堆获得八封阵2杀10，火攻0，排",
      normalizedText: "周仓从摸牌堆获得4张牌神吕蒙（您）从摸牌堆获得八封阵2杀10火攻0排",
      normalizedRawText: "周仓从摸牌堆获得4张牌神吕蒙（您）从摸牌堆获得八封阵2杀10火攻0排",
      playerName: "周仓",
      canonicalPlayerKey: "周仓",
      action: "gainKnown",
      cardName: "火攻",
      cardNames: ["火攻"],
      confidence: 0.89,
      source: "ocr" as const,
      status: "pending" as const,
      quality: "strict" as const,
      autoAcceptable: true,
      cycleId: 1,
      fingerprint: "fire-1",
      createdAt: new Date().toISOString(),
      note: "公开日志显示从摸牌堆获得具名牌"
    }
    const second = {
      ...first,
      id: "evt-fire-2",
      rawText: "周仓从摸牌堆获得4张牌神吕蒙（您）从摸牌堆获得卦随2杀●10，火攻0，排",
      normalizedText: "周仓从摸牌堆获得4张牌神吕蒙（您）从摸牌堆获得卦随2杀●10火攻0排",
      normalizedRawText: "周仓从摸牌堆获得4张牌神吕蒙（您）从摸牌堆获得卦随2杀●10火攻0排",
      fingerprint: "fire-2"
    }

    const deduped = applySemanticEventDedupe([first, second], deduper)

    expect(deduped[0]).toMatchObject({ status: "pending", quality: "strict" })
    expect(deduped[0]?.duplicate).toBeUndefined()
    expect(deduped[1]).toMatchObject({ duplicate: true, status: "ignored", quality: "ignored", autoAcceptable: false })
    expect(deduped[1]?.note).toContain("语义重复")
  })
})
