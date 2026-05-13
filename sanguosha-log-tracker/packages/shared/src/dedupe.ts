import { normalizeText } from "./normalize"
import type { OcrLine } from "./types"

function fingerprintLine(line: OcrLine | string): string {
  const text = typeof line === "string" ? line : line.text
  return normalizeText(text)
}

export function createVisibleLogDeduper() {
  let previousFingerprints = new Set<string>()
  let hasSeenFirstBatch = false

  function getNewLines<T extends OcrLine | string>(lines: T[]): T[] {
    const currentFingerprints = lines.map(fingerprintLine)
    const newLines = hasSeenFirstBatch
      ? lines.filter((_, index) => !previousFingerprints.has(currentFingerprints[index] ?? ""))
      : [...lines]

    previousFingerprints = new Set(currentFingerprints)
    hasSeenFirstBatch = true
    return newLines
  }

  function reset(): void {
    previousFingerprints = new Set()
    hasSeenFirstBatch = false
  }

  return {
    getNewLines,
    reset,
    clear: reset
  }
}
