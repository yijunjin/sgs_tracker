import { getDeckCardNames, getDeckTotalCounts, isCardInDeck } from "./cards"
import { normalizeText } from "./normalize"
import type { CardName, DeckProfile, ParsedLogEvent, TrackerState } from "./types"

const DUPLICATE_WINDOW_MS = 8000

function emptyCounts(deckProfile: DeckProfile): Record<CardName, number> {
  return Object.fromEntries(getDeckCardNames(deckProfile).map((cardName) => [cardName, 0]))
}

function computeRemainingCounts(
  deckProfile: DeckProfile,
  seenCounts: Record<CardName, number>
): Record<CardName, number> {
  const totalCounts = getDeckTotalCounts(deckProfile)
  return Object.fromEntries(
    getDeckCardNames(deckProfile).map((cardName) => [
      cardName,
      Math.max(0, (totalCounts[cardName] ?? 0) - (seenCounts[cardName] ?? 0))
    ])
  )
}

function computeOverSeenWarnings(
  deckProfile: DeckProfile,
  seenCounts: Record<CardName, number>
): Record<CardName, number> {
  const totalCounts = getDeckTotalCounts(deckProfile)
  return Object.fromEntries(
    getDeckCardNames(deckProfile)
      .map((cardName) => [cardName, Math.max(0, (seenCounts[cardName] ?? 0) - (totalCounts[cardName] ?? 0))] as const)
      .filter(([, overSeen]) => overSeen > 0)
  )
}

function cloneState(state: TrackerState): TrackerState {
  return {
    deckProfile: state.deckProfile,
    seenCounts: { ...state.seenCounts },
    remainingCounts: { ...state.remainingCounts },
    overSeenWarnings: { ...state.overSeenWarnings },
    events: state.events.map((event) => ({ ...event })),
    recentEvents: state.recentEvents.map((event) => ({ ...event })),
    acceptedHistory: [...state.acceptedHistory],
    fingerprintTimestamps: { ...state.fingerprintTimestamps }
  }
}

function shouldAffectCounts(
  deckProfile: DeckProfile,
  event: ParsedLogEvent
): event is ParsedLogEvent & { cardName: CardName } {
  return (
    event.status === "accepted" &&
    event.action !== "ignore" &&
    event.action !== "unknown" &&
    Boolean(event.cardName) &&
    isCardInDeck(deckProfile, event.cardName)
  )
}

function addCount(seenCounts: Record<CardName, number>, cardName: CardName, delta: number): void {
  seenCounts[cardName] = Math.max(0, (seenCounts[cardName] ?? 0) + delta)
}

function rebuildRecentEvents(state: TrackerState): void {
  const eventMap = new Map(state.events.map((event) => [event.id, event]))
  const recent = state.acceptedHistory
    .map((eventId) => eventMap.get(eventId))
    .filter(
      (event): event is ParsedLogEvent =>
        event !== undefined && shouldAffectCounts(state.deckProfile, event)
    )
    .slice(-20)
    .reverse()

  state.recentEvents = recent
}

function removeLastAcceptedHistory(acceptedHistory: string[], eventId: string): void {
  for (let index = acceptedHistory.length - 1; index >= 0; index -= 1) {
    if (acceptedHistory[index] === eventId) {
      acceptedHistory.splice(index, 1)
      return
    }
  }
}

function normalizeEventForDeck(deckProfile: DeckProfile, event: ParsedLogEvent): ParsedLogEvent {
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
    note: event.note?.includes("当前牌库不包含此牌")
      ? event.note
      : event.note
        ? `${event.note}；当前牌库不包含此牌`
        : "当前牌库不包含此牌"
  }
}

function recomputeDerivedCounts(state: TrackerState): void {
  state.remainingCounts = computeRemainingCounts(state.deckProfile, state.seenCounts)
  state.overSeenWarnings = computeOverSeenWarnings(state.deckProfile, state.seenCounts)
}

export function createInitialTrackerState(deckProfile: DeckProfile): TrackerState {
  const seenCounts = emptyCounts(deckProfile)
  return {
    deckProfile,
    seenCounts,
    remainingCounts: computeRemainingCounts(deckProfile, seenCounts),
    overSeenWarnings: computeOverSeenWarnings(deckProfile, seenCounts),
    events: [],
    recentEvents: [],
    acceptedHistory: [],
    fingerprintTimestamps: {}
  }
}

