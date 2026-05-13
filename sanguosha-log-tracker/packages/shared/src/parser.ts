import { defaultDeckProfile, isCardInDeck, isKnownCardName, KNOWN_CARD_NAMES } from "./cards"
import {
  findCardNameByLongestMatch,
  findKnownCardNameByLongestMatch,
  normalizeCardName,
  normalizeSuit,
  normalizeText
} from "./normalize"
import { isChooseGeneralLine } from "./startSignal"
import type { DeckProfile, OcrLine, ParsedLogEvent, ParseQuality } from "./types"

const BRACKETED_CARD_PATTERN =
  /^(?<player>.+?)(?<verb>使用了|使用|打出了|打出|弃置了|弃置|装备了|装备|判定牌为)【(?<content>.+?)】$/u
const CONVERT_PATTERN = /^(?<player>.+?)将【(?<from>.+?)】当【(?<to>.+?)】使用$/u
const TARGET_USE_PATTERN = /^(?<player>.+?)对(?<target>.+?)使用(?<content>.+)$/u
const LET_EQUIP_PATTERN = /^(?<player>.+?)让(?<target>.+?)装备(?<content>.+)$/u
const DIRECT_ACTION_PATTERN = /^(?<player>.+?)(?<verb>使用|打出|弃置|装备)(?<content>.+)$/u
const JUDGE_RESULT_PATTERN = /^(?<player>.+?)的(?<judgeName>.+?)判定结果是(?<content>.+)$/u
const GAIN_KNOWN_PATTERN = /^(?<player>.+?)从摸牌堆获得(?<content>.+)$/u
const DRAW_NUMBER_PATTERN = /^(?<player>.+?)(?:从摸牌堆)?获得[1-9]\d*张牌$/u
const SUIT_RANK_CARD_PATTERN = /^(?<suit>黑桃|红桃|梅花|方片|方块)?(?<rank>A|10|[2-9JQK])?\s*(?<card>.+)$/u
const SUIT_ONLY_PATTERN = /(黑桃|红桃|梅花|方片|方块)(A|10|[2-9JQK])?$/u

