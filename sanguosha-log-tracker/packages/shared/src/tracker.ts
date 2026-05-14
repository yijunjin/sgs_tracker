import { getDeckCardNames, getDeckTotalCounts, isCardInDeck } from "./cards"
import { normalizeText } from "./normalize"
import { canonicalPlayerKey, canonicalTargetKey, isSuspiciousPlayerName } from "./player"
import type { CardName, DeckProfile, ParsedLogEvent, ReshuffleAlert, TrackerState, TrackerWarning } from "./types"

export const CYCLE_TOTAL_EXCEED_NOTE =
  "接受此事件会导致本轮已见超过牌库总数，疑似重复识别、误解析、洗牌未确认或牌库模式错误"

function emptyCounts(deckProfile: DeckProfile): Record<CardName, number> {
  return Object.fromEntries(getDeckCardNames(deckProfile).map((cardName) => [cardName, 0]))
}

function cloneCounts(counts: Record<CardName, number>): Record<CardName, number> {
  return { ...counts }
}

function cloneKnownCards(
  knownCardsByPlayer: Record<string, Record<CardName, number>>
): Record<string, Record<CardName, number>> {
  return Object.fromEntries(
    Object.entries(knownCardsByPlayer).map(([playerName, counts]) => [playerName, { ...counts }])
  )
}

function computeRemainingCounts(
  totalCounts: Record<CardName, number>,
  cycleSeenCounts: Record<CardName, number>
): Record<CardName, number> {
  return Object.fromEntries(
    Object.entries(totalCounts).map(([cardName, total]) => [
      cardName,
      Math.max(0, total - (cycleSeenCounts[cardName] ?? 0))
    ])
  )
}

function createCycleWarnings(
  totalCounts: Record<CardName, number>,
  cycleSeenCounts: Record<CardName, number>
): TrackerWarning[] {
  const warnings: TrackerWarning[] = []
  for (const [cardName, total] of Object.entries(totalCounts)) {
    const overSeen = Math.max(0, (cycleSeenCounts[cardName] ?? 0) - total)
    if (overSeen > 0) {
      warnings.push({
        id: `cycle-over-${cardName}`,
        level: "warning",
        cardName,
        message: "本轮已见超过牌库数量，疑似重复识别、误解析或牌库模式错误。"
      })
    }
  }
  return warnings
}

function computeOverSeenWarnings(
  totalCounts: Record<CardName, number>,
  cycleSeenCounts: Record<CardName, number>
): Record<CardName, number> {
  return Object.fromEntries(
    Object.entries(totalCounts)
      .map(([cardName, total]) => [cardName, Math.max(0, (cycleSeenCounts[cardName] ?? 0) - total)] as const)
      .filter(([, overSeen]) => overSeen > 0)
  )
}

function cloneState(state: TrackerState): TrackerState {
  return {
    ...state,
    totalCounts: cloneCounts(state.totalCounts),
    historySeenCounts: cloneCounts(state.historySeenCounts),
    cycleSeenCounts: cloneCounts(state.cycleSeenCounts),
    cycleRemainingCounts: cloneCounts(state.cycleRemainingCounts),
    knownCardsByPlayer: cloneKnownCards(state.knownCardsByPlayer),
    events: state.events.map((event) => ({ ...event })),
    recentEvents: state.recentEvents.map((event) => ({ ...event })),
    warnings: state.warnings.map((warning) => ({ ...warning })),
    reshuffleHistory: state.reshuffleHistory.map((record) => ({ ...record })),
    pendingReshuffleAlert: state.pendingReshuffleAlert ? { ...state.pendingReshuffleAlert } : undefined,
    acceptedHistory: [...state.acceptedHistory],
    fingerprintTimestamps: { ...state.fingerprintTimestamps },
    seenCounts: cloneCounts(state.seenCounts),
    remainingCounts: cloneCounts(state.remainingCounts),
    overSeenWarnings: cloneCounts(state.overSeenWarnings)
  }
}

