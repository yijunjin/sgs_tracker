import { KNOWN_CARD_NAMES } from "./cards"
import { normalizeText } from "./normalize"

const PLAYER_POLLUTION_WORDS = ["流马", "木牛流马", "英魂", "奔雷", "牌堆", "获得", "使用", "打出", "装备", "判定"]
const PLAYER_ACTION_WORDS = ["获得", "使用", "打出", "装备", "判定", "弃置"]

function normalizePlayerLabel(playerName?: string): string {
  if (!playerName) {
    return ""
  }

  return normalizeText(playerName)
    .replace(/\(/gu, "（")
    .replace(/\)/gu, "）")
    .replace(/\s+/gu, "")
    .replace(/[·•,，。.!?？:：;；"“”'‘’`~_—\-\\/|]/gu, "")
}

function stripSelfMarker(playerName: string): string {
  return playerName.replace(/（您）/gu, "").replace(/您/gu, "")
}

function countContainedKeywords(text: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0)
}

function countContainedCardNames(text: string): number {
  const matchedNames = [...KNOWN_CARD_NAMES]
    .sort((left, right) => right.length - left.length)
    .filter((cardName) => text.includes(cardName))

  return matchedNames.filter(
    (cardName, index) => !matchedNames.slice(0, index).some((longerCardName) => longerCardName.includes(cardName))
  ).length
}

export function isSuspiciousPlayerName(playerName?: string): boolean {
  const normalized = normalizePlayerLabel(playerName)
  if (!normalized) {
    return true
  }

  const hasSelfMarker = normalized.includes("您")
  const stripped = stripSelfMarker(normalized)
  if (!stripped) {
    return true
  }

  const pollutionWordCount = countContainedKeywords(normalized, PLAYER_POLLUTION_WORDS)
  const actionWordCount = countContainedKeywords(normalized, PLAYER_ACTION_WORDS)
  const cardNameCount = countContainedCardNames(normalized)
  const looksLikeNormalSelfName = hasSelfMarker && stripped.length <= 6 && pollutionWordCount === 0 && actionWordCount <= 1 && cardNameCount <= 1

  if (looksLikeNormalSelfName) {
    return false
  }

  return stripped.length > 12 || pollutionWordCount > 0 || cardNameCount > 1 || actionWordCount > 1
}

export function canonicalPlayerKey(playerName?: string): string | undefined {
  const normalized = normalizePlayerLabel(playerName)
  if (!normalized) {
    return undefined
  }

  if (normalized.includes("您")) {
    return "__self__"
  }

  if (isSuspiciousPlayerName(normalized)) {
    return undefined
  }

  const stripped = stripSelfMarker(normalized)
  return stripped || undefined
}

export function canonicalTargetKey(targetName?: string): string | undefined {
  return canonicalPlayerKey(targetName)
}
