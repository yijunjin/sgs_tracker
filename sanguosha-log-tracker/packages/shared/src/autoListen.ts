import { isCardInDeck } from "./cards"
import { parseLogInput } from "./parser"
import { createGameStartSignature, detectGameStartSignal, type GameStartSignal } from "./startSignal"
import type { DeckProfile, OcrLine, ParsedLogEvent } from "./types"

export type AutoListenMode =
  | "idle"
  | "armed"
  | "gameStarting"
  | "inGame"
  | "paused"
  | "error"

export type AutoListenConfig = {
  enabled: boolean
  autoStartOnChooseGeneral: boolean
  autoResetOnNewGame: boolean
  autoAcceptStrictEvents: boolean
  requireConfirmReshuffle: boolean

  captureIntervalMs: number
  minOcrIntervalMs: number
  stableDelayMs: number

  startSignalMinChooseLines: number
}

export const defaultAutoListenConfig: AutoListenConfig = {
  enabled: true,
  autoStartOnChooseGeneral: true,
  autoResetOnNewGame: true,
  autoAcceptStrictEvents: true,
  requireConfirmReshuffle: true,
  captureIntervalMs: 300,
  minOcrIntervalMs: 1200,
  stableDelayMs: 400,
  startSignalMinChooseLines: 1
}

export type AutoListenStartMode = "newGame" | "midGame"
export type AutoListenBaselineStatus = "idle" | "priming" | "complete"

export type AutoGameSessionState = {
  mode: AutoListenMode
  currentGameStartSignature?: string | undefined
  lastGameStartDetectedAt?: number | undefined
  hasEnteredInGame: boolean
  startMode?: AutoListenStartMode | undefined
  baselineStatus: AutoListenBaselineStatus
  lastStartSignal?: GameStartSignal | undefined
  lastChooseLineCount: number
}

export type AutoListenBatchResult = {
  nextState: AutoGameSessionState
  signal?: GameStartSignal | undefined
  resetTracker: boolean
  events: ParsedLogEvent[]
  autoAcceptedEventIds: string[]
  primedLineCount: number
}

const GAME_START_COOLDOWN_MS = 30_000

export function createAutoGameSessionState(): AutoGameSessionState {
  return {
    mode: "idle",
    hasEnteredInGame: false,
    baselineStatus: "idle",
    lastChooseLineCount: 0
  }
}

export function enterGuardMode(state: AutoGameSessionState): AutoGameSessionState {
  return {
    ...state,
    mode: "armed",
    startMode: undefined,
    baselineStatus: "idle"
  }
}

export function enterMidGameMode(state: AutoGameSessionState): AutoGameSessionState {
  return {
    ...state,
    mode: "inGame",
    hasEnteredInGame: true,
    startMode: "midGame",
    baselineStatus: "priming"
  }
}

export function enterPausedMode(state: AutoGameSessionState): AutoGameSessionState {
  return {
    ...state,
    mode: "paused"
  }
}

export function enterIdleMode(state: AutoGameSessionState): AutoGameSessionState {
  return {
    ...state,
    mode: "idle"
  }
}

export function enterErrorMode(state: AutoGameSessionState): AutoGameSessionState {
  return {
    ...state,
    mode: "error"
  }
}

export function shouldAutoAcceptEvent(event: ParsedLogEvent, deckProfile: DeckProfile): boolean {
  return (
    event.status === "pending" &&
    event.quality === "strict" &&
    event.autoAcceptable === true &&
    Boolean(event.cardName) &&
    Boolean(event.cardName && isCardInDeck(deckProfile, event.cardName)) &&
    event.action !== "ignore" &&
    event.action !== "unknown" &&
    event.duplicate !== true &&
    event.supportStatus !== "unsupported"
  )
}

