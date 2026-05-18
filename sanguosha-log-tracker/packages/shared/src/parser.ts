import { defaultDeckProfile, isCardInDeck, isKnownCardName, KNOWN_CARD_NAMES } from "./cards"
import {
  findCardNameByLongestMatch,
  findKnownCardNameByLongestMatch,
  normalizeCardName,
  normalizeSuit,
  normalizeText,
  normalizeTextWithAliases
} from "./normalize"
import { canonicalPlayerKey, canonicalTargetKey, isSuspiciousPlayerName } from "./player"
import { isChooseGeneralLine } from "./startSignal"
import type { CardName, DeckProfile, OcrLine, ParsedLogEvent, ParseQuality, TruncatedCardCompletionRule } from "./types"

type CardMatchType = "exact" | "truncated-suffix" | "truncated-prefix"

type ResolvedCardDetail = {
  cardName?: ParsedLogEvent["cardName"] | undefined
  suit?: string | undefined
  rank?: string | undefined
  note?: string | undefined
  matchType?: CardMatchType | undefined
  confidence?: number | undefined
}

let runtimeTruncatedCardCompletionRules: TruncatedCardCompletionRule[] = []

export function setRuntimeTruncatedCardCompletionRules(rules: TruncatedCardCompletionRule[]): void {
  runtimeTruncatedCardCompletionRules = rules.filter((rule) => rule.enabled)
}

export function loadTruncatedCardCompletionRules(): TruncatedCardCompletionRule[] {
  return [...runtimeTruncatedCardCompletionRules]
}

const BRACKETED_CARD_PATTERN =
  /^(?<player>.+?)(?<verb>使用了|使用|打出了|打出|弃置了|弃置|装备了|装备|判定牌为)【(?<content>.+?)】$/u
const CONVERT_PATTERN = /^(?<player>.+?)将【(?<from>.+?)】当【(?<to>.+?)】使用$/u
const TARGET_USE_PATTERN = /^(?<player>.+?)对(?<target>.+?)使用(?<content>.+)$/u
const LET_EQUIP_PATTERN = /^(?<player>.+?)让(?<target>.+?)装备(?<content>.+)$/u
const DIRECT_ACTION_PATTERN = /^(?<player>.+?)(?<verb>使用|打出|弃置|装备)(?<content>.+)$/u
const JUDGE_RESULT_PATTERN = /^(?<player>.+?)的(?<judgeName>.+?)判定结果是(?<content>.+)$/u
const GAIN_KNOWN_PATTERN = /^(?<player>.+?)从(?<source>摸牌堆|五谷丰登)获得(?<content>.+)$/u
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
const CONFLICTING_ACTION_KEYWORDS = ["使用", "打出", "获得", "判定", "装备", "弃置"]
const PURE_DRAW_COUNT_PATTERN = /^(?:[1-9]\d*|[一二三四五六七八九十两]+)张牌$/u

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
  | "id"
  | "rawText"
  | "normalizedText"
  | "normalizedRawText"
  | "confidence"
  | "source"
  | "appliedAliases"
  | "fingerprint"
  | "createdAt"
> {
  const normalized = normalizeTextWithAliases(rawText)
  const normalizedText = normalized.text
  const fingerprint = normalizedText.replace(/\s+/g, "")
  return {
    id: createEventId(fingerprint, index),
    rawText,
    normalizedText,
    normalizedRawText: normalizedText,
    confidence,
    source,
    appliedAliases: normalized.appliedAliases,
    fingerprint,
    createdAt: new Date().toISOString()
  }
}

