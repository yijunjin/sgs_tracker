import { describe, expect, it } from "vitest"

import {
  analyzeOcrAliasesForReport,
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
          confidence: 0.98,
          sources: ["userCorrection"]
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
})
