import { describe, expect, it } from "vitest"

import { analyzeOcrAliasesForReport, demoDeckProfile, type SessionReport } from "../src"

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

describe("OCR alias evidence images", () => {
  it("carries source event evidence images into correction candidates", () => {
    const evidenceImage = {
      dataUrl: "data:image/webp;base64,abc",
      width: 120,
      height: 80,
      capturedAt: 2,
      kind: "logRoi" as const,
      mimeType: "image/webp"
    }
    const rawText = "鐣屵瓩鍧氾紙鎮級浣跨敤涓堝叓铏电煕"
    const report = createReport({
      userCorrections: [
        {
          id: "correction-1",
          sessionId: "session-test",
          eventId: "event-1",
          rawText,
          correctedCardName: "涓堝叓铔囩煕",
          reason: "wrongCard",
          createdAt: 1
        }
      ],
      parsedEvents: [
        {
          id: "event-1",
          rawText,
          normalizedText: rawText,
          normalizedRawText: rawText,
          playerName: "鐣屵瓩鍧氾紙鎮級",
          action: "use",
          confidence: 0.8,
          source: "ocr",
          status: "pending",
          quality: "unsupported",
          autoAcceptable: false,
          supportStatus: "unsupported",
          fingerprint: "event-1",
          createdAt: new Date(1).toISOString(),
          evidenceImage
        }
      ]
    })

    expect(analyzeOcrAliasesForReport(report, demoDeckProfile, [])[0]?.examples[0]?.evidenceImage).toEqual(evidenceImage)
  })
})
