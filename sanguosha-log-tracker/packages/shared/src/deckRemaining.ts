export const defaultDeckCountCropRect = {
  x: 1420,
  y: 150,
  width: 154,
  height: 60
}

export type DeckRemainingSamplerState = {
  lastRawValue?: number | undefined
  lastStableValue?: number | undefined
  sameValueHits: number
  lastUpdatedAt?: number | undefined
}

export function createDeckRemainingSamplerState(): DeckRemainingSamplerState {
  return {
    sameValueHits: 0
  }
}

function normalizeDeckRemainingText(text: string): string {
  return text
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/\s+/g, "")
}

export function parseDeckRemainingFromText(text: string, deckTotal: number): number | undefined {
  const normalized = normalizeDeckRemainingText(text)
  const preferred =
    normalized.match(/剩余牌[:：]?(\d{1,2})/u) ??
    normalized.match(/剩余[:：]?(\d{1,2})/u) ??
    normalized.match(/余牌[:：]?(\d{1,2})/u)
  const digitOnly = normalized.match(/^\d{1,2}$/u)
  const valueText = preferred?.[1] ?? digitOnly?.[0]

  if (!valueText) {
    return undefined
  }

  const value = Number(valueText)
  if (!Number.isInteger(value) || value < 0 || value > deckTotal) {
    return undefined
  }

  return value
}

export function updateDeckRemainingSample(
  state: DeckRemainingSamplerState,
  rawRemaining: number | undefined,
  deckTotal: number
): { stableRemaining?: number | undefined; changed: boolean } {
  if (rawRemaining === undefined || rawRemaining < 0 || rawRemaining > deckTotal) {
    return {
      stableRemaining: state.lastStableValue,
      changed: false
    }
  }

  const sameValueHits = state.lastRawValue === rawRemaining ? state.sameValueHits + 1 : 1
  const previousStable = state.lastStableValue
  state.lastRawValue = rawRemaining
  state.sameValueHits = sameValueHits
  state.lastUpdatedAt = Date.now()

  if (sameValueHits >= 2) {
    state.lastStableValue = rawRemaining
  }

  return {
    stableRemaining: state.lastStableValue,
    changed: previousStable !== state.lastStableValue
  }
}
