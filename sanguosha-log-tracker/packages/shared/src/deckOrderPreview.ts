import type { DeckCardEntry } from "./types"

export type DeckOrderPreviewCardDetail = Pick<DeckCardEntry, "name" | "rank" | "suit" | "description">

export type DeckOrderPreviewCard = {
  cardId: number
  detail?: DeckOrderPreviewCardDetail
}

export type DeckOrderPreviewState = {
  top: DeckOrderPreviewCard[]
  bottom: DeckOrderPreviewCard[]
  pendingTopDetails: DeckOrderPreviewCardDetail[]
  pendingBottomDetails: DeckOrderPreviewCardDetail[]
  peekCount: number
  at: number
}

export type DeckOrderPreviewConfig = {
  drawPileZone: number
  previewZone: number
  topPosition: number
  topOrder?: "as-is" | "reverse"
  bottomOrder?: "as-is" | "reverse"
  maxPendingDetails?: number
}

export type DeckOrderPreviewMoveInput = {
  fromZone?: number | undefined
  toZone?: number | undefined
  toPosition?: number | undefined
  cardIds: number[]
  at: number
}

export type DeckOrderPreviewMoveResult = {
  state: DeckOrderPreviewState
  handled: boolean
  started: boolean
  placedTop: number
  placedBottom: number
}

export function createDeckOrderPreviewState(): DeckOrderPreviewState {
  return {
    top: [],
    bottom: [],
    pendingTopDetails: [],
    pendingBottomDetails: [],
    peekCount: 0,
    at: 0
  }
}

export function resetDeckOrderPreviewState(state: DeckOrderPreviewState = createDeckOrderPreviewState()): DeckOrderPreviewState {
  void state
  return createDeckOrderPreviewState()
}

function previewCardFromId(cardId: number): DeckOrderPreviewCard {
  return { cardId }
}

function orderCards(cardIds: number[], order: "as-is" | "reverse" | undefined): DeckOrderPreviewCard[] {
  const orderedIds = order === "reverse" ? [...cardIds].reverse() : cardIds
  return orderedIds.map(previewCardFromId)
}

function attachDetails(cards: DeckOrderPreviewCard[], details: DeckOrderPreviewCardDetail[]): DeckOrderPreviewCard[] {
  details.forEach((detail, index) => {
    const card = cards[index]
    if (card) {
      card.detail = detail
    }
  })
  return cards
}

export function applyDeckOrderPreviewMove(
  state: DeckOrderPreviewState,
  config: DeckOrderPreviewConfig,
  move: DeckOrderPreviewMoveInput
): DeckOrderPreviewMoveResult {
  if (move.fromZone === config.drawPileZone && move.toZone === config.previewZone) {
    return {
      state: {
        top: [],
        bottom: [],
        pendingTopDetails: [],
        pendingBottomDetails: [],
        peekCount: move.cardIds.length,
        at: move.at
      },
      handled: true,
      started: true,
      placedTop: 0,
      placedBottom: 0
    }
  }

  if (move.fromZone !== config.previewZone || move.toZone !== config.drawPileZone) {
    return {
      state,
      handled: false,
      started: false,
      placedTop: 0,
      placedBottom: 0
    }
  }

  if (move.toPosition === config.topPosition) {
    const pendingTopDetails = [...state.pendingTopDetails]
    const cards = attachDetails(orderCards(move.cardIds, config.topOrder), pendingTopDetails.splice(0, move.cardIds.length))
    return {
      state: {
        ...state,
        top: cards.concat(state.top),
        pendingTopDetails,
        at: move.at
      },
      handled: true,
      started: false,
      placedTop: move.cardIds.length,
      placedBottom: 0
    }
  }

  const pendingBottomDetails = [...state.pendingBottomDetails]
  const cards = attachDetails(orderCards(move.cardIds, config.bottomOrder), pendingBottomDetails.splice(0, move.cardIds.length))
  return {
    state: {
      ...state,
      bottom: state.bottom.concat(cards),
      pendingBottomDetails,
      at: move.at
    },
    handled: true,
    started: false,
    placedTop: 0,
    placedBottom: move.cardIds.length
  }
}

export function consumeDeckOrderPreviewTop(state: DeckOrderPreviewState, drawnCount: number): DeckOrderPreviewState {
  if (drawnCount <= 0 || state.top.length === 0) {
    return state
  }
  return {
    ...state,
    top: state.top.slice(Math.min(drawnCount, state.top.length))
  }
}

function fillDetails(
  queue: DeckOrderPreviewCard[],
  details: DeckOrderPreviewCardDetail[],
  edge: "head" | "tail"
): DeckOrderPreviewCardDetail[] {
  if (!details.length) {
    return []
  }
  const indices = queue
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.detail)
    .map(({ index }) => index)
  const targetIndices = edge === "head" ? indices.slice(0, details.length) : indices.slice(-details.length)
  targetIndices.forEach((queueIndex, detailIndex) => {
    const detail = details[detailIndex]
    const card = queue[queueIndex]
    if (card && detail) {
      card.detail = detail
    }
  })
  return details.slice(targetIndices.length)
}

export function addDeckOrderPreviewDetails(
  state: DeckOrderPreviewState,
  config: Pick<DeckOrderPreviewConfig, "maxPendingDetails">,
  placement: "top" | "bottom",
  details: DeckOrderPreviewCardDetail[],
  at: number
): DeckOrderPreviewState {
  if (!details.length) {
    return state
  }
  const maxPending = Math.max(config.maxPendingDetails ?? 8, state.peekCount)
  const top = state.top.map((card) => ({ ...card }))
  const bottom = state.bottom.map((card) => ({ ...card }))
  if (placement === "top") {
    const leftovers = fillDetails(top, details, "head")
    return {
      ...state,
      top,
      pendingTopDetails: leftovers.concat(state.pendingTopDetails).slice(0, maxPending),
      at
    }
  }
  const leftovers = fillDetails(bottom, details, "tail")
  return {
    ...state,
    bottom,
    pendingBottomDetails: state.pendingBottomDetails.concat(leftovers).slice(-maxPending),
    at
  }
}
