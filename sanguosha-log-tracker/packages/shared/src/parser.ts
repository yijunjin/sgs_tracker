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
import { RuleEngine, type RuleActionHandlers, type RuleLibrary } from "./ruleEngine"
import { systemRuleLibrary } from "./rules"
import { isChooseGeneralLine } from "./startSignal"
import type { CardEventAction, CardName, DeckProfile, GameEvent, OcrLine, ParsedLogEvent, ParseQuality, TruncatedCardCompletionRule } from "./types"

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
const CONVERT_AS_PATTERN = /^(?<player>.+?)将【?(?<from>.+?)】?(?:当|视为)【?(?<to>.+?)】?使用$/u
const TARGET_USE_PATTERN = /^(?<player>.+?)对(?<target>.+?)使用(?<content>.+)$/u
const LET_EQUIP_PATTERN = /^(?<player>.+?)让(?<target>.+?)装备(?<content>.+)$/u
const DIRECT_ACTION_PATTERN = /^(?<player>.+?)(?<verb>使用|打出|弃置|装备)(?<content>.+)$/u
const JUDGE_RESULT_PATTERN = /^(?<player>.+?)的(?<judgeName>.+?)判定结果是(?<content>.+)$/u
const GAIN_KNOWN_PATTERN = /^(?<player>.+?)从(?<source>摸牌堆|五谷丰登)获得(?<content>.+)$/u
// 洛神/再起等技能：「甄姬获得判定牌青釭剑♠6」「孟获获得判定牌闪♦10」。
// 这类“获得判定牌”牌进入该玩家手牌且对我可见（判定结果公开），应归该玩家的已见手牌。
const JUDGE_CARD_GAIN_PATTERN = /^(?<player>.+?)获得判定牌(?<content>.+)$/u
const REGION_GAIN_PATTERN = /^(?<player>.+?)从(?<target>.+?)的(?<zone>手牌区|装备区|判定区|手牌|装备|判定牌)获得(?<content>.+)$/u
const POSSESSIVE_DISCARD_PATTERN = /^(?<player>.+?)弃置(?<target>.+?)的(?<content>.+)$/u
const RECAST_PATTERN = /^(?<player>.+?)重铸了?(?<content>.+)$/u
const SKILL_DISCARD_PATTERN = /^(?<player>.+?)发动(?<skill>[^，,。]*?)[，,]?(?:弃置了?|重铸了?)(?<content>.+)$/u
const PINDIAN_PATTERN = /^(?<player>.+?)与(?<target>.+?)拼点[，,](?<content>.+)$/u
const PINDIAN_CARD_PATTERN = /的拼点牌为(?<content>[^，,]+)/gu
const DRAW_NUMBER_PATTERN = /^(?<player>.+?)(?:从摸牌堆)?获得[1-9]\d*张牌$/u
const SKILL_INVOKE_PATTERN = /^(?<player>.+?)发动(?<skill>[\p{Script=Han}A-Za-z0-9_·-]{1,12})$/u
const SUIT_RANK_CARD_PATTERN = /^(?<suit>黑桃|红桃|梅花|方片|方块)?(?<rank>A|10|[2-9JQK])?\s*(?<card>.+)$/u
const SYMBOL_SUFFIX_CARD_PATTERN = /^(?<card>.+?)(?<suit>[♠♥♣♦])(?<rank>A|10|[2-9JQK])?$/u
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
  const symbolSuffixMatch = normalizedContent.match(SYMBOL_SUFFIX_CARD_PATTERN)
  const suitRankMatch = symbolSuffixMatch ? undefined : normalizedContent.match(SUIT_RANK_CARD_PATTERN)
  const suit = normalizeSuit(symbolSuffixMatch?.groups?.suit ?? suitRankMatch?.groups?.suit)
  const rank = symbolSuffixMatch?.groups?.rank ?? suitRankMatch?.groups?.rank
  const cardLabel = symbolSuffixMatch?.groups?.card ?? suitRankMatch?.groups?.card ?? normalizedContent
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
  if (/^出牌阶段/u.test(normalizedText) && /(目标|角色|此牌|置入弃牌堆|摸一张牌)/u.test(normalizedText)) {
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
  return findDelimitedCardDetails(content, deckProfile)
}

