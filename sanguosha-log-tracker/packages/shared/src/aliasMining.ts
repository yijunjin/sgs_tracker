import { isKnownCardName } from "./cards"
import { normalizeText } from "./normalize"
import type {
  CardName,
  DeckProfile,
  OcrAliasCandidate,
  OcrAliasEntry,
  ParsedLogEvent,
  SessionReport,
  UserCorrectionRecord
} from "./types"

const ACTION_TERMS = ["使用", "打出", "弃置", "装备", "获得", "判定结果是", "从摸牌堆", "对", "让"]
const STOP_WORDS = [
  "选择了",
  "作为武将",
  "摸牌堆",
  "获得",
  "张牌",
  "发动",
  "体力",
  "回复",
  "受到",
  "伤害",
  "判定",
  "生效",
  "系统",
  "本房间"
]
const SUITS_AND_RANKS = /(?:黑桃|红桃|梅花|方片|方块|[A2-9JQK]|10|\d+)/gu
const CHINESE_TERM_PATTERN = /[\u4e00-\u9fa5]{2,6}/gu

export function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1
  const cols = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0))

  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0]![col] = col
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost
      )
    }
  }

  return matrix[rows - 1]![cols - 1]!
}

export function similarity(alias: string, cardName: CardName): number {
  if (cardName.length <= 1) {
    return alias === cardName ? 1 : 0
  }

  const distance = levenshteinDistance(alias, cardName)
  return 1 - distance / Math.max(alias.length, cardName.length)
}

function stripLikelyPlayerPrefix(text: string): string {
  const normalized = normalizeText(text)
  const actionIndexes = ACTION_TERMS
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
  if (actionIndexes.length === 0) {
    return normalized
  }

  return normalized.slice(Math.min(...actionIndexes))
}

export function extractAliasTermsFromRawText(
  rawText: string,
  aliases: OcrAliasEntry[] = []
): string[] {
  const existingAliases = new Set(aliases.map((alias) => normalizeText(alias.alias)))
  let text = stripLikelyPlayerPrefix(rawText)

  for (const term of ACTION_TERMS) {
    text = text.replaceAll(term, " ")
  }
  text = text.replace(SUITS_AND_RANKS, " ")
  for (const word of STOP_WORDS) {
    text = text.replaceAll(word, " ")
  }

  const terms = new Set<string>()
  for (const match of text.matchAll(CHINESE_TERM_PATTERN)) {
    const term = match[0]
    if (term.length < 2 || term.length > 6) {
      continue
    }
    if (STOP_WORDS.some((word) => term.includes(word)) || ACTION_TERMS.some((word) => term.includes(word))) {
      continue
    }
    if (existingAliases.has(term) || isKnownCardName(term)) {
      continue
    }
    terms.add(term)
  }

  return [...terms]
}

function matchBestCard(alias: string, cardNames: CardName[]): { cardName: CardName; score: number; ambiguous: boolean } | undefined {
  const ranked = cardNames
    .map((cardName) => ({ cardName, score: similarity(alias, cardName) }))
    .filter(({ cardName, score }) => {
      if (cardName.length <= 1) {
        return score === 1
      }
      return score >= (cardName.length === 2 ? 0.85 : 0.72)
    })
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  if (!best) {
    return undefined
  }

  const second = ranked[1]
  return {
    cardName: best.cardName,
    score: best.score,
    ambiguous: Boolean(second && best.score - second.score < 0.08)
  }
}

function createCandidate(args: {
  sessionId: string
  alias: string
  canonical: CardName
  confidence: number
  source: OcrAliasCandidate["sources"][number]
  rawText: string
  normalizedText?: string
  eventId?: string
}): OcrAliasCandidate {
  const now = Date.now()
  return {
    id: `alias-candidate-${args.alias}-${args.canonical}`,
    alias: args.alias,
    suggestedCanonical: args.canonical,
    confidence: args.confidence,
    count: 1,
    sources: [args.source],
    examples: [
      {
        sessionId: args.sessionId,
        rawText: args.rawText,
        normalizedText: args.normalizedText,
        eventId: args.eventId
      }
    ],
    status: "pending",
    createdAt: now
  }
}

function pushCandidate(
  candidates: Map<string, OcrAliasCandidate>,
  candidate: OcrAliasCandidate
): void {
  const key = `${candidate.alias}|${candidate.suggestedCanonical}`
  const existing = candidates.get(key)
  if (!existing) {
    candidates.set(key, candidate)
    return
  }

  existing.count += candidate.count
  existing.confidence = Math.max(existing.confidence, candidate.confidence)
  existing.sources = [...new Set([...existing.sources, ...candidate.sources])]
  existing.examples = [...existing.examples, ...candidate.examples].slice(0, 5)
  existing.updatedAt = Date.now()
}

function analyzeCorrection(
  report: SessionReport,
  correction: UserCorrectionRecord,
  aliases: OcrAliasEntry[],
  candidates: Map<string, OcrAliasCandidate>
): void {
  if (!correction.correctedCardName) {
    return
  }

  for (const alias of extractAliasTermsFromRawText(correction.rawText, aliases)) {
    if (alias === correction.correctedCardName) {
      continue
    }
    pushCandidate(
      candidates,
      createCandidate({
        sessionId: report.sessionId,
        alias,
        canonical: correction.correctedCardName,
        confidence: 0.98,
        source: "userCorrection",
        rawText: correction.rawText,
        eventId: correction.eventId
      })
    )
  }
}

function eventSource(event: ParsedLogEvent): OcrAliasCandidate["sources"][number] | undefined {
  if (event.note?.includes("超过牌库总数")) {
    return "overLimitEvent"
  }
  if (event.quality === "unsupported") {
    return "unknownEvent"
  }
  if (event.quality === "ambiguous") {
    return "ambiguousEvent"
  }
  if (event.action === "unknown") {
    return "unknownEvent"
  }
  return undefined
}

export function analyzeOcrAliasesForReport(
  report: SessionReport,
  deckProfile: DeckProfile,
  aliases: OcrAliasEntry[]
): OcrAliasCandidate[] {
  const candidates = new Map<string, OcrAliasCandidate>()
  const cardNames = [...new Set(deckProfile.cards.map((card) => card.name))]

  for (const correction of report.userCorrections) {
    analyzeCorrection(report, correction, aliases, candidates)
  }

  for (const event of report.parsedEvents) {
    const source = eventSource(event)
    if (!source) {
      continue
    }

    for (const alias of extractAliasTermsFromRawText(event.rawText, aliases)) {
      const match = matchBestCard(alias, cardNames)
      if (!match) {
        continue
      }

      pushCandidate(
        candidates,
        createCandidate({
          sessionId: report.sessionId,
          alias,
          canonical: match.cardName,
          confidence: Math.max(0.1, match.ambiguous ? match.score - 0.18 : match.score),
          source: match.ambiguous ? "fuzzyMatch" : source,
          rawText: event.rawText,
          normalizedText: event.normalizedText,
          eventId: event.id
        })
      )
    }
  }

  return [...candidates.values()].sort((left, right) => right.confidence - left.confidence || right.count - left.count)
}
