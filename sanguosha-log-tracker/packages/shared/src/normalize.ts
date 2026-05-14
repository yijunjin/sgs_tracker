import { KNOWN_CARD_NAMES, isKnownCardName } from "./cards"
import type { CardName, DeckProfile, OcrAliasEntry } from "./types"

export type NormalizeResult = {
  text: string
  appliedAliases: Array<{
    alias: string
    canonical: CardName
  }>
}

const textAliasMap = new Map<string, string>([
  ["无解可击", "无懈可击"],
  ["无懈可系击", "无懈可击"],
  ["无懈可系", "无懈可击"],
  ["过问拆桥", "过河拆桥"],
  ["过可拆桥", "过河拆桥"],
  ["过河拆挢", "过河拆桥"],
  ["顺于牵羊", "顺手牵羊"],
  ["顺手羊", "顺手牵羊"],
  ["寒水剑", "寒冰剑"],
  ["塞冰剑", "寒冰剑"],
  ["万箭齐友", "万箭齐发"],
  ["南蛮人侵", "南蛮入侵"],
  ["水淹七车", "水淹七军"]
])

const cardAliasMap = new Map<string, string>([["挑", "桃"]])

const suitAliasMap = new Map<string, string>([
  ["黑桃", "黑桃"],
  ["红桃", "红桃"],
  ["梅花", "梅花"],
  ["方片", "方片"],
  ["方块", "方片"]
])

function toHalfWidth(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, " ")
}

function createBuiltInAliasEntries(): OcrAliasEntry[] {
  const now = 0
  const entries = [...textAliasMap.entries(), ...cardAliasMap.entries()]
  return entries.map(([alias, canonical]) => ({
    id: `built-in-${alias}-${canonical}`,
    alias,
    canonical,
    source: "builtIn",
    confidence: 1,
    enabled: true,
    hitCount: 0,
    createdAt: now
  }))
}

export const builtInOcrAliases: OcrAliasEntry[] = createBuiltInAliasEntries()

let runtimeOcrAliases: OcrAliasEntry[] = []

export function setRuntimeOcrAliases(aliases: OcrAliasEntry[]): void {
  runtimeOcrAliases = aliases.filter((alias) => alias.source !== "builtIn")
}

export function loadOcrAliases(): OcrAliasEntry[] {
  const merged = new Map<string, OcrAliasEntry>()
  for (const alias of [...builtInOcrAliases, ...runtimeOcrAliases]) {
    merged.set(alias.id, alias)
  }
  return [...merged.values()]
}

function basicNormalizeText(input: string): string {
  return toHalfWidth(input)
    .replace(/[“”‘’"'`]/g, "")
    .replace(/[{}<>《》]/g, "")
    .replace(/[【\[]\s*/g, "【")
    .replace(/\s*[】\]]/g, "】")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/[|｜]/g, "")
    .replace(/[，,。.!！?？:：;；]/g, "")
    .replace(/\s+/g, "")
    .trim()
}

export function applyOcrAliases(text: string, aliases: OcrAliasEntry[] = loadOcrAliases()): NormalizeResult {
  let normalizedText = text
  const appliedAliases: NormalizeResult["appliedAliases"] = []
  const enabledAliases = aliases
    .filter((alias) => alias.enabled && alias.alias && alias.canonical)
    .sort((left, right) => right.alias.length - left.alias.length)

  for (const alias of enabledAliases) {
    if (!normalizedText.includes(alias.alias)) {
      continue
    }

    normalizedText = normalizedText.replaceAll(alias.alias, alias.canonical)
    appliedAliases.push({
      alias: alias.alias,
      canonical: alias.canonical
    })
  }

  return {
    text: normalizedText,
    appliedAliases
  }
}

export function normalizeTextWithAliases(input: string, aliases: OcrAliasEntry[] = loadOcrAliases()): NormalizeResult {
  return applyOcrAliases(basicNormalizeText(input), aliases)
}

export function normalizeText(input: string): string {
  return normalizeTextWithAliases(input).text
}

export function normalizeCardName(input: string): CardName | undefined {
  const normalized = normalizeText(input)
  if (isKnownCardName(normalized)) {
    return normalized
  }

  for (const [from, to] of cardAliasMap.entries()) {
    if (!normalized.includes(from)) {
      continue
    }

    const corrected = normalized.replaceAll(from, to)
    if (isKnownCardName(corrected)) {
      return corrected
    }

    const correctedMatch = [...KNOWN_CARD_NAMES]
      .sort((left, right) => right.length - left.length)
      .find((cardName) => corrected.includes(cardName))
    if (correctedMatch) {
      return correctedMatch
    }
  }

  for (const candidate of [...textAliasMap.values(), ...textAliasMap.keys()]) {
    if (normalized.includes(candidate)) {
      const corrected = textAliasMap.get(candidate) ?? candidate
      if (isKnownCardName(corrected)) {
        return corrected
      }
    }
  }

  return undefined
}

export function normalizeSuit(input: string | undefined): string | undefined {
  if (!input) {
    return undefined
  }

  return suitAliasMap.get(normalizeText(input))
}

export function findCardNameByLongestMatch(
  text: string,
  deckProfile: Pick<DeckProfile, "cards">
): CardName | undefined {
  const normalized = normalizeText(text)
  const cardNames = [...new Set(deckProfile.cards.map((card) => card.name))]
    .sort((left, right) => right.length - left.length)

  return cardNames.find((cardName) => normalized.includes(cardName))
}

export function findKnownCardNameByLongestMatch(text: string): CardName | undefined {
  const normalized = normalizeText(text)
  const directMatch = [...KNOWN_CARD_NAMES]
    .sort((left, right) => right.length - left.length)
    .find((cardName) => normalized.includes(cardName))

  if (directMatch) {
    return directMatch
  }

  for (const [from, to] of cardAliasMap.entries()) {
    if (!normalized.includes(from)) {
      continue
    }

    const corrected = normalized.replaceAll(from, to)
    const correctedMatch = [...KNOWN_CARD_NAMES]
      .sort((left, right) => right.length - left.length)
      .find((cardName) => corrected.includes(cardName))
    if (correctedMatch) {
      return correctedMatch
    }
  }

  return undefined
}
