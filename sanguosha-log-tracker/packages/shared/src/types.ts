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

export type DeckCardEntry = {
  name: CardName
  count: number
  type?: "basic" | "trick" | "equip"
  suit?: string
  rank?: string
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
  action: CardEventAction
  cardName?: CardName | undefined
  suit?: string | undefined
  rank?: string | undefined
  confidence: number
  source: "ocr" | "manual" | "mock"
  status: CardEventStatus
  quality: ParseQuality
  autoAcceptable: boolean
  impactCount?: 0 | 1 | undefined
  cycleId?: number | undefined
  duplicate?: boolean | undefined
  supportStatus?: CardSupportStatus | undefined
  note?: string | undefined
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