function autoAcceptEvents(
  events: ParsedLogEvent[],
  deckProfile: DeckProfile,
  enabled: boolean
): { events: ParsedLogEvent[]; autoAcceptedEventIds: string[] } {
  if (!enabled) {
    return {
      events,
      autoAcceptedEventIds: []
    }
  }

  const autoAcceptedEventIds: string[] = []
  const nextEvents = events.map((event) => {
    if (!shouldAutoAcceptEvent(event, deckProfile)) {
      return event
    }

    autoAcceptedEventIds.push(event.id)
    return {
      ...event,
      status: "accepted"
    } satisfies ParsedLogEvent
  })

  return {
    events: nextEvents,
    autoAcceptedEventIds
  }
}

function shouldStartNewGame(
  state: AutoGameSessionState,
  signal: GameStartSignal,
  now: number,
  force = false
): boolean {
  if (force) {
    return true
  }

  if (state.mode === "inGame") {
    return false
  }

  const signature = createGameStartSignature(signal)
  if (state.currentGameStartSignature === signature && state.hasEnteredInGame) {
    return false
  }

  if (state.lastGameStartDetectedAt !== undefined && now - state.lastGameStartDetectedAt < GAME_START_COOLDOWN_MS) {
    return false
  }

  return true
}

export function processAutoListenBatch(args: {
  state: AutoGameSessionState
  lines: OcrLine[]
  deckProfile: DeckProfile
  config?: Partial<AutoListenConfig>
  source?: ParsedLogEvent["source"]
  now?: number
  forceStartNewGame?: boolean
}): AutoListenBatchResult {
  const config = { ...defaultAutoListenConfig, ...args.config }
  const source = args.source ?? "ocr"
  const now = args.now ?? Date.now()
  const signal = detectGameStartSignal(args.lines, config.startSignalMinChooseLines)
  const nextState: AutoGameSessionState = {
    ...args.state,
    lastStartSignal: signal,
    lastChooseLineCount: signal?.chooseLines.length ?? 0
  }

  if (!config.enabled || nextState.mode === "idle" || nextState.mode === "paused" || nextState.mode === "error") {
    return {
      nextState,
      signal,
      resetTracker: false,
      events: [],
      autoAcceptedEventIds: [],
      primedLineCount: 0
    }
  }

  if (nextState.mode === "armed") {
    if (!signal || !config.autoStartOnChooseGeneral || !config.autoResetOnNewGame || !shouldStartNewGame(nextState, signal, now, args.forceStartNewGame)) {
      return {
        nextState,
        signal,
        resetTracker: false,
        events: [],
        autoAcceptedEventIds: [],
        primedLineCount: 0
      }
    }

    const lastChooseIndex = Math.max(...signal.chooseLineIndexes)
    const parsedEvents = parseLogInput(args.lines.slice(lastChooseIndex + 1), source, args.deckProfile)
    const { events, autoAcceptedEventIds } = autoAcceptEvents(parsedEvents, args.deckProfile, config.autoAcceptStrictEvents)

    return {
      nextState: {
        ...nextState,
        mode: "inGame",
        currentGameStartSignature: createGameStartSignature(signal),
        lastGameStartDetectedAt: now,
        hasEnteredInGame: true,
        startMode: "newGame",
        baselineStatus: "complete"
      },
      signal,
      resetTracker: true,
      events,
      autoAcceptedEventIds,
      primedLineCount: 0
    }
  }

  if (nextState.mode === "inGame" && nextState.startMode === "midGame" && nextState.baselineStatus !== "complete") {
    return {
      nextState: {
        ...nextState,
        baselineStatus: "complete"
      },
      signal,
      resetTracker: false,
      events: [],
      autoAcceptedEventIds: [],
      primedLineCount: args.lines.length
    }
  }

  const parsedEvents = parseLogInput(args.lines, source, args.deckProfile)
  const { events, autoAcceptedEventIds } = autoAcceptEvents(parsedEvents, args.deckProfile, config.autoAcceptStrictEvents)

  return {
    nextState: {
      ...nextState,
      mode: "inGame",
      hasEnteredInGame: true,
      baselineStatus: nextState.baselineStatus === "idle" ? "complete" : nextState.baselineStatus
    },
    signal,
    resetTracker: false,
    events,
    autoAcceptedEventIds,
    primedLineCount: 0
  }
}