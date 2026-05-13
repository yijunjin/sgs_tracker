import { defaultDeckProfile, isCardInDeck, isKnownCardName } from "./cards"
import { findCardNameByLongestMatch, findKnownCardNameByLongestMatch, normalizeCardName, normalizeSuit, normalizeText } from "./normalize"
import type { DeckProfile, OcrLine, ParsedLogEvent } from "./types"

const BRACKETED_CARD_PATTERN =
  /^(?<player>.+?)(?<verb>使用了|使用|打出了|打出|弃置了|弃置|装备了|装备|判定牌为)【(?<content>.+?)】$/u
const CONVERT_PATTERN = /^(?<player>.+?)将【(?<from>.+?)】当【(?<to>.+?)】使用$/u
const TARGET_USE_PATTERN = /^(?<player>.+?)对(?<target>.+?)使用(?<content>.+)$/u
const DIRECT_ACTION_PATTERN = /^(?<player>.+?)(?<verb>使用|打出|弃置|装备)(?<content>.+)$/u
const JUDGE_RESULT_PATTERN = /^(?<player>.+?)的(?<judgeName>.+?)判定结果是(?<content>.+)$/u
const SUIT_RANK_CARD_PATTERN = /^(?<suit>黑桃|红桃|梅花|方片|方块)?(?<rank>A|10|[2-9JQK])?\s*(?<card>.+)$/u
const SUIT_ONLY_PATTERN = /(黑桃|红桃|梅花|方片|方块)(A|10|[2-9JQK])?$/u

const IGNORE_PATTERNS = [
  "观看牌堆顶",
  "牌堆顶",
  "置于牌堆顶",
  "从摸牌堆获得",
  "获得1张牌",
  "获得2张牌",
  "获得3张牌",
  "摸牌",
  "发动集智",
  "发动空城",
  "发动技能",
  "乐不思蜀生效",
  "兵粮寸断生效",
  "系统",
  "本房间",
  "开放聊天",
  "使用道具"
]

function createEventId(seed: string, index: number): string {
  const suffix = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
  return `evt-${seed.slice(0, 12)}-${suffix}`
}

function createBaseEvent(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number
): Pick<
  ParsedLogEvent,
  "id" | "rawText" | "normalizedText" | "normalizedRawText" | "confidence" | "source" | "fingerprint" | "createdAt"
> {
  const normalizedText = normalizeText(rawText)
  const fingerprint = normalizedText.replace(/\s+/g, "")
  return {
    id: createEventId(fingerprint, index),
    rawText,
    normalizedText,
    normalizedRawText: normalizedText,
    confidence,
    source,
    fingerprint,
    createdAt: new Date().toISOString()
  }
}

function actionFromVerb(verb: string): ParsedLogEvent["action"] {
  if (verb.startsWith("使用")) {
    return "use"
  }
  if (verb.startsWith("打出")) {
    return "play"
  }
  if (verb.startsWith("弃置")) {
    return "discard"
  }
  if (verb.startsWith("装备")) {
    return "equip"
  }
  if (verb === "判定牌为") {
    return "judge"
  }

  return "unknown"
}

function applyDeckSupport(
  event: ParsedLogEvent,
  deckProfile: DeckProfile
): ParsedLogEvent {
  if (!event.cardName) {
    return event
  }

  if (isCardInDeck(deckProfile, event.cardName)) {
    return {
      ...event,
      supportStatus: "supported"
    }
  }

  return {
    ...event,
    supportStatus: "unsupported",
    note: event.note
      ? `${event.note}；当前牌库不包含此牌`
      : "当前牌库不包含此牌"
  }
}

function resolveCardDetail(
  content: string,
  deckProfile: DeckProfile
): {
  cardName?: ParsedLogEvent["cardName"] | undefined
  suit?: string | undefined
  rank?: string | undefined
  note?: string | undefined
} {
  const normalizedContent = normalizeText(content)
  const suitRankMatch = normalizedContent.match(SUIT_RANK_CARD_PATTERN)
  const suit = normalizeSuit(suitRankMatch?.groups?.suit)
  const rank = suitRankMatch?.groups?.rank
  const cardLabel = suitRankMatch?.groups?.card ?? normalizedContent
  const knownCardName = findKnownCardNameByLongestMatch(cardLabel) ?? normalizeCardName(cardLabel)
  const deckCardName = findCardNameByLongestMatch(cardLabel, deckProfile)
  const cardName = knownCardName ?? deckCardName

  return {
    cardName,
    suit,
    rank,
    note: cardName ? undefined : `未识别牌名：${normalizedContent}`
  }
}

function shouldIgnore(normalizedText: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => normalizedText.includes(pattern))
}

function parseIgnoredLine(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number
): ParsedLogEvent {
  return {
    ...createBaseEvent(rawText, confidence, source, index),
    action: "ignore",
    confidence,
    source,
    status: "ignored",
    note: "不代表公开牌出现，已忽略。"
  }
}

function parseSingleLine(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number,
  deckProfile: DeckProfile
): ParsedLogEvent | undefined {
  const normalizedText = normalizeText(rawText)
  if (!normalizedText) {
    return undefined
  }

  if (shouldIgnore(normalizedText)) {
    return parseIgnoredLine(rawText, confidence, source, index)
  }

  const base = createBaseEvent(rawText, confidence, source, index)
  const convertMatch = normalizedText.match(CONVERT_PATTERN)
  if (convertMatch?.groups) {
    const fromLabel = convertMatch.groups.from ?? ""
    const detail = resolveCardDetail(fromLabel, deckProfile)
    return applyDeckSupport(
      {
        ...base,
        playerName: convertMatch.groups.player,
        action: "convert",
        cardName: detail.cardName,
        suit: detail.suit,
        rank: detail.rank,
        confidence,
        source,
        status: "pending",
        note: detail.cardName
          ? `转化牌事件，按原始牌 ${detail.cardName} 处理。`
          : `转化牌事件，${detail.note ?? "未识别原始牌名"}。`
      },
      deckProfile
    )
  }

  const judgeResultMatch = normalizedText.match(JUDGE_RESULT_PATTERN)
  if (judgeResultMatch?.groups) {
    const content = judgeResultMatch.groups.content ?? ""
    const detail = resolveCardDetail(content, deckProfile)
    const hasOnlySuit = SUIT_ONLY_PATTERN.test(normalizeText(content))
    return applyDeckSupport(
      {
        ...base,
        playerName: judgeResultMatch.groups.player,
        action: "judge",
        cardName: detail.cardName,
        suit: detail.suit,
        rank: detail.rank,
        confidence,
        source,
        status: "pending",
        note: detail.cardName
          ? "判定结果公开牌"
          : hasOnlySuit
            ? "未识别判定牌名"
            : detail.note
      },
      deckProfile
    )
  }

  const bracketMatch = normalizedText.match(BRACKETED_CARD_PATTERN)
  if (bracketMatch?.groups) {
    const detail = resolveCardDetail(bracketMatch.groups.content ?? "", deckProfile)
    return applyDeckSupport(
      {
        ...base,
        playerName: bracketMatch.groups.player,
        action: actionFromVerb(bracketMatch.groups.verb ?? ""),
        cardName: detail.cardName,
        suit: detail.suit,
        rank: detail.rank,
        confidence,
        source,
        status: "pending",
        note: detail.note
      },
      deckProfile
    )
  }

  const targetUseMatch = normalizedText.match(TARGET_USE_PATTERN)
  if (targetUseMatch?.groups) {
    const detail = resolveCardDetail(targetUseMatch.groups.content ?? "", deckProfile)
    return applyDeckSupport(
      {
        ...base,
        playerName: targetUseMatch.groups.player,
        targetName: targetUseMatch.groups.target,
        action: "use",
        cardName: detail.cardName,
        suit: detail.suit,
        rank: detail.rank,
        confidence,
        source,
        status: "pending",
        note: detail.note
      },
      deckProfile
    )
  }

  const directMatch = normalizedText.match(DIRECT_ACTION_PATTERN)
  if (directMatch?.groups) {
    const detail = resolveCardDetail(directMatch.groups.content ?? "", deckProfile)
    return applyDeckSupport(
      {
        ...base,
        playerName: directMatch.groups.player,
        action: actionFromVerb(directMatch.groups.verb ?? ""),
        cardName: detail.cardName,
        suit: detail.suit,
        rank: detail.rank,
        confidence,
        source,
        status: "pending",
        note: detail.note
      },
      deckProfile
    )
  }

  return {
    ...base,
    action: "unknown",
    confidence,
    source,
    status: "pending",
    note: "未匹配到支持的公开日志格式。"
  }
}