function normalizeEventForDeck(deckProfile: DeckProfile, event: ParsedLogEvent): ParsedLogEvent {
  const normalized = {
    ...event,
    normalizedText: normalizeText(event.rawText),
    normalizedRawText: normalizeText(event.rawText),
    fingerprint: normalizeText(event.fingerprint || event.rawText).replace(/\s+/g, ""),
    canonicalPlayerKey: event.canonicalPlayerKey ?? canonicalPlayerKey(event.playerName),
    canonicalTargetKey: event.canonicalTargetKey ?? canonicalTargetKey(event.targetName),
    suspiciousPlayerName: event.suspiciousPlayerName ?? isSuspiciousPlayerName(event.playerName)
  }

  if (!normalized.cardName) {
    return normalized
  }

  if (isCardInDeck(deckProfile, normalized.cardName)) {
    return {
      ...normalized,
      supportStatus: "supported"
    }
  }

  return {
    ...normalized,
    supportStatus: "unsupported",
    quality: "unsupported",
    autoAcceptable: false,
    note: normalized.note?.includes("当前牌库不包含此牌")
      ? normalized.note
      : normalized.note
        ? `${normalized.note}；当前牌库不包含此牌`
        : "当前牌库不包含此牌"
  }
}

function shouldAffectCounts(
  deckProfile: DeckProfile,
  event: ParsedLogEvent
): event is ParsedLogEvent & { cardName: CardName } {
  return (
    event.status === "accepted" &&
    event.quality !== "ignored" &&
    event.quality !== "unsupported" &&
    event.supportStatus !== "unsupported" &&
    event.action !== "ignore" &&
    event.action !== "unknown" &&
    event.duplicate !== true &&
    Boolean(event.cardName) &&
    isCardInDeck(deckProfile, event.cardName)
  )
}

function addCount(counts: Record<CardName, number>, cardName: CardName, delta: number): void {
  counts[cardName] = Math.max(0, (counts[cardName] ?? 0) + delta)
}

function getKnownCardPlayerKey(playerName: string | undefined): string | undefined {
  return canonicalPlayerKey(playerName)
}

function getEventCardNames(event: Pick<ParsedLogEvent, "cardName" | "cardNames">): CardName[] {
  if (event.cardNames?.length) {
    return event.cardNames
  }

  return event.cardName ? [event.cardName] : []
}

function countEventCardNames(event: Pick<ParsedLogEvent, "cardName" | "cardNames">): Record<CardName, number> {
  return getEventCardNames(event).reduce<Record<CardName, number>>((counts, cardName) => {
    counts[cardName] = (counts[cardName] ?? 0) + 1
    return counts
  }, {})
}

function addKnownCard(
  knownCardsByPlayer: Record<string, Record<CardName, number>>,
  playerName: string | undefined,
  cardName: CardName,
  delta: number
): void {
  const playerKey = getKnownCardPlayerKey(playerName)
  if (!playerKey) {
    return
  }

  const playerCards = knownCardsByPlayer[playerKey] ?? {}
  playerCards[cardName] = Math.max(0, (playerCards[cardName] ?? 0) + delta)
  if (playerCards[cardName] === 0) {
    delete playerCards[cardName]
  }

  if (Object.keys(playerCards).length === 0) {
    delete knownCardsByPlayer[playerKey]
    return
  }

  knownCardsByPlayer[playerKey] = playerCards
}

function consumeKnownCard(
  knownCardsByPlayer: Record<string, Record<CardName, number>>,
  playerName: string | undefined,
  cardName: CardName
): boolean {
  const playerKey = getKnownCardPlayerKey(playerName)
  if (!playerKey) {
    return false
  }

  const current = knownCardsByPlayer[playerKey]?.[cardName] ?? 0
  if (current <= 0) {
    return false
  }

  addKnownCard(knownCardsByPlayer, playerName, cardName, -1)
  return true
}