function findDelimitedCardDetails(content: string, deckProfile: DeckProfile): ResolvedCardDetail[] {
  const rawSegments = content
    .split(/[，,、]/u)
    .map((segment) => segment.trim())
    .filter(Boolean)

  return (rawSegments.length > 0 ? rawSegments : [normalizeText(content)]).map((segment) => resolveCardDetail(segment, deckProfile))
}

function supportedCardNamesFromDetails(details: ResolvedCardDetail[], deckProfile: DeckProfile): CardName[] {
  return details
    .map((detail) => detail.cardName)
    .filter((cardName): cardName is CardName => Boolean(cardName && isCardInDeck(deckProfile, cardName)))
}

function hasPartialCardMatch(details: ResolvedCardDetail[]): boolean {
  return details.some((item) => item.cardName && item.matchType && item.matchType !== "exact")
}

function hasUnresolvedCardDetail(details: ResolvedCardDetail[]): boolean {
  return details.some((item) => !item.cardName)
}

function firstDetailOrFallback(details: ResolvedCardDetail[], content: string, deckProfile: DeckProfile): ResolvedCardDetail {
  return details[0] ?? resolveCardDetail(content, deckProfile)
}

function createMultiCardNote(actionLabel: string, cardNames: CardName[], fallback?: string): string | undefined {
  if (cardNames.length > 1) {
    return `${actionLabel}多张牌：${cardNames.join("、")}`
  }
  return fallback
}

