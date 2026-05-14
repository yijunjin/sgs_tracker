import { normalizeText } from "./normalize"
import { canonicalPlayerKey, canonicalTargetKey } from "./player"
import type { OcrLine, ParsedLogEvent } from "./types"

function fingerprintLine(line: OcrLine | string): string {
  const text = typeof line === "string" ? line : line.text
  return normalizeText(text).replace(/\s+/g, "")
}

export function createVisibleLogDeduper() {
  let previousCounts = new Map<string, number>()
  let lastStats = {
    currentLineCount: 0,
    newLineCount: 0,
    duplicateSkippedCount: 0
  }

  function toCountMap(fingerprints: string[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const fingerprint of fingerprints) {
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1)
    }
    return counts
  }

  function getNewLines<T extends OcrLine | string>(lines: T[]): T[] {
    const currentFingerprints = lines.map(fingerprintLine)
    const currentCounts = toCountMap(currentFingerprints)
    const remainingNewCounts = new Map<string, number>()

    for (const [fingerprint, currentCount] of currentCounts.entries()) {
      const previousCount = previousCounts.get(fingerprint) ?? 0
      const newCount = Math.max(0, currentCount - previousCount)
      if (newCount > 0) {
        remainingNewCounts.set(fingerprint, newCount)
      }
    }

    const newLines: T[] = []
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]
      const fingerprint = currentFingerprints[index] ?? ""
      const remaining = remainingNewCounts.get(fingerprint) ?? 0
      if (line && remaining > 0) {
        newLines.unshift(line)
        remainingNewCounts.set(fingerprint, remaining - 1)
      }
    }

    previousCounts = currentCounts
    lastStats = {
      currentLineCount: lines.length,
      newLineCount: newLines.length,
      duplicateSkippedCount: Math.max(0, lines.length - newLines.length)
    }
    return newLines
  }

  function reset(): void {
    previousCounts = new Map()
    lastStats = {
      currentLineCount: 0,
      newLineCount: 0,
      duplicateSkippedCount: 0
    }
  }

  return {
    getNewLines,
    getLastStats: () => ({ ...lastStats }),
    reset,
    clear: reset
  }
}

function normalizeSemanticCardList(event: ParsedLogEvent): string | undefined {
  const cardNames = event.cardNames?.length ? event.cardNames : event.cardName ? [event.cardName] : []
  if (cardNames.length === 0) {
    return undefined
  }

  return cardNames.join(",")
}

export function createSemanticEventKey(event: ParsedLogEvent): string | undefined {
  if (event.action === "ignore" || event.action === "unknown") {
    return undefined
  }

  const cycleId = event.cycleId ?? 0
  const playerKey = event.canonicalPlayerKey ?? canonicalPlayerKey(event.playerName) ?? "-"
  const targetKey = event.canonicalTargetKey ?? canonicalTargetKey(event.targetName) ?? "-"
  const cardKey = event.action === "gainKnown" ? normalizeSemanticCardList(event) : event.cardName

  if (!cardKey && event.action !== "convert") {
    return undefined
  }

  return [cycleId, playerKey, targetKey, event.action, cardKey ?? "-"].join("|")
}

export type SemanticEventDeduper = {
  markAndCheck(event: ParsedLogEvent): {
    duplicate: boolean
    reason?: string
  }
  clear(): void
  prime(events: ParsedLogEvent[]): void
}

export function applySemanticEventDedupe(
  events: ParsedLogEvent[],
  semanticDeduper?: SemanticEventDeduper
): ParsedLogEvent[] {
  if (!semanticDeduper) {
    return events
  }

  return events.map((event) => {
    if (event.action === "ignore" || event.action === "unknown" || event.supportStatus === "unsupported") {
      return event
    }

    const dedupeResult = semanticDeduper.markAndCheck(event)
    if (!dedupeResult.duplicate) {
      return event
    }

    return {
      ...event,
      duplicate: true,
      status: "ignored",
      quality: "ignored",
      autoAcceptable: false,
      note: event.note ? `${event.note}；语义重复，已跳过` : dedupeResult.reason ?? "语义重复，已跳过"
    } satisfies ParsedLogEvent
  })
}

export function createSemanticEventDeduper(): SemanticEventDeduper {
  let currentBatchKeys = new Set<string>()
  let visibleWindowKeys = new Set<string>()

  function markAndCheck(event: ParsedLogEvent): { duplicate: boolean; reason?: string } {
    const semanticKey = createSemanticEventKey(event)
    if (!semanticKey) {
      return { duplicate: false }
    }

    if (currentBatchKeys.has(semanticKey)) {
      return { duplicate: true, reason: "同一 OCR 批次语义重复" }
    }

    currentBatchKeys.add(semanticKey)
    if (visibleWindowKeys.has(semanticKey)) {
      return { duplicate: true, reason: "当前可见日志窗口语义重复" }
    }

    return { duplicate: false }
  }

  function clear(): void {
    currentBatchKeys = new Set()
    visibleWindowKeys = new Set()
  }

  function prime(events: ParsedLogEvent[]): void {
    visibleWindowKeys = new Set(
      events
        .map((event) => createSemanticEventKey(event))
        .filter((semanticKey): semanticKey is string => Boolean(semanticKey))
    )
    currentBatchKeys = new Set()
  }

  return {
    markAndCheck,
    clear,
    prime
  }
}