export function wouldExceedCycleTotal(state: TrackerState, event: ParsedLogEvent): boolean {
  if (
    event.action === "ignore" ||
    event.action === "unknown" ||
    event.quality === "ignored" ||
    event.quality === "unsupported" ||
    event.supportStatus === "unsupported" ||
    !event.cardName
  ) {
    return false
  }

  if (event.action === "use" || event.action === "play" || event.action === "discard" || event.action === "equip") {
    if (consumeKnownCard(cloneKnownCards(state.knownCardsByPlayer), event.playerName, event.cardName)) {
      return false
    }

    return (state.cycleSeenCounts[event.cardName] ?? 0) + 1 > (state.totalCounts[event.cardName] ?? 0)
  }

  const eventCardCounts = countEventCardNames(event)
  return Object.entries(eventCardCounts).some(
    ([cardName, delta]) => (state.cycleSeenCounts[cardName] ?? 0) + delta > (state.totalCounts[cardName] ?? 0)
  )
}

function recomputeDerivedCounts(state: TrackerState): void {
  state.cycleRemainingCounts = computeRemainingCounts(state.totalCounts, state.cycleSeenCounts)
  state.warnings = createCycleWarnings(state.totalCounts, state.cycleSeenCounts)

  state.seenCounts = state.cycleSeenCounts
  state.remainingCounts = state.cycleRemainingCounts
  state.overSeenWarnings = computeOverSeenWarnings(state.totalCounts, state.cycleSeenCounts)
}

function rebuildRecentEvents(state: TrackerState): void {
  const eventMap = new Map(state.events.map((event) => [event.id, event]))
  state.recentEvents = state.acceptedHistory
    .map((eventId) => eventMap.get(eventId))
    .filter((event): event is ParsedLogEvent => Boolean(event && shouldAffectCounts(state.deckProfile, event)))
    .slice(-20)
    .reverse()
}

function removeLastAcceptedHistory(acceptedHistory: string[], eventId: string): void {
  for (let index = acceptedHistory.length - 1; index >= 0; index -= 1) {
    if (acceptedHistory[index] === eventId) {
      acceptedHistory.splice(index, 1)
      return
    }
  }
}

function applyAcceptedImpact(state: TrackerState, event: ParsedLogEvent & { cardName: CardName }): ParsedLogEvent {
  const nextEvent = {
    ...event,
    cycleId: event.cycleId ?? state.cycleId,
    canonicalPlayerKey: event.canonicalPlayerKey ?? canonicalPlayerKey(event.playerName),
    canonicalTargetKey: event.canonicalTargetKey ?? canonicalTargetKey(event.targetName)
  }
  const action = nextEvent.action
  const eventCardNames = getEventCardNames(nextEvent)

  if (action === "gainKnown") {
    for (const cardName of eventCardNames) {
      addCount(state.historySeenCounts, cardName, 1)
      addCount(state.cycleSeenCounts, cardName, 1)
      addKnownCard(state.knownCardsByPlayer, nextEvent.playerName, cardName, 1)
    }
    return {
      ...nextEvent,
      impactCount: 1,
      note:
        nextEvent.note ??
        (eventCardNames.length > 1
          ? `公开日志显示从摸牌堆获得 ${eventCardNames.length} 张具名牌，已加入该玩家已知手牌。`
          : "公开日志显示从摸牌堆获得具名牌，已加入该玩家已知手牌。")
    }
  }

  if (action === "judge") {
    for (const cardName of eventCardNames) {
      addCount(state.historySeenCounts, cardName, 1)
      addCount(state.cycleSeenCounts, cardName, 1)
    }
    return {
      ...nextEvent,
      impactCount: 1
    }
  }

  if (action === "use" || action === "play" || action === "discard" || action === "equip") {
    // This is a coarse name-only hand model. It cannot distinguish suit/rank duplicates,
    // but it prevents a publicly logged draw from being counted again when that card is later used.
    if (consumeKnownCard(state.knownCardsByPlayer, nextEvent.playerName, nextEvent.cardName)) {
      return {
        ...nextEvent,
        impactCount: 0,
        consumedKnownCard: true,
        note: nextEvent.note
          ? `${nextEvent.note}；消耗已知手牌，未重复计入已见牌。`
          : "消耗已知手牌，未重复计入已见牌。"
      }
    }

    addCount(state.historySeenCounts, nextEvent.cardName, 1)
    addCount(state.cycleSeenCounts, nextEvent.cardName, 1)
    return {
      ...nextEvent,
      impactCount: 1,
      consumedKnownCard: false
    }
  }

  return nextEvent
}

