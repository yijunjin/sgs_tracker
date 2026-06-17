export type CardName = string

export type CardEventAction =
  | "use"
  | "play"
  | "discard"
  | "equip"
  | "judge"
  | "gainKnown"
  | "convert"
  | "convert-use"
  | "ignore"
  | "unknown"

export type CardEventStatus = "pending" | "accepted" | "rejected" | "ignored"

export type CardSupportStatus = "supported" | "unsupported"

export type ParseQuality = "strict" | "ambiguous" | "ignored" | "unsupported"

export type GameEventName =
  | "OnCardUse"
  | "OnCardPlay"
  | "OnCardDiscard"
  | "OnCardEquip"
  | "OnCardGain"
  | "OnCardDraw"
  | "OnJudgeResult"
  | "OnSkillInvoke"
  | "OnCardConvert"
  | "OnIgnoredLog"
  | "OnUnknownLog"

export type GameEventCard = {
  name?: CardName | undefined
  suit?: string | undefined
  rank?: string | undefined
}

export interface GameEvent {
  id: string
  event: GameEventName
  rawText: string
  normalizedText: string
  normalizedRawText: string
  player?: string | undefined
  target?: string | undefined
  sourcePlayer?: string | undefined
  sourceZone?: string | undefined
  gainSource?: "drawPile" | "fiveGrain" | "judge" | "region" | "legacyKnown" | "unknown" | undefined
  skill?: string | undefined
  card?: GameEventCard | undefined
  cards?: GameEventCard[] | undefined
  fromCard?: GameEventCard | undefined
  toCard?: GameEventCard | undefined
  count?: number | undefined
  trackerAction?: CardEventAction | undefined
  confidence: number
  source: "ocr" | "manual" | "mock" | "hook" | "protocol"
  status: CardEventStatus
  quality: ParseQuality
  autoAcceptable: boolean
  supportStatus?: CardSupportStatus | undefined
  note?: string | undefined
  appliedAliases?: Array<{
    alias: string
    canonical: CardName
  }> | undefined
  fingerprint: string
  createdAt: string
}

export type RoiRect = {
  x: number
  y: number
  width: number
  height: number
}

export type RoiConfig = {
  logRoi: RoiRect
  deckCountRoi: RoiRect
}

export interface OcrLine {
  text: string
  score: number
  box?: unknown
}

export type OcrEvidenceImage = {
  dataUrl: string
  width: number
  height: number
  sourceWidth?: number | undefined
  sourceHeight?: number | undefined
  capturedAt: number
  kind: "logRoi"
  mimeType?: string | undefined
}

export type OcrLogRecord = {
  id: string
  text: string
  score?: number | undefined
  box?: unknown
  source: "ocr" | "manual" | "mock" | "hook"
  createdAt: number
}

export type DeckCardEntry = {
  name: CardName
  count: number
  type?: "basic" | "trick" | "equip"
  suit?: string
  rank?: string
  description?: string
}

export type DeckProfile = {
  id: string
  name: string
  description?: string
  aggregateBy: "name" | "exact-card"
  cards: DeckCardEntry[]
}

export interface ParsedLogEvent {
  id: string
  rawText: string
  normalizedText: string
  normalizedRawText: string
  playerName?: string | undefined
  targetName?: string | undefined
  sourcePlayerName?: string | undefined
  sourceZone?: string | undefined
  canonicalPlayerKey?: string | undefined
  canonicalTargetKey?: string | undefined
  canonicalSourcePlayerKey?: string | undefined
  suspiciousPlayerName?: boolean | undefined
  action: CardEventAction
  cardName?: CardName | undefined
  cardNames?: CardName[] | undefined
  virtualCardName?: CardName | undefined
  skillName?: string | undefined
  suit?: string | undefined
  rank?: string | undefined
  confidence: number
  source: "ocr" | "manual" | "mock" | "hook"
  status: CardEventStatus
  quality: ParseQuality
  autoAcceptable: boolean
  impactCount?: number | undefined
  consumedKnownCard?: boolean | undefined
  consumedKnownCardNames?: CardName[] | undefined
  cycleId?: number | undefined
  duplicate?: boolean | undefined
  supportStatus?: CardSupportStatus | undefined
  note?: string | undefined
  appliedAliases?: Array<{
    alias: string
    canonical: CardName
  }> | undefined
  evidenceImage?: OcrEvidenceImage | undefined
  fingerprint: string
  createdAt: string
}

