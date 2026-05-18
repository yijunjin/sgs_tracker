import { describe, expect, it } from "vitest"

import {
  analyzeOcrAliasesForReport,
  classifyAliasCandidate,
  demoDeckProfile,
  extractAliasTermsFromRawText,
  similarity,
  type SessionReport
} from "../src"

function createReport(partial: Partial<SessionReport>): SessionReport {
  return {
    sessionId: "session-test",
    deckProfileId: demoDeckProfile.id,
    startedAt: 1,
    ocrEngine: "manual",
    rawOcrLines: [],
    mergedLines: [],
    parsedEvents: [],
    acceptedEvents: [],
    ignoredEvents: [],
    ambiguousEvents: [],
    unsupportedEvents: [],
    userCorrections: [],
    summary: {
      rawLineCount: 0,
      mergedLineCount: 0,
      parsedEventCount: 0,
      acceptedCount: 0,
      ignoredCount: 0,
      ambiguousCount: 0,
      unsupportedCount: 0,
      correctionCount: 0
    },
    ...partial
  }
}

describe("OCR alias mining", () => {
  it("classifies truncated suffix candidates as non-alias", () => {
    expect(classifyAliasCandidate("园结义", "桃园结义")).toMatchObject({
      kind: "truncated-suffix",
      canAcceptAsAlias: false
    })

    expect(classifyAliasCandidate("河拆桥", "过河拆桥")).toMatchObject({
      kind: "truncated-suffix",
      canAcceptAsAlias: false
    })
  })

  it("classifies close OCR mistakes as alias candidates", () => {
    expect(classifyAliasCandidate("无解可击", "无懈可击")).toMatchObject({
      kind: "ocr-alias",
      canAcceptAsAlias: true
    })

    expect(classifyAliasCandidate("丈八虵矛", "丈八蛇矛")).toMatchObject({
      kind: "ocr-alias",
      canAcceptAsAlias: true
    })
  })

  it("mines a high confidence candidate from user card correction", () => {
    const report = createReport({
      userCorrections: [
        {
          id: "correction-1",
          sessionId: "session-test",
          eventId: "event-1",
          rawText: "界孙坚（您）使用丈八虵矛",
          correctedCardName: "丈八蛇矛",
          reason: "wrongCard",
          createdAt: 1
        }
      ]
    })

    expect(analyzeOcrAliasesForReport(report, demoDeckProfile, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "丈八虵矛",
          suggestedCanonical: "丈八蛇矛",
          kind: "user-correction",
          canAcceptAsAlias: true,
          confidence: 0.98,
          sources: ["userCorrection"],
          sessionIds: ["session-test"]
        })
      ])
    )
  })

  it("does not fuzzy match single-character basic cards", () => {
    expect(similarity("桃", "桃")).toBe(1)
    expect(similarity("挑", "桃")).toBe(0)
  })

  it("does not emit terms that already exist as aliases", () => {
    expect(
      extractAliasTermsFromRawText("界孙坚（您）使用丈八虵矛", [
        {
          id: "alias-1",
          alias: "丈八虵矛",
          canonical: "丈八蛇矛",
          source: "manual",
          confidence: 1,
          enabled: true,
          hitCount: 0,
          createdAt: 1
        }
      ])
    ).not.toContain("丈八虵矛")
  })

  it("splits concatenated card text and drops exact card names", () => {
    expect(extractAliasTermsFromRawText("无懈可击酒3")).toEqual([])
    expect(extractAliasTermsFromRawText("无懈可及酒3")).toEqual(["无懈可及"])
  })

  it("marks truncated candidates as completion-only instead of alias", () => {
    const report = createReport({
      parsedEvents: [
        {
          id: "event-1",
          rawText: "黄月英对周泰（您）使用园结义",
          normalizedText: "黄月英对周泰（您）使用园结义",
          normalizedRawText: "黄月英对周泰（您）使用园结义",
          playerName: "黄月英",
          targetName: "周泰（您）",
          action: "unknown",
          confidence: 0.92,
          source: "ocr",
          status: "pending",
          quality: "ambiguous",
          autoAcceptable: false,
          fingerprint: "黄月英对周泰（您）使用园结义",
          createdAt: new Date(1).toISOString(),
          note: "疑似牌名截断补全"
        }
      ]
    })

    expect(analyzeOcrAliasesForReport(report, demoDeckProfile, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "园结义",
          suggestedCanonical: "桃园结义",
          kind: "truncated-suffix",
          canAcceptAsAlias: false,
          note: "疑似牌名前缀被截断，不建议加入别名字典"
        })
      ])
    )
  })

  it("does not mine a merged multi-card OCR line as one dirty alias", () => {
    const report = createReport({
      parsedEvents: [
        {
          id: "event-1",
          rawText: "无懈可击酒3",
          normalizedText: "无懈可击酒3",
          normalizedRawText: "无懈可击酒3",
          action: "unknown",
          confidence: 0.8,
          source: "ocr",
          status: "pending",
          quality: "ambiguous",
          autoAcceptable: false,
          fingerprint: "无懈可击酒3",
          createdAt: new Date(1).toISOString(),
          note: "疑似连续两张牌"
        }
      ]
    })

    expect(analyzeOcrAliasesForReport(report, demoDeckProfile, [])).toEqual([])
  })
})