export function applyEvent(state: TrackerState, incomingEvent: ParsedLogEvent): TrackerState {
  const nextState = cloneState(state)
  const normalizedIncoming = normalizeEventForDeck(nextState.deckProfile, incomingEvent)
  const normalizedFingerprint = normalizeText(
    normalizedIncoming.fingerprint || normalizedIncoming.rawText
  ).replace(/\s+/g, "")
  const eventIndex = nextState.events.findIndex((event) => event.id === normalizedIncoming.id)

  if (eventIndex === -1) {
    const lastSeenAt = nextState.fingerprintTimestamps[normalizedFingerprint] ?? 0
    const createdAtMs = Date.parse(normalizedIncoming.createdAt) || Date.now()
    const shouldSkipAsDuplicate =
      normalizedIncoming.source !== "manual" &&
      normalizedIncoming.status !== "ignored" &&
      normalizedFingerprint.length > 0 &&
      createdAtMs - lastSeenAt < DUPLICATE_WINDOW_MS

    if (shouldSkipAsDuplicate) {
      return nextState
    }

    nextState.fingerprintTimestamps[normalizedFingerprint] = createdAtMs
    nextState.events.push({
      ...normalizedIncoming,
      fingerprint: normalizedFingerprint,
      normalizedText: normalizeText(normalizedIncoming.rawText),
      normalizedRawText: normalizeText(normalizedIncoming.rawText)
    })

    if (shouldAffectCounts(nextState.deckProfile, normalizedIncoming)) {
      addCount(nextState.seenCounts, normalizedIncoming.cardName, 1)
      nextState.acceptedHistory.push(normalizedIncoming.id)
    }
  } else {
    const previous = nextState.events[eventIndex]
    if (!previous) {
      return nextState
    }

    const merged = normalizeEventForDeck(nextState.deckProfile, {
      ...previous,
      ...normalizedIncoming,
      fingerprint: normalizedFingerprint || previous.fingerprint,
      normalizedText: normalizeText(normalizedIncoming.rawText || previous.rawText),
      normalizedRawText: normalizeText(normalizedIncoming.rawText || previous.rawText)
    })

    const previousAffectsCounts = shouldAffectCounts(nextState.deckProfile, previous)
    const nextAffectsCounts = shouldAffectCounts(nextState.deckProfile, merged)

    if (previousAffectsCounts && (!nextAffectsCounts || previous.cardName !== merged.cardName)) {
      addCount(nextState.seenCounts, previous.cardName, -1)
      removeLastAcceptedHistory(nextState.acceptedHistory, previous.id)
    }

    if (nextAffectsCounts && (!previousAffectsCounts || previous.cardName !== merged.cardName)) {
      addCount(nextState.seenCounts, merged.cardName, 1)
      nextState.acceptedHistory.push(merged.id)
    }

    nextState.events[eventIndex] = merged
  }

  recomputeDerivedCounts(nextState)
  rebuildRecentEvents(nextState)
  return nextState
}

export function acceptEvent(state: TrackerState, eventId: string): TrackerState {
  const event = state.events.find((item) => item.id === eventId)
  if (!event) {
    return state
  }

  return applyEvent(state, {
    ...event,
    status: "accepted"
  })
}

export function rejectEvent(state: TrackerState, eventId: string): TrackerState {
  const event = state.events.find((item) => item.id === eventId)
  if (!event) {
    return state
  }

  return applyEvent(state, {
    ...event,
    status: "rejected"
  })
}

export function undoLastEvent(state: TrackerState): TrackerState {
  const lastAcceptedId = [...state.acceptedHistory].reverse().find((eventId) => {
    const event = state.events.find((item) => item.id === eventId)
    return event && shouldAffectCounts(state.deckProfile, event)
  })

  if (!lastAcceptedId) {
    return state
  }

  const event = state.events.find((item) => item.id === lastAcceptedId)
  if (!event) {
    return state
  }

  return applyEvent(state, {
    ...event,
    status: "pending"
  })
}