function revertAcceptedImpact(state: TrackerState, event: ParsedLogEvent & { cardName: CardName }): void {
  if (event.action === "gainKnown") {
    const eventCardNames = getEventCardNames(event)
    if (event.impactCount === 1) {
      for (const cardName of eventCardNames) {
        addCount(state.historySeenCounts, cardName, -1)
        addCount(state.cycleSeenCounts, cardName, -1)
      }
    }
    for (const cardName of eventCardNames) {
      addKnownCard(state.knownCardsByPlayer, event.playerName, cardName, -1)
    }
    return
  }

  if (
    event.impactCount === 0 &&
    event.consumedKnownCard &&
    (event.action === "use" || event.action === "play" || event.action === "discard" || event.action === "equip")
  ) {
    addKnownCard(state.knownCardsByPlayer, event.playerName, event.cardName, 1)
    return
  }

  if (event.impactCount === 1 || event.impactCount === undefined) {
    addCount(state.historySeenCounts, event.cardName, -1)
    addCount(state.cycleSeenCounts, event.cardName, -1)
  }
}

export function createInitialTrackerState(deckProfile: DeckProfile): TrackerState {
  const totalCounts = getDeckTotalCounts(deckProfile)
  const historySeenCounts = emptyCounts(deckProfile)
  const cycleSeenCounts = emptyCounts(deckProfile)
  const cycleRemainingCounts = computeRemainingCounts(totalCounts, cycleSeenCounts)
  return {
    deckProfileId: deckProfile.id,
    deckProfile,
    cycleId: 1,
    reshuffleCount: 0,
    totalCounts,
    historySeenCounts,
    cycleSeenCounts,
    cycleRemainingCounts,
    reshuffleHistory: [],
    knownCardsByPlayer: {},
    events: [],
    recentEvents: [],
    warnings: [],
    acceptedHistory: [],
    fingerprintTimestamps: {},
    seenCounts: cycleSeenCounts,
    remainingCounts: cycleRemainingCounts,
    overSeenWarnings: {}
  }
}