const IGNORE_PATTERNS = [
  "观看牌堆顶",
  "牌堆顶",
  "置于牌堆顶",
  "摸牌",
  "回复1点体力",
  "体力值为",
  "受到1点伤害",
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

const ACTION_KEYWORDS = ["使用", "打出", "弃置", "装备", "判定结果是", "从摸牌堆获得", "获得", "发动", "生效"]

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

function withQuality(
  event: Omit<ParsedLogEvent, "quality" | "autoAcceptable">,
  quality: ParseQuality,
  autoAcceptable = quality === "strict"
): ParsedLogEvent {
  return {
    ...event,
    quality,
    autoAcceptable: quality === "strict" && autoAcceptable
  }
}

function applyDeckSupport(event: ParsedLogEvent, deckProfile: DeckProfile): ParsedLogEvent {
  if (!event.cardName) {
    return event
  }

  if (isCardInDeck(deckProfile, event.cardName)) {
    return {
      ...event,
      supportStatus: "supported",
      autoAcceptable: event.quality === "strict" && event.autoAcceptable
    }
  }

  return {
    ...event,
    supportStatus: "unsupported",
    quality: "unsupported",
    autoAcceptable: false,
    note: event.note ? `${event.note}；当前牌库不包含此牌` : "当前牌库不包含此牌"
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
  if (isChooseGeneralLine(normalizedText)) {
    return true
  }
  if (GAIN_KNOWN_PATTERN.test(normalizedText) && !DRAW_NUMBER_PATTERN.test(normalizedText)) {
    return false
  }
  return DRAW_NUMBER_PATTERN.test(normalizedText) || IGNORE_PATTERNS.some((pattern) => normalizedText.includes(pattern))
}

function hasPlayerName(value: string | undefined): value is string {
  return Boolean(value && value.length >= 1 && !/^[的牌张]+$/u.test(value))
}

function countMatches(text: string, values: string[]): number {
  return values.reduce((sum, value) => sum + (text.includes(value) ? 1 : 0), 0)
}

function findAllKnownCardNames(text: string): string[] {
  const normalized = normalizeText(text)
  const matchedNames = [...KNOWN_CARD_NAMES]
    .sort((left, right) => right.length - left.length)
    .filter((cardName) => normalized.includes(cardName))

  return matchedNames.filter(
    (cardName, index) => !matchedNames.slice(0, index).some((longer) => longer.includes(cardName))
  )
}

function isSuspiciousContent(content: string): boolean {
  const normalized = normalizeText(content)
  return countMatches(normalized, ACTION_KEYWORDS) > 0 || findAllKnownCardNames(normalized).length > 1 || /[·•]/u.test(normalized)
}

function parseIgnoredLine(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number
): ParsedLogEvent {
  const normalizedText = normalizeText(rawText)
  return {
    ...createBaseEvent(rawText, confidence, source, index),
    action: "ignore",
    confidence,
    source,
    status: "ignored",
    quality: "ignored",
    autoAcceptable: false,
    note: isChooseGeneralLine(normalizedText) ? "开局选择武将标记，不计入牌库" : "不代表公开牌出现，已忽略。"
  }
}

function parseAmbiguousLine(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number,
  note: string
): ParsedLogEvent {
  return {
    ...createBaseEvent(rawText, confidence, source, index),
    action: "unknown",
    confidence,
    source,
    status: "pending",
    quality: "ambiguous",
    autoAcceptable: false,
    note
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

  const gainKnownMatch = normalizedText.match(GAIN_KNOWN_PATTERN)
  if (gainKnownMatch?.groups) {
    const detail = resolveCardDetail(gainKnownMatch.groups.content ?? "", deckProfile)
    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: gainKnownMatch.groups.player,
          action: "gainKnown",
          cardName: detail.cardName,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: detail.cardName ? "公开日志显示从摸牌堆获得具名牌" : detail.note
        },
        detail.cardName && hasPlayerName(gainKnownMatch.groups.player) ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  if (findAllKnownCardNames(normalizedText).length > 0 && !/(使用|打出|弃置|装备|判定结果是|判定牌为|从摸牌堆获得|将【)/u.test(normalizedText)) {
    return parseAmbiguousLine(rawText, confidence, source, index, "识别到孤立牌名，但缺少可确认的公开动作上下文。")
  }

  const convertMatch = normalizedText.match(CONVERT_PATTERN)
  if (convertMatch?.groups) {
    const detail = resolveCardDetail(convertMatch.groups.from ?? "", deckProfile)
    return applyDeckSupport(
      withQuality(
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
        "ambiguous",
        false
      ),
      deckProfile
    )
  }

  const judgeResultMatch = normalizedText.match(JUDGE_RESULT_PATTERN)
  if (judgeResultMatch?.groups) {
    const content = judgeResultMatch.groups.content ?? ""
    const detail = resolveCardDetail(content, deckProfile)
    const hasOnlySuit = SUIT_ONLY_PATTERN.test(normalizeText(content))
    return applyDeckSupport(
      withQuality(
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
          note: detail.cardName ? "判定结果公开牌" : hasOnlySuit ? "未识别判定牌名" : detail.note
        },
        detail.cardName && hasPlayerName(judgeResultMatch.groups.player) ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const bracketMatch = normalizedText.match(BRACKETED_CARD_PATTERN)
  if (bracketMatch?.groups) {
    const detail = resolveCardDetail(bracketMatch.groups.content ?? "", deckProfile)
    return applyDeckSupport(
      withQuality(
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
        detail.cardName && hasPlayerName(bracketMatch.groups.player) ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const letEquipMatch = normalizedText.match(LET_EQUIP_PATTERN)
  if (letEquipMatch?.groups) {
    const detail = resolveCardDetail(letEquipMatch.groups.content ?? "", deckProfile)
    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: letEquipMatch.groups.player,
          targetName: letEquipMatch.groups.target,
          action: "equip",
          cardName: detail.cardName,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: detail.note
        },
        detail.cardName && hasPlayerName(letEquipMatch.groups.player) && hasPlayerName(letEquipMatch.groups.target) ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const targetUseMatch = normalizedText.match(TARGET_USE_PATTERN)
  if (targetUseMatch?.groups) {
    const content = targetUseMatch.groups.content ?? ""
    const detail = resolveCardDetail(content, deckProfile)
    const isStrict =
      Boolean(detail.cardName) &&
      hasPlayerName(targetUseMatch.groups.player) &&
      hasPlayerName(targetUseMatch.groups.target) &&
      !isSuspiciousContent(content)
    return applyDeckSupport(
      withQuality(
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
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const directMatch = normalizedText.match(DIRECT_ACTION_PATTERN)
  if (directMatch?.groups) {
    const content = directMatch.groups.content ?? ""
    const detail = resolveCardDetail(content, deckProfile)
    const isStrict = Boolean(detail.cardName) && hasPlayerName(directMatch.groups.player) && !isSuspiciousContent(content)
    return applyDeckSupport(
      withQuality(
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
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  return parseAmbiguousLine(rawText, confidence, source, index, "未匹配到支持的公开日志格式。")
}

function getLineY(line: OcrLine, fallback: number): number {
  const box = line.box
  if (!box) {
    return fallback
  }

  if (Array.isArray(box)) {
    const ys = box
      .flatMap((point) => (Array.isArray(point) ? [Number(point[1])] : []))
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
      event.quality === "strict" &&
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