function findPindianCardDetails(content: string, deckProfile: DeckProfile): ResolvedCardDetail[] {
  const details = [...content.matchAll(PINDIAN_CARD_PATTERN)]
    .map((match) => match.groups?.content?.trim())
    .filter((segment): segment is string => Boolean(segment))
    .map((segment) => resolveCardDetail(segment, deckProfile))
  return details.length > 0 ? details : findDelimitedCardDetails(content, deckProfile)
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
    const rawGainKnownMatch = rawText.match(GAIN_KNOWN_PATTERN)
    const playerName = gainKnownMatch.groups.player
    const sourceName = rawGainKnownMatch?.groups?.source ?? gainKnownMatch.groups.source ?? "摸牌堆"
    const content = rawGainKnownMatch?.groups?.content ?? gainKnownMatch.groups.content ?? ""
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

  const judgeCardGainMatch = normalizedText.match(JUDGE_CARD_GAIN_PATTERN)
  if (judgeCardGainMatch?.groups) {
    const rawJudgeCardGainMatch = rawText.match(JUDGE_CARD_GAIN_PATTERN)
    const content = rawJudgeCardGainMatch?.groups?.content ?? judgeCardGainMatch.groups.content ?? ""
    const details = findGainKnownCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const playerName = judgeCardGainMatch.groups.player
    const isStrict = cardNames.length > 0 && !hasUnresolved && !hasPartialMatch && hasPlayerName(playerName)

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
          note: createMultiCardNote("获得判定牌", cardNames, detail.cardName ? "获得判定牌（公开），已加入获得者已知手牌。" : detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const regionGainMatch = normalizedText.match(REGION_GAIN_PATTERN)
  if (regionGainMatch?.groups) {
    const rawRegionGainMatch = rawText.match(REGION_GAIN_PATTERN)
    const content = rawRegionGainMatch?.groups?.content ?? regionGainMatch.groups.content ?? ""
    const details = findGainKnownCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const playerName = regionGainMatch.groups.player
    const targetName = regionGainMatch.groups.target
    const sourceZone = regionGainMatch.groups.zone
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(playerName) &&
      hasPlayerName(targetName)

    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName,
          targetName,
          sourcePlayerName: targetName,
          sourceZone,
          action: "gainKnown",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote(`从${targetName}的${sourceZone}获得`, cardNames, detail.cardName ? `从${targetName}的${sourceZone}获得公开牌，已加入获得者已知手牌。` : detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const pindianMatch = rawText.match(PINDIAN_PATTERN) ?? normalizedText.match(PINDIAN_PATTERN)
  if (pindianMatch?.groups) {
    const content = pindianMatch.groups.content ?? ""
    const pindianDetails = findPindianCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(pindianDetails, deckProfile)
    const detail = firstDetailOrFallback(pindianDetails, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(pindianDetails)
    const hasUnresolved = hasUnresolvedCardDetail(pindianDetails)
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(pindianMatch.groups.player) &&
      hasPlayerName(pindianMatch.groups.target)

    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: pindianMatch.groups.player,
          targetName: pindianMatch.groups.target,
          action: "discard",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote("拼点公开并弃置", cardNames, detail.cardName ? "拼点牌公开并进入弃牌堆" : detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const recastMatch = normalizedText.match(RECAST_PATTERN)
  if (recastMatch?.groups) {
    const rawRecastMatch = rawText.match(RECAST_PATTERN)
    const content = rawRecastMatch?.groups?.content ?? recastMatch.groups.content ?? ""
    const details = findDelimitedCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(recastMatch.groups.player) &&
      (details.length > 1 || !isSuspiciousContent(content))

    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: recastMatch.groups.player,
          action: "discard",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote("重铸", cardNames, detail.cardName ? "重铸牌进入弃牌堆" : detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const skillDiscardMatch = normalizedText.match(SKILL_DISCARD_PATTERN)
  if (skillDiscardMatch?.groups) {
    const rawSkillDiscardMatch = rawText.match(SKILL_DISCARD_PATTERN)
    const content = rawSkillDiscardMatch?.groups?.content ?? skillDiscardMatch.groups.content ?? ""
    const details = findDelimitedCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(skillDiscardMatch.groups.player) &&
      (details.length > 1 || !isSuspiciousContent(content))

    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: skillDiscardMatch.groups.player,
          action: "discard",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote(
            skillDiscardMatch.groups.skill ? `${skillDiscardMatch.groups.skill}弃置` : "技能弃置",
            cardNames,
            detail.cardName ? "技能弃置牌进入弃牌堆" : detail.note
          )
        },
        isStrict ? "strict" : "ambiguous"
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
    const rawBracketMatch = rawText.match(BRACKETED_CARD_PATTERN)
    const content = rawBracketMatch?.groups?.content ?? bracketMatch.groups.content ?? ""
    const details = findDelimitedCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(bracketMatch.groups.player)
    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: bracketMatch.groups.player,
          action: actionFromVerb(bracketMatch.groups.verb ?? ""),
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote("公开", cardNames, detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const letEquipMatch = normalizedText.match(LET_EQUIP_PATTERN)
  if (letEquipMatch?.groups) {
    const rawLetEquipMatch = rawText.match(LET_EQUIP_PATTERN)
    const content = rawLetEquipMatch?.groups?.content ?? letEquipMatch.groups.content ?? ""
    const details = findDelimitedCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(letEquipMatch.groups.player) &&
      hasPlayerName(letEquipMatch.groups.target)
    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: letEquipMatch.groups.player,
          targetName: letEquipMatch.groups.target,
          action: "equip",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote("装备", cardNames, detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const targetUseMatch = normalizedText.match(TARGET_USE_PATTERN)
  if (targetUseMatch?.groups) {
    const rawTargetUseMatch = rawText.match(TARGET_USE_PATTERN)
    const content = rawTargetUseMatch?.groups?.content ?? targetUseMatch.groups.content ?? ""
    const details = findDelimitedCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(targetUseMatch.groups.player) &&
      hasPlayerName(targetUseMatch.groups.target) &&
      (details.length > 1 || !isSuspiciousContent(content))
    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: targetUseMatch.groups.player,
          targetName: targetUseMatch.groups.target,
          action: "use",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote("使用", cardNames, detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const possessiveDiscardMatch = normalizedText.match(POSSESSIVE_DISCARD_PATTERN)
  if (possessiveDiscardMatch?.groups) {
    const rawPossessiveDiscardMatch = rawText.match(POSSESSIVE_DISCARD_PATTERN)
    const content = rawPossessiveDiscardMatch?.groups?.content ?? possessiveDiscardMatch.groups.content ?? ""
    const details = findDelimitedCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const playerName = possessiveDiscardMatch.groups.player
    const targetName = possessiveDiscardMatch.groups.target
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(playerName) &&
      hasPlayerName(targetName)

    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName,
          targetName,
          sourcePlayerName: targetName,
          action: "discard",
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote(`弃置${targetName}的牌`, cardNames, detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  const directMatch = normalizedText.match(DIRECT_ACTION_PATTERN)
  if (directMatch?.groups) {
    const rawDirectMatch = rawText.match(DIRECT_ACTION_PATTERN)
    const content = rawDirectMatch?.groups?.content ?? directMatch.groups.content ?? ""
    const details = findDelimitedCardDetails(content, deckProfile)
    const cardNames = supportedCardNamesFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const isStrict =
      cardNames.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      hasPlayerName(directMatch.groups.player) &&
      (details.length > 1 || !isSuspiciousContent(content))
    return applyDeckSupport(
      withQuality(
        {
          ...base,
          playerName: directMatch.groups.player,
          action: actionFromVerb(directMatch.groups.verb ?? ""),
          cardName: cardNames[0] ?? detail.cardName,
          cardNames,
          suit: detail.suit,
          rank: detail.rank,
          confidence,
          source,
          status: "pending",
          note: createMultiCardNote(actionFromVerb(directMatch.groups.verb ?? "") === "discard" ? "弃置" : "公开", cardNames, detail.note)
        },
        isStrict ? "strict" : "ambiguous"
      ),
      deckProfile
    )
  }

  return parseAmbiguousLine(rawText, confidence, source, index, "未匹配到支持的公开日志格式。")
}

function gameEventNameFromAction(action: CardEventAction): GameEvent["event"] {
  if (action === "use") return "OnCardUse"
  if (action === "play") return "OnCardPlay"
  if (action === "discard") return "OnCardDiscard"
  if (action === "equip") return "OnCardEquip"
  if (action === "judge") return "OnJudgeResult"
  if (action === "gainKnown") return "OnCardGain"
  if (action === "convert" || action === "convert-use") return "OnCardConvert"
  if (action === "ignore") return "OnIgnoredLog"
  return "OnUnknownLog"
}

function createBaseGameEvent(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number,
  event: GameEvent["event"]
): Pick<
  GameEvent,
  | "id"
  | "event"
  | "rawText"
  | "normalizedText"
  | "normalizedRawText"
  | "confidence"
  | "source"
  | "status"
  | "quality"
  | "autoAcceptable"
  | "appliedAliases"
  | "fingerprint"
  | "createdAt"
> {
  return {
    ...createBaseEvent(rawText, confidence, source, index),
    event,
    confidence,
    source,
    status: "pending",
    quality: "ambiguous",
    autoAcceptable: false
  }
}

function gameCardsFromDetails(details: ResolvedCardDetail[], deckProfile: DeckProfile): NonNullable<GameEvent["cards"]> {
  return details
    .filter((detail) => detail.cardName && isCardInDeck(deckProfile, detail.cardName))
    .map((detail) => ({
      name: detail.cardName,
      suit: detail.suit,
      rank: detail.rank
    }))
}

function firstGameCard(event: GameEvent): GameEvent["card"] {
  return event.card ?? event.cards?.[0]
}

function cardNamesFromGameCards(cards: GameEvent["cards"]): CardName[] {
  return (cards ?? []).map((card) => card.name).filter((cardName): cardName is CardName => Boolean(cardName))
}

function normalizeGameEventQuality(
  event: GameEvent,
  quality: ParseQuality,
  autoAcceptable = quality === "strict"
): GameEvent {
  return {
    ...event,
    quality,
    autoAcceptable: quality === "strict" && autoAcceptable
  }
}

function gameEventFromParsedLogEvent(event: ParsedLogEvent): GameEvent {
  const gameEventName = gameEventNameFromAction(event.action)
  const cards = (event.cardNames?.length ? event.cardNames : event.cardName ? [event.cardName] : []).map((cardName, index) => ({
    name: cardName,
    suit: index === 0 ? event.suit : undefined,
    rank: index === 0 ? event.rank : undefined
  }))
  return {
    id: event.id,
    event: gameEventName,
    rawText: event.rawText,
    normalizedText: event.normalizedText,
    normalizedRawText: event.normalizedRawText,
    player: event.playerName,
    target: event.targetName,
    sourcePlayer: event.sourcePlayerName,
    sourceZone: event.sourceZone,
    gainSource: event.action === "gainKnown" ? "legacyKnown" : undefined,
    skill: event.skillName,
    card: cards[0],
    cards,
    trackerAction: event.action,
    confidence: event.confidence,
    source: event.source,
    status: event.status,
    quality: event.quality,
    autoAcceptable: event.autoAcceptable,
    supportStatus: event.supportStatus,
    note: event.note,
    appliedAliases: event.appliedAliases,
    fingerprint: event.fingerprint,
    createdAt: event.createdAt
  }
}

function parseGameSingleLine(
  rawText: string,
  confidence: number,
  source: ParsedLogEvent["source"],
  index: number,
  deckProfile: DeckProfile
): GameEvent | undefined {
  const normalizedText = normalizeText(rawText)
  if (!normalizedText) {
    return undefined
  }

  const skillInvokeMatch = normalizedText.match(SKILL_INVOKE_PATTERN)
  if (skillInvokeMatch?.groups) {
    const rawSkillInvokeMatch = rawText.match(SKILL_INVOKE_PATTERN)
    const player = rawSkillInvokeMatch?.groups?.player ?? skillInvokeMatch.groups.player
    const skill = rawSkillInvokeMatch?.groups?.skill ?? skillInvokeMatch.groups.skill
    return normalizeGameEventQuality(
      {
        ...createBaseGameEvent(rawText, confidence, source, index, "OnSkillInvoke"),
        player,
        skill,
        status: "accepted",
        note: "技能发动事件"
      },
      hasPlayerName(player) && Boolean(skill) ? "strict" : "ambiguous"
    )
  }

  const drawNumberMatch = normalizedText.match(DRAW_NUMBER_PATTERN)
  if (drawNumberMatch?.groups) {
    const count = Number(normalizedText.match(/获得(?<count>[1-9]\d*)张牌/u)?.groups?.count)
    return normalizeGameEventQuality(
      {
        ...createBaseGameEvent(rawText, confidence, source, index, "OnCardDraw"),
        player: drawNumberMatch.groups.player,
        gainSource: "drawPile",
        count: Number.isFinite(count) ? count : undefined,
        trackerAction: "ignore",
        status: "ignored",
        note: "暗摸牌数量事件"
      },
      "ignored",
      false
    )
  }

  const gainKnownMatch = normalizedText.match(GAIN_KNOWN_PATTERN)
  if (gainKnownMatch?.groups) {
    const rawGainKnownMatch = rawText.match(GAIN_KNOWN_PATTERN)
    const player = gainKnownMatch.groups.player
    const sourceName = rawGainKnownMatch?.groups?.source ?? gainKnownMatch.groups.source ?? "摸牌堆"
    const content = rawGainKnownMatch?.groups?.content ?? gainKnownMatch.groups.content ?? ""
    const details = findGainKnownCardDetails(content, deckProfile)
    const cards = gameCardsFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const suspiciousPlayer = isSuspiciousPlayerName(player)
    const conflictingActions = hasConflictingActionKeywords(normalizedText)
    const quality: ParseQuality =
      cards.length > 0 &&
      !hasUnresolved &&
      !hasPartialMatch &&
      !suspiciousPlayer &&
      !conflictingActions &&
      hasPlayerName(player)
        ? "strict"
        : "ambiguous"

    const noteParts = [cards.length > 0 ? `公开日志显示从${sourceName}获得具名牌` : detail.note]
    if (suspiciousPlayer) noteParts.push("玩家名区域异常，疑似 OCR 串行污染")
    if (conflictingActions) noteParts.push("同一行包含冲突动作关键词，需要人工确认")

    return normalizeGameEventQuality(
      {
        ...createBaseGameEvent(rawText, confidence, source, index, "OnCardGain"),
        player,
        gainSource: sourceName === "五谷丰登" ? "fiveGrain" : "drawPile",
        card: cards[0] ?? (detail.cardName ? { name: detail.cardName, suit: detail.suit, rank: detail.rank } : undefined),
        cards,
        supportStatus: cards.length > 0 ? "supported" : undefined,
        note: noteParts.filter(Boolean).join("；") || undefined
      },
      quality
    )
  }

  const judgeCardGainMatch = normalizedText.match(JUDGE_CARD_GAIN_PATTERN)
  if (judgeCardGainMatch?.groups) {
    const rawJudgeCardGainMatch = rawText.match(JUDGE_CARD_GAIN_PATTERN)
    const content = rawJudgeCardGainMatch?.groups?.content ?? judgeCardGainMatch.groups.content ?? ""
    const details = findGainKnownCardDetails(content, deckProfile)
    const cards = gameCardsFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const player = judgeCardGainMatch.groups.player
    const isStrict = cards.length > 0 && !hasUnresolved && !hasPartialMatch && hasPlayerName(player)

    return normalizeGameEventQuality(
      {
        ...createBaseGameEvent(rawText, confidence, source, index, "OnCardGain"),
        player,
        gainSource: "judge",
        card: cards[0] ?? (detail.cardName ? { name: detail.cardName, suit: detail.suit, rank: detail.rank } : undefined),
        cards,
        supportStatus: cards.length > 0 ? "supported" : undefined,
        note: createMultiCardNote("获得判定牌", cardNamesFromGameCards(cards), detail.cardName ? "获得判定牌（公开）" : detail.note)
      },
      isStrict ? "strict" : "ambiguous"
    )
  }

  const regionGainMatch = normalizedText.match(REGION_GAIN_PATTERN)
  if (regionGainMatch?.groups) {
    const rawRegionGainMatch = rawText.match(REGION_GAIN_PATTERN)
    const content = rawRegionGainMatch?.groups?.content ?? regionGainMatch.groups.content ?? ""
    const details = findGainKnownCardDetails(content, deckProfile)
    const cards = gameCardsFromDetails(details, deckProfile)
    const detail = firstDetailOrFallback(details, content, deckProfile)
    const hasPartialMatch = hasPartialCardMatch(details)
    const hasUnresolved = hasUnresolvedCardDetail(details)
    const player = regionGainMatch.groups.player
    const target = regionGainMatch.groups.target
    const sourceZone = regionGainMatch.groups.zone
    const isStrict = cards.length > 0 && !hasUnresolved && !hasPartialMatch && hasPlayerName(player) && hasPlayerName(target)

    return normalizeGameEventQuality(
      {
        ...createBaseGameEvent(rawText, confidence, source, index, "OnCardGain"),
        player,
        target,
        sourcePlayer: target,
        sourceZone,
        gainSource: "region",
        card: cards[0] ?? (detail.cardName ? { name: detail.cardName, suit: detail.suit, rank: detail.rank } : undefined),
        cards,
        supportStatus: cards.length > 0 ? "supported" : undefined,
        note: createMultiCardNote(`从${target}的${sourceZone}获得`, cardNamesFromGameCards(cards), detail.cardName ? `从${target}的${sourceZone}获得公开牌` : detail.note)
      },
      isStrict ? "strict" : "ambiguous"
    )
  }

  const convertMatch = normalizedText.match(CONVERT_AS_PATTERN)
  if (convertMatch?.groups) {
    const rawConvertMatch = rawText.match(CONVERT_AS_PATTERN)
    const fromContent = rawConvertMatch?.groups?.from ?? convertMatch.groups.from ?? ""
    const toContent = rawConvertMatch?.groups?.to ?? convertMatch.groups.to ?? ""
    const fromDetail = resolveCardDetail(fromContent, deckProfile)
    const toDetail = resolveCardDetail(toContent, deckProfile)
    const player = convertMatch.groups.player
    const isStrict = Boolean(fromDetail.cardName && toDetail.cardName && hasPlayerName(player))

    return normalizeGameEventQuality(
      {
        ...createBaseGameEvent(rawText, confidence, source, index, "OnCardConvert"),
        player,
        fromCard: fromDetail.cardName ? { name: fromDetail.cardName, suit: fromDetail.suit, rank: fromDetail.rank } : undefined,
        toCard: toDetail.cardName ? { name: toDetail.cardName, suit: toDetail.suit, rank: toDetail.rank } : undefined,
        card: fromDetail.cardName ? { name: fromDetail.cardName, suit: fromDetail.suit, rank: fromDetail.rank } : undefined,
        cards: fromDetail.cardName ? [{ name: fromDetail.cardName, suit: fromDetail.suit, rank: fromDetail.rank }] : [],
        trackerAction: "convert",
        note: fromDetail.cardName
          ? `转化牌事件，原始牌 ${fromDetail.cardName}，视为 ${toDetail.cardName ?? toContent}。`
          : `转化牌事件，${fromDetail.note ?? "未识别原始牌名"}。`
      },
      isStrict ? "strict" : "ambiguous",
      false
    )
  }

  const parsed = parseSingleLine(rawText, confidence, source, index, deckProfile)
  return parsed ? gameEventFromParsedLogEvent(parsed) : undefined
}

function selectedGameCard(event: GameEvent, role: unknown): GameEvent["card"] {
  if (role === "fromCard") return event.fromCard
  if (role === "toCard") return event.toCard
  return firstGameCard(event)
}

function createTrackerEventFromGameEvent(
  event: GameEvent,
  deckProfile: DeckProfile,
  params: Record<string, unknown>
): ParsedLogEvent {
  const role = params.cardRole
  const selectedCard = selectedGameCard(event, role)
  const cards = role === "fromCard" && event.fromCard ? [event.fromCard] : event.cards ?? (selectedCard ? [selectedCard] : [])
  const cardNames = cardNamesFromGameCards(cards)
  const action = (typeof params.action === "string" ? params.action : event.trackerAction ?? "unknown") as CardEventAction
  const primaryCardName = selectedCard?.name ?? cardNames[0]
  const note = typeof params.note === "string" && params.note.length > 0 ? params.note : event.note
  const quality = action === "ignore" ? "ignored" : event.quality
  const status = action === "ignore" ? "ignored" : event.status
  const parsed = withQuality(
    {
      id: event.id,
      rawText: event.rawText,
      normalizedText: event.normalizedText,
      normalizedRawText: event.normalizedRawText,
      playerName: event.player,
      targetName: event.target,
      sourcePlayerName: typeof params.sourcePlayerName === "string" ? params.sourcePlayerName : event.sourcePlayer,
      sourceZone: typeof params.sourceZone === "string" ? params.sourceZone : event.sourceZone,
      action,
      cardName: primaryCardName,
      cardNames,
      virtualCardName: typeof params.virtualCardName === "string" ? params.virtualCardName : event.toCard?.name,
      skillName: typeof params.skillName === "string" ? params.skillName : event.skill,
      suit: selectedCard?.suit,
      rank: selectedCard?.rank,
      confidence: event.confidence,
      source: event.source === "protocol" ? "hook" : event.source,
      status,
      supportStatus: event.supportStatus,
      note,
      appliedAliases: event.appliedAliases,
      fingerprint: event.fingerprint,
      createdAt: event.createdAt
    },
    quality,
    action !== "ignore" && event.autoAcceptable
  )

  return applyDeckSupport(parsed, deckProfile)
}

export function createParsedLogEventRuleHandlers(
  output: ParsedLogEvent[],
  deckProfile: DeckProfile
): RuleActionHandlers {
  return {
    emitTrackerEvent: (params, context) => {
      const parsed = createTrackerEventFromGameEvent(context.event, deckProfile, params)
      if ((parsed.action !== "unknown" && parsed.cardName) || parsed.action === "ignore" || parsed.quality === "ambiguous") {
        output.push(parsed)
      }
    },
    markCardVisible: () => {
      // UI/runtime adapters can bind this to exact-card visibility state.
    },
    moveCardZone: () => {
      // UI/runtime adapters can bind this to exact-card zone state.
    },
    decrementDrawPile: () => {
      // The shared compatibility adapter has no draw-pile counter to mutate.
    }
  }
}

export function gameEventsToParsedLogEvents(
  events: GameEvent[],
  deckProfile: DeckProfile = defaultDeckProfile,
  ruleLibrary: RuleLibrary = systemRuleLibrary,
  handlers: RuleActionHandlers = {}
): ParsedLogEvent[] {
  const output: ParsedLogEvent[] = []
  const engine = new RuleEngine(ruleLibrary, {
    ...createParsedLogEventRuleHandlers(output, deckProfile),
    ...handlers
  })
  for (const event of events) {
    engine.trigger(event)
  }
  return output
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
  return gameEventsToParsedLogEvents(parseGameEvents(input, source, deckProfile), deckProfile)
}

export function parseGameEvents(
  input: OcrLine[] | string,
  source?: ParsedLogEvent["source"],
  deckProfile: DeckProfile = defaultDeckProfile
): GameEvent[] {
  if (typeof input === "string") {
    const resolvedSource = source ?? "manual"
    return input
      .split(/\r?\n/)
      .map((line, index) => parseGameSingleLine(line, resolvedSource === "manual" ? 1 : 0.95, resolvedSource, index, deckProfile))
      .filter((event): event is GameEvent => Boolean(event))
  }

  const resolvedSource = source ?? "ocr"
  return input
    .map((line, index) => parseGameSingleLine(line.text, line.score, resolvedSource, index, deckProfile))
    .filter((event): event is GameEvent => Boolean(event))
}