function enrichActorKeys(event: ParsedLogEvent): ParsedLogEvent {
  return {
    ...event,
    canonicalPlayerKey: canonicalPlayerKey(event.playerName),
    canonicalTargetKey: canonicalTargetKey(event.targetName),
    suspiciousPlayerName: isSuspiciousPlayerName(event.playerName)
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
  return enrichActorKeys({
    ...event,
    quality,
    autoAcceptable: quality === "strict" && autoAcceptable
  })
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

export function findCardNameByPartialMatch(
  fragment: string,
  deckProfile: DeckProfile
): {
  cardName: CardName
  matchType: CardMatchType
  confidence: number
} | undefined {
  const normalizedFragment = normalizeText(fragment)
  if (normalizedFragment.length < 2) {
    return undefined
  }

  const cardNames = [...new Set(deckProfile.cards.map((card) => card.name))]
  const exactMatch = cardNames.find((cardName) => cardName === normalizedFragment)
  if (exactMatch) {
    return {
      cardName: exactMatch,
      matchType: "exact",
      confidence: 1
    }
  }

  const ruleMatches = runtimeTruncatedCardCompletionRules.filter(
    (rule) =>
      normalizeText(rule.fragment) === normalizedFragment &&
      cardNames.includes(rule.canonical)
  )
  const uniqueRuleCanonicals = [...new Set(ruleMatches.map((rule) => `${rule.canonical}|${rule.direction}`))]
  if (uniqueRuleCanonicals.length === 1 && ruleMatches[0]) {
    return {
      cardName: ruleMatches[0].canonical,
      matchType: ruleMatches[0].direction === "prefix-missing" ? "truncated-suffix" : "truncated-prefix",
      confidence: ruleMatches[0].confidence
    }
  }

  const suffixMatches = cardNames.filter(
    (cardName) => cardName.length > normalizedFragment.length && cardName.endsWith(normalizedFragment)
  )
  if (suffixMatches.length === 1) {
    const cardName = suffixMatches[0]!
    return {
      cardName,
      matchType: "truncated-suffix",
      confidence: normalizedFragment.length / cardName.length
    }
  }

  const prefixMatches = cardNames.filter(
    (cardName) => cardName.length > normalizedFragment.length && cardName.startsWith(normalizedFragment)
  )
  if (prefixMatches.length === 1) {
    const cardName = prefixMatches[0]!
    return {
      cardName,
      matchType: "truncated-prefix",
      confidence: normalizedFragment.length / cardName.length
    }
  }

  return undefined
}

function resolveCardDetail(
  content: string,
  deckProfile: DeckProfile
): ResolvedCardDetail {
  const normalizedContent = normalizeText(content)
  const suitRankMatch = normalizedContent.match(SUIT_RANK_CARD_PATTERN)
  const suit = normalizeSuit(suitRankMatch?.groups?.suit)
  const rank = suitRankMatch?.groups?.rank
  const cardLabel = suitRankMatch?.groups?.card ?? normalizedContent
  const normalizedCardLabel = normalizeText(cardLabel)
  const directKnownCardName = isKnownCardName(normalizedCardLabel) ? normalizedCardLabel : normalizeCardName(normalizedCardLabel)
  const directDeckCardName = deckProfile.cards.some((card) => card.name === normalizedCardLabel) ? normalizedCardLabel : undefined
  const longestKnownCardName = findKnownCardNameByLongestMatch(cardLabel)
  const longestDeckCardName = findCardNameByLongestMatch(cardLabel, deckProfile)
  const partialMatch = findCardNameByPartialMatch(cardLabel, deckProfile)
  const cardName = directKnownCardName ?? directDeckCardName ?? longestKnownCardName ?? longestDeckCardName ?? partialMatch?.cardName
  const matchType: CardMatchType | undefined =
    directKnownCardName || directDeckCardName || longestKnownCardName || longestDeckCardName
      ? "exact"
      : partialMatch?.matchType

  return {
    cardName,
    suit,
    rank,
    matchType,
    confidence: partialMatch?.confidence ?? (cardName ? 1 : undefined),
    note: cardName
      ? matchType && matchType !== "exact"
        ? "疑似牌名截断补全"
        : undefined
      : `未识别牌名：${normalizedContent}`
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

function findGainKnownCardDetails(content: string, deckProfile: DeckProfile): ResolvedCardDetail[] {
  const normalizedContent = normalizeText(content)
  const segments = normalizedContent
    .split(/[，,、]/u)
    .map((segment) => segment.trim())
    .filter(Boolean)

  return (segments.length > 0 ? segments : [normalizedContent]).map((segment) => resolveCardDetail(segment, deckProfile))
}

function hasConflictingActionKeywords(text: string): boolean {
  return countMatches(normalizeText(text), CONFLICTING_ACTION_KEYWORDS) > 1
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
  return enrichActorKeys({
    ...createBaseEvent(rawText, confidence, source, index),
    action: "ignore",
    confidence,
    source,
    status: "ignored",
    quality: "ignored",
    autoAcceptable: false,
    note: isChooseGeneralLine(normalizedText) ? "开局选择武将标记，不计入牌库" : "不代表公开牌出现，已忽略。"
  })
}

function parseAmbiguousLine(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number,
  note: string
): ParsedLogEvent {
  return enrichActorKeys({
    ...createBaseEvent(rawText, confidence, source, index),
    action: "unknown",
    confidence,
    source,
    status: "pending",
    quality: "ambiguous",
    autoAcceptable: false,
    note
  })
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
    const playerName = gainKnownMatch.groups.player
    const sourceName = gainKnownMatch.groups.source ?? "摸牌堆"
    const content = gainKnownMatch.groups.content ?? ""
    const gainDetails = findGainKnownCardDetails(content, deckProfile)
    const cardNames = gainDetails
      .map((detail) => detail.cardName)
      .filter((cardName): cardName is CardName => Boolean(cardName && isCardInDeck(deckProfile, cardName)))
    const detail = resolveCardDetail(content, deckProfile)
    const suspiciousPlayer = isSuspiciousPlayerName(playerName)
    const conflictingActions = hasConflictingActionKeywords(normalizedText)
    const hasPartialMatch = gainDetails.some((item) => item.cardName && item.matchType && item.matchType !== "exact")

    if (PURE_DRAW_COUNT_PATTERN.test(normalizeText(content))) {
      return parseIgnoredLine(rawText, confidence, source, index)
    }

    const noteParts = [detail.cardName || cardNames.length > 0 ? `公开日志显示从${sourceName}获得具名牌` : detail.note]
    if (suspiciousPlayer) {
      noteParts.push("玩家名区域异常，疑似 OCR 串行污染")
    }
    if (conflictingActions) {
      noteParts.push("同一行包含冲突动作关键词，需要人工确认")
    }

    const quality: ParseQuality = !cardNames.length
      ? "ambiguous"
      : suspiciousPlayer || conflictingActions || !hasPlayerName(playerName) || hasPartialMatch
        ? "ambiguous"
        : "strict"

    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName,
          action: "gainKnown",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: noteParts.filter(Boolean).join("；") || undefined
        },
        quality,
        quality === "strict"
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
        detail.cardName && detail.matchType === "exact" && hasPlayerName(judgeResultMatch.groups.player) ? "strict" : "ambiguous"
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
        detail.cardName && detail.matchType === "exact" && hasPlayerName(bracketMatch.groups.player) ? "strict" : "ambiguous"
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
        detail.cardName && detail.matchType === "exact" && hasPlayerName(letEquipMatch.groups.player) && hasPlayerName(letEquipMatch.groups.target) ? "strict" : "ambiguous"
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
      detail.matchType === "exact" &&
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
    const isStrict =
      Boolean(detail.cardName) && detail.matchType === "exact" && hasPlayerName(directMatch.groups.player) && !isSuspiciousContent(content)
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