export interface CardEvent {
  playerName?: string | undefined
  targetName?: string | undefined
  action: CardEventAction
  cardName?: CardName | undefined
  suit?: string | undefined
  rank?: string | undefined
  note?: string | undefined
}

export interface TrackerState {
  deckProfileId: string
  deckProfile: DeckProfile

  cycleId: number
  reshuffleCount: number

  totalCounts: Record<CardName, number>
  historySeenCounts: Record<CardName, number>
  cycleSeenCounts: Record<CardName, number>
  cycleRemainingCounts: Record<CardName, number>

  deckRemainingFromOcr?: number | undefined
  lastStableDeckRemaining?: number | undefined
  lastDeckRemainingRawText?: string | undefined
  lastDeckRemainingUpdatedAt?: number | undefined

  pendingReshuffleAlert?: ReshuffleAlert | undefined
  reshuffleHistory: ReshuffleRecord[]

  knownCardsByPlayer: Record<string, Record<CardName, number>>

  events: ParsedLogEvent[]
  recentEvents: ParsedLogEvent[]
  warnings: TrackerWarning[]
  acceptedHistory: string[]
  fingerprintTimestamps: Record<string, number>

  // Backward-compatible aliases used by older UI/API callers.
  seenCounts: Record<CardName, number>
  remainingCounts: Record<CardName, number>
  overSeenWarnings: Record<CardName, number>
}

export type ReshuffleAlert = {
  id: string
  previousRemaining: number
  currentRemaining: number
  detectedAt: number
  reason: string
  status: "pending" | "confirmed" | "dismissed"
}

export type ReshuffleRecord = {
  id: string
  fromCycleId: number
  toCycleId: number
  previousRemaining?: number | undefined
  newRemaining?: number | undefined
  confirmedAt: number
  reason: string
}

export type TrackerWarning = {
  id: string
  level: "info" | "warning" | "error"
  message: string
  cardName?: CardName | undefined
  eventId?: string | undefined
}

export type OcrAliasEntry = {
  id: string
  alias: string
  canonical: CardName
  source: "builtIn" | "manual" | "mined"
  confidence: number
  enabled: boolean
  hitCount: number
  createdAt: number
  updatedAt?: number | undefined
  note?: string | undefined
}

export type AliasCandidateKind =
  | "ocr-alias"
  | "truncated-prefix"
  | "truncated-suffix"
  | "user-correction"
  | "dirty-text"

export type TruncatedCardCompletionRule = {
  id: string
  fragment: string
  canonical: CardName
  direction: "prefix-missing" | "suffix-missing"
  enabled: boolean
  confidence: number
  createdAt: number
  note?: string | undefined
}

export type OcrAliasCandidate = {
  id: string
  alias: string
  suggestedCanonical: CardName
  kind: AliasCandidateKind
  canAcceptAsAlias: boolean
  confidence: number
  count: number
  sources: Array<"unknownEvent" | "ambiguousEvent" | "userCorrection" | "fuzzyMatch" | "overLimitEvent">
  sessionIds: string[]
  examples: Array<{
    sessionId: string
    rawText: string
    normalizedText?: string | undefined
    eventId?: string | undefined
    evidenceImage?: OcrEvidenceImage | undefined
    lineBox?: unknown
  }>
  status: "pending" | "accepted" | "rejected"
  createdAt: number
  updatedAt?: number | undefined
  note?: string | undefined
}

export type SessionExportStatus = "pending" | "exported" | "aliasAnalyzed" | "failed"

export type UserCorrectionRecord = {
  id: string
  sessionId: string
  eventId: string
  rawText: string
  previousCardName?: CardName | undefined
  correctedCardName?: CardName | undefined
  reason: "misrecognized" | "wrongCard" | "wrongAction" | "duplicate" | "unsupported"
  createdAt: number
}

export type SessionReport = {
  sessionId: string
  deckProfileId: string
  startedAt: number
  endedAt?: number | undefined
  ocrEngine: string
  aliasDictionaryVersion?: string | undefined

  rawOcrLines: OcrLogRecord[]
  mergedLines: OcrLogRecord[]
  parsedEvents: ParsedLogEvent[]
  acceptedEvents: ParsedLogEvent[]
  ignoredEvents: ParsedLogEvent[]
  ambiguousEvents: ParsedLogEvent[]
  unsupportedEvents: ParsedLogEvent[]
  userCorrections: UserCorrectionRecord[]

  summary: {
    rawLineCount: number
    mergedLineCount: number
    parsedEventCount: number
    acceptedCount: number
    ignoredCount: number
    ambiguousCount: number
    unsupportedCount: number
    correctionCount: number
  }
}
