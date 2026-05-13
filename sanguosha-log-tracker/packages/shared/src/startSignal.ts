import { normalizeText } from "./normalize"
import type { OcrLine } from "./types"

export type GameStartSignal = {
  id: string
  chooseLines: string[]
  chooseLineIndexes: number[]
  detectedAt: number
  confidence: number
}

const START_SIGNAL_HINTS = ["从摸牌堆获得", "第1轮", "剩余牌"] as const

function createSignalId(chooseLines: string[], chooseLineIndexes: number[]): string {
  const seed = `${chooseLines.join("|")}|${chooseLineIndexes.join(",")}`
  return `game-start-${normalizeText(seed).replace(/\s+/g, "")}`
}

export function createGameStartSignature(signal: Pick<GameStartSignal, "chooseLines">): string {
  return signal.chooseLines.map((line) => normalizeStartSignalText(line)).join("|")
}

export function normalizeStartSignalText(text: string): string {
  return normalizeText(text)
    .replaceAll("选挥了", "选择了")
    .replaceAll("选样了", "选择了")
    .replaceAll("选挥", "选择")
    .replaceAll("武符", "武将")
    .replaceAll("武蒋", "武将")
    .replaceAll("作为武持", "作为武将")
}

export function isChooseGeneralLine(text: string): boolean {
  const normalized = normalizeStartSignalText(text)
  return /选择了.+作为武将/u.test(normalized)
}

export function detectGameStartSignal(lines: OcrLine[], startSignalMinChooseLines = 1): GameStartSignal | undefined {
  const chooseLines: string[] = []
  const chooseLineIndexes: number[] = []
  const normalizedLines = lines.map((line) => normalizeStartSignalText(line.text))

  normalizedLines.forEach((line, index) => {
    if (isChooseGeneralLine(line)) {
      chooseLines.push(line)
      chooseLineIndexes.push(index)
    }
  })

  if (chooseLines.length < startSignalMinChooseLines) {
    return undefined
  }

  const hintsMatched = START_SIGNAL_HINTS.reduce(
    (count, hint) => count + normalizedLines.filter((line) => line.includes(hint)).length,
    0
  )
  const confidence = Math.min(1, 0.6 + chooseLines.length * 0.15 + hintsMatched * 0.08)

  return {
    id: createSignalId(chooseLines, chooseLineIndexes),
    chooseLines,
    chooseLineIndexes,
    detectedAt: Date.now(),
    confidence
  }
}