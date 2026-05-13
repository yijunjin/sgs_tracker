export type CardName = string

export type CardEventAction =
  | "use"
  | "play"
  | "discard"
  | "equip"
  | "judge"
  | "convert"
  | "convert-use"
  | "ignore"
  | "unknown"

export type CardEventStatus = "pending" | "accepted" | "rejected" | "ignored"

export type CardSupportStatus = "supported" | "unsupported"

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
  deckProfile: DeckProfile
  seenCounts: Record<CardName, number>
  remainingCounts: Record<CardName, number>
  overSeenWarnings: Record<CardName, number>
  events: ParsedLogEvent[]
  recentEvents: ParsedLogEvent[]
  acceptedHistory: string[]
  fingerprintTimestamps: Record<string, number>
}