export function applyEvent(state: TrackerState, incomingEvent: ParsedLogEvent): TrackerState {
  const nextState = cloneState(state)
  const normalizedIncoming = normalizeEventForDeck(nextState.deckProfile, incomingEvent)
  const eventIndex = nextState.events.findIndex((event) => event.id === normalizedIncoming.id)

  if (eventIndex === -1) {
    let eventToStore = normalizedIncoming
    if (shouldAffectCounts(nextState.deckProfile, normalizedIncoming)) {
      eventToStore = applyAcceptedImpact(nextState, normalizedIncoming)
      nextState.acceptedHistory.push(eventToStore.id)
    }
    nextState.events.push(eventToStore)
  } else {
    const previous = nextState.events[eventIndex]
    if (!previous) {
      return nextState
    }

    if (shouldAffectCounts(nextState.deckProfile, previous)) {
      revertAcceptedImpact(nextState, previous)
      removeLastAcceptedHistory(nextState.acceptedHistory, previous.id)
    }

    let merged = normalizeEventForDeck(nextState.deckProfile, {
      ...previous,
      ...normalizedIncoming,
      impactCount: undefined,
      cycleId: normalizedIncoming.status === "accepted" ? nextState.cycleId : previous.cycleId
    })

    if (shouldAffectCounts(nextState.deckProfile, merged)) {
      merged = applyAcceptedImpact(nextState, merged)
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

export function undoEvent(state: TrackerState, eventId: string): TrackerState {
  const event = state.events.find((item) => item.id === eventId)
  if (!event) {
    return state
  }

  return applyEvent(state, {
    ...event,
    status: "pending"
  })
}

export function undoLastEvent(state: TrackerState): TrackerState {
  const lastAcceptedId = [...state.acceptedHistory].reverse().find((eventId) => {
    const event = state.events.find((item) => item.id === eventId)
    return event && shouldAffectCounts(state.deckProfile, event)
  })

  return lastAcceptedId ? undoEvent(state, lastAcceptedId) : state
}

export function updateDeckRemainingState(
  state: TrackerState,
  stableRemaining: number | undefined,
  rawText?: string | undefined,
  updatedAt = Date.now()
): TrackerState {
  if (stableRemaining === undefined) {
    return {
      ...cloneState(state),
      lastDeckRemainingRawText: rawText ?? state.lastDeckRemainingRawText,
      lastDeckRemainingUpdatedAt: rawText ? updatedAt : state.lastDeckRemainingUpdatedAt
    }
  }

  const nextState = cloneState(state)
  const previousStable = nextState.lastStableDeckRemaining
  nextState.deckRemainingFromOcr = stableRemaining
  nextState.lastStableDeckRemaining = stableRemaining
  nextState.lastDeckRemainingRawText = rawText ?? nextState.lastDeckRemainingRawText
  nextState.lastDeckRemainingUpdatedAt = updatedAt

  const deckTotal = Object.values(nextState.totalCounts).reduce((sum, count) => sum + count, 0)
  if (previousStable !== undefined) {
    const jumpThreshold = Math.max(5, Math.ceil(deckTotal * 0.15))
    const strongLowToHigh = previousStable <= 5 && stableRemaining >= deckTotal * 0.4
    const bigJump = stableRemaining > previousStable + jumpThreshold
    if ((strongLowToHigh || bigJump) && nextState.pendingReshuffleAlert?.status !== "pending") {
      nextState.pendingReshuffleAlert = {
        id: `reshuffle-${updatedAt}`,
        previousRemaining: previousStable,
        currentRemaining: stableRemaining,
        detectedAt: updatedAt,
        reason: strongLowToHigh
          ? "剩余牌从低值跳到高值，强烈疑似洗牌。"
          : "剩余牌数出现大幅回升，疑似洗牌。",
        status: "pending"
      }
    }
  }

  return nextState
}

export function confirmReshuffle(state: TrackerState, alertId?: string): TrackerState {
  const nextState = cloneState(state)
  const alert = nextState.pendingReshuffleAlert
  const now = Date.now()

  nextState.reshuffleHistory.push({
    id: alert?.id ?? `manual-reshuffle-${now}`,
    fromCycleId: nextState.cycleId,
    toCycleId: nextState.cycleId + 1,
    previousRemaining: alert?.previousRemaining,
    newRemaining: alert?.currentRemaining ?? nextState.lastStableDeckRemaining,
    confirmedAt: now,
    reason: alert?.reason ?? "用户手动标记洗牌。"
  })

  nextState.pendingReshuffleAlert = alert && (!alertId || alert.id === alertId)
    ? { ...alert, status: "confirmed" }
    : undefined
  nextState.cycleId += 1
  nextState.reshuffleCount += 1
  nextState.cycleSeenCounts = emptyCounts(nextState.deckProfile)
  nextState.knownCardsByPlayer = {}
  recomputeDerivedCounts(nextState)
  rebuildRecentEvents(nextState)
  return nextState
}

export function dismissReshuffleAlert(state: TrackerState): TrackerState {
  const nextState = cloneState(state)
  if (nextState.pendingReshuffleAlert) {
    nextState.pendingReshuffleAlert = {
      ...nextState.pendingReshuffleAlert,
      status: "dismissed"
    }
  }
  return nextState
}

export function setManualDeckRemaining(state: TrackerState, remaining: number): TrackerState {
  return updateDeckRemainingState(state, remaining, `手动修正：${remaining}`)
}

export type { ReshuffleAlert }
