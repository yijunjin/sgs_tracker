import { KNOWN_CARD_NAMES, isKnownCardName } from "./cards"
import type { CardName, DeckProfile } from "./types"

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

export function normalizeText(input: string): string {
  const compact = toHalfWidth(input)
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

  let normalized = compact
  for (const [from, to] of textAliasMap.entries()) {
    normalized = normalized.replaceAll(from, to)
  }

  return normalized
}

export function normalizeCardName(input: string): CardName | undefined {
  const normalized = normalizeText(input)
  if (isKnownCardName(normalized)) {
    return normalized
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
  return [...KNOWN_CARD_NAMES]
    .sort((left, right) => right.length - left.length)
    .find((cardName) => normalized.includes(cardName))
}
