import { KNOWN_CARD_NAMES, isKnownCardName } from "./cards"
import { normalizeText } from "./normalize"
import type {
  AliasCandidateKind,
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
const SEGMENTABLE_CARD_NAMES = [...KNOWN_CARD_NAMES].sort((left, right) => right.length - left.length)
const DIRTY_TEXT_MARKERS = [
  ...ACTION_TERMS,
  ...STOP_WORDS,
  "武将",
  "技能",
  "玩家",
  "房间",
  "界限",
  "系统",
  "英魂",
  "奔雷",
  "流马",
  "木牛"
]

function isDirtyAliasText(alias: string, canonical: string): boolean {
  const normalizedAlias = normalizeText(alias)
  if (!normalizedAlias || normalizedAlias.length > 6) {
    return true
  }
  if (/[^\u4e00-\u9fa5]/u.test(normalizedAlias)) {
    return true
  }
  if (DIRTY_TEXT_MARKERS.some((marker) => normalizedAlias.includes(marker))) {
    return true
  }

  const similarityScore = similarity(normalizedAlias, canonical)
  return Math.abs(normalizedAlias.length - canonical.length) >= 2 && similarityScore < 0.45
}

export function classifyAliasCandidate(alias: string, canonical: string): {
  kind: AliasCandidateKind
  canAcceptAsAlias: boolean
  note?: string
} {
  const normalizedAlias = normalizeText(alias)
  const normalizedCanonical = normalizeText(canonical)

  if (!normalizedAlias || !normalizedCanonical) {
    return {
      kind: "dirty-text",
      canAcceptAsAlias: false,
      note: "候选文本为空或无法归一化，不建议加入别名字典"
    }
  }

  if (normalizedCanonical.endsWith(normalizedAlias) && normalizedAlias.length < normalizedCanonical.length) {
    return {
      kind: "truncated-suffix",
      canAcceptAsAlias: false,
      note: "疑似牌名前缀被截断，不建议加入别名字典"
    }
  }

  if (normalizedCanonical.startsWith(normalizedAlias) && normalizedAlias.length < normalizedCanonical.length) {
    return {
      kind: "truncated-prefix",
      canAcceptAsAlias: false,
      note: "疑似牌名后缀被截断，不建议加入别名字典"
    }
  }

  if (isDirtyAliasText(normalizedAlias, normalizedCanonical)) {
    return {
      kind: "dirty-text",
      canAcceptAsAlias: false,
      note: "疑似包含玩家名、技能名或动作脏文本，不建议加入别名字典"
    }
  }

  const similarityScore = similarity(normalizedAlias, normalizedCanonical)
  if (Math.abs(normalizedAlias.length - normalizedCanonical.length) <= 1 && similarityScore >= 0.6) {
    return {
      kind: "ocr-alias",
      canAcceptAsAlias: true
    }
  }

  return {
    kind: "dirty-text",
    canAcceptAsAlias: false,
    note: "候选文本噪声较大，建议人工复核后决定是否保留"
  }
}

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

type CardTermSegment = {
  text: string
  exactCard: boolean
}

function compareSegmentations(left: CardTermSegment[], right: CardTermSegment[]): number {
  const leftKnownCoverage = left.filter((segment) => segment.exactCard).reduce((sum, segment) => sum + segment.text.length, 0)
  const rightKnownCoverage = right.filter((segment) => segment.exactCard).reduce((sum, segment) => sum + segment.text.length, 0)

  if (leftKnownCoverage !== rightKnownCoverage) {
    return rightKnownCoverage - leftKnownCoverage
  }

  const leftUnknownCount = left.filter((segment) => !segment.exactCard).length
  const rightUnknownCount = right.filter((segment) => !segment.exactCard).length
  if (leftUnknownCount !== rightUnknownCount) {
    return leftUnknownCount - rightUnknownCount
  }

  return right.length - left.length
}

function splitConcatenatedCardTerm(term: string): string[] {
  const normalized = normalizeText(term)
  if (!normalized || isKnownCardName(normalized)) {
    return [normalized]
  }

  const segmentations: CardTermSegment[][] = []

  function search(index: number, segments: CardTermSegment[], usedUnknownChunk: boolean): void {
    if (index >= normalized.length) {
      if (segments.length >= 2 && segments.some((segment) => segment.exactCard)) {
        segmentations.push([...segments])
      }
      return
    }

    for (const cardName of SEGMENTABLE_CARD_NAMES) {
      if (!normalized.startsWith(cardName, index)) {
        continue
      }

      segments.push({ text: cardName, exactCard: true })
      search(index + cardName.length, segments, usedUnknownChunk)
      segments.pop()
    }

    if (usedUnknownChunk) {
      return
    }

    for (let end = index + 2; end <= normalized.length; end += 1) {
      const chunk = normalized.slice(index, end)
      if (isKnownCardName(chunk)) {
        continue
      }

      segments.push({ text: chunk, exactCard: false })
      search(end, segments, true)
      segments.pop()
    }
  }

  search(0, [], false)

  if (segmentations.length === 0) {
    return [normalized]
  }

  segmentations.sort(compareSegmentations)
  return segmentations[0]!.map((segment) => segment.text)
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
    const extractedTerms = splitConcatenatedCardTerm(match[0])

    for (const term of extractedTerms) {
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

function classifyCandidateForSource(
  alias: string,
  canonical: CardName,
  source: OcrAliasCandidate["sources"][number]
): {
  kind: AliasCandidateKind
  canAcceptAsAlias: boolean
  note?: string
} {
  const base = classifyAliasCandidate(alias, canonical)
  if (source === "userCorrection" && base.kind !== "truncated-prefix" && base.kind !== "truncated-suffix" && base.kind !== "dirty-text") {
    return {
      kind: "user-correction",
      canAcceptAsAlias: true
    }
  }

  return base
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
  evidenceImage?: ParsedLogEvent["evidenceImage"]
  lineBox?: unknown
}): OcrAliasCandidate {
  const now = Date.now()
  const classification = classifyCandidateForSource(args.alias, args.canonical, args.source)
  return {
    id: `alias-candidate-${args.alias}-${args.canonical}`,
    alias: args.alias,
    suggestedCanonical: args.canonical,
    kind: classification.kind,
    canAcceptAsAlias: classification.canAcceptAsAlias,
    confidence: args.confidence,
    count: 1,
    sources: [args.source],
    sessionIds: [args.sessionId],
    examples: [
      {
        sessionId: args.sessionId,
        rawText: args.rawText,
        normalizedText: args.normalizedText,
        eventId: args.eventId,
        evidenceImage: args.evidenceImage,
        lineBox: args.lineBox
      }
    ],
    status: "pending",
    createdAt: now,
    note: classification.note
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
  existing.sessionIds = [...new Set([...existing.sessionIds, ...candidate.sessionIds])]
  existing.examples = [...existing.examples, ...candidate.examples].slice(0, 5)
  if (!existing.canAcceptAsAlias || !candidate.canAcceptAsAlias) {
    existing.canAcceptAsAlias = false
  }
  if (existing.kind === "ocr-alias" && candidate.kind === "user-correction") {
    existing.kind = candidate.kind
    existing.note = candidate.note
  }
  if (existing.kind === "ocr-alias" && (candidate.kind === "truncated-prefix" || candidate.kind === "truncated-suffix" || candidate.kind === "dirty-text")) {
    existing.kind = candidate.kind
    existing.note = candidate.note
  }
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

  const sourceEvent = report.parsedEvents.find((event) => event.id === correction.eventId)
  const lineBox = report.mergedLines.find((line) => normalizeText(line.text) === normalizeText(correction.rawText))?.box

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
        eventId: correction.eventId,
        evidenceImage: sourceEvent?.evidenceImage,
        lineBox
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
  const mergedLineBoxByText = new Map(report.mergedLines.map((line) => [normalizeText(line.text), line.box]))

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
          eventId: event.id,
          evidenceImage: event.evidenceImage,
          lineBox: mergedLineBoxByText.get(normalizeText(event.rawText))
        })
      )
    }
  }

  return [...candidates.values()].sort((left, right) => right.confidence - left.confidence || right.count - left.count)
}
