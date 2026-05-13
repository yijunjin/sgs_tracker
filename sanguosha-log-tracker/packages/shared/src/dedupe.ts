import { normalizeText } from "./normalize"
import type { OcrLine } from "./types"

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