function getLineY(line: OcrLine, fallback: number): number {
  const box = line.box
  if (!box) {
    return fallback
  }

  if (Array.isArray(box)) {
    const ys = box
      .flatMap((point) => Array.isArray(point) ? [Number(point[1])] : [])
      .filter((value) => Number.isFinite(value))
    if (ys.length > 0) {
      return Math.min(...ys)
    }
  }

  if (typeof box === "object") {
    const record = box as Record<string, unknown>
    const y = Number(record.y ?? record.top)
    if (Number.isFinite(y)) {
      return y
    }
  }

  return fallback
}

function canParseCandidate(text: string, deckProfile: DeckProfile): boolean {
  const [event] = parseLogInput(text, "ocr", deckProfile)
  return Boolean(
    event &&
      event.action !== "unknown" &&
      event.action !== "ignore" &&
      event.cardName &&
      isKnownCardName(event.cardName)
  )
}

function hasDeckCardName(text: string, deckProfile: DeckProfile): boolean {
  return Boolean(findCardNameByLongestMatch(text, deckProfile))
}

function averageScore(lines: OcrLine[]): number {
  return lines.reduce((sum, line) => sum + line.score, 0) / Math.max(1, lines.length)
}

export function mergeBrokenOcrLines(
  lines: OcrLine[],
  deckProfile: DeckProfile = defaultDeckProfile
): OcrLine[] {
  const sortedLines = [...lines].sort((left, right) => getLineY(left, lines.indexOf(left)) - getLineY(right, lines.indexOf(right)))
  const merged: OcrLine[] = []

  for (let index = 0; index < sortedLines.length; index += 1) {
    const current = sortedLines[index]
    if (!current) {
      continue
    }

    const candidates: Array<{ text: string; take: number; score: number }> = [
      { text: current.text, take: 1, score: current.score }
    ]

    const next = sortedLines[index + 1]
    if (next) {
      candidates.push({
        text: `${current.text}${next.text}`,
        take: 2,
        score: averageScore([current, next])
      })
    }

    const third = sortedLines[index + 2]
    if (next && third) {
      candidates.push({
        text: `${current.text}${next.text}${third.text}`,
        take: 3,
        score: averageScore([current, next, third])
      })
    }

    const best = [...candidates]
      .filter((candidate) => hasDeckCardName(candidate.text, deckProfile) && canParseCandidate(candidate.text, deckProfile))
      .sort((left, right) => right.take - left.take || normalizeText(right.text).length - normalizeText(left.text).length)[0]

    if (best && best.take > 1) {
      merged.push({ text: best.text, score: best.score, box: current.box })
      index += best.take - 1
      continue
    }

    merged.push(current)
  }

  return merged
}

export function parseLogInput(
  input: OcrLine[] | string,
  source?: ParsedLogEvent["source"],
  deckProfile: DeckProfile = defaultDeckProfile
): ParsedLogEvent[] {
  if (typeof input === "string") {
    const resolvedSource = source ?? "manual"
    return input
      .split(/\r?\n/)
      .map((line, index) => parseSingleLine(line, resolvedSource === "manual" ? 1 : 0.95, resolvedSource, index, deckProfile))
      .filter((event): event is ParsedLogEvent => Boolean(event))
  }

  const resolvedSource = source ?? "ocr"
  return input
    .map((line, index) => parseSingleLine(line.text, line.score, resolvedSource, index, deckProfile))
    .filter((event): event is ParsedLogEvent => Boolean(event))
}
