import { reactive } from "vue"
import type { DeckCardEntry, ParsedLogEvent, TrackerState } from "@slt/shared"

export type SupportedGameModeId = "sgs-happy-2v2" | "sgs-1v1"
export type TrackingPhase = "waiting" | "detecting-mode" | "in-game" | "ended"

export type ExactSeenCard = {
  id: string
  cardId?: number
  name: string
  suit?: string
  rank?: string
  zone: "player-visible" | "public" | "equip"
  owner?: string
  sourceText: string
  at: number
  pulseAt?: number
}

export type DisplayEvent = {
  id: string
  at: number
  text: string
  type: "text" | "protocol" | "game-over" | "redacted"
  event?: ParsedLogEvent
}

export type StatusState = {
  listening: boolean
  hookVersion: string
  lastRecordAt: number
  protocolCount: number
  textCount: number
  gameOverCount: number
  redactedCount: number
  reshuffleCount: number
  lastGameOverAt: number
}

export type TrackerUiState = {
  collapsed: boolean
  logCollapsed: boolean
  panelWidth: number
  openGroups: Record<string, boolean>
}

export type CardChipView = {
  key: string
  label: string
  title: string
  suitIconUrl: string
  suitSymbol: string
  state: "public" | "player-visible" | "equip" | "remaining"
  isRed: boolean
  pulsing: boolean
}

export type CardRowView = {
  name: string
  seen: number
  left: number
  exhausted: boolean
  chips: CardChipView[]
  overflowCount: number
}

export type CardGroupView = {
  type: NonNullable<DeckCardEntry["type"]>
  label: string
  cardCount: number
  remaining: number
  open: boolean
  rows: CardRowView[]
}

export type EnemyKnownCardView = {
  key: string
  nameLabel: string
  rankLabel: string
  title: string
  suitIconUrl: string
  suitSymbol: string
  isRed: boolean
  hasMeta: boolean
}

export type EnemyHandView = {
  key: string
  label: string
  count: number
  cards: EnemyKnownCardView[]
  moreCount: number
}

export type GuanxingView = {
  visible: boolean
  title: string
  topCount: number
  topTitle: string
  bottomCount: number
  bottomTitle: string
}

export type EventLogRowView = {
  id: string
  type: DisplayEvent["type"]
  time: string
  text: string
}

export type TrackerSnapshot = {
  contentVersion: string
  hookVersion: string
  trackingPhase: TrackingPhase
  hasInGameSignal: boolean
  gameModeId?: SupportedGameModeId
  gameModeLabel: string
  gameModeSource: string
  deckProfileSource: string
  connectionLabel: string
  connectionClass: "is-live" | "is-paused"
  phaseLabel: string
  baselineText: string
  versionLabel: string
  countTitle: string
  countText: string
  countTotal?: number
  countWaiting: boolean
  isDeckActive: boolean
  totalCards: number
  cycleRemainingTotal: number
  cycleSeenTotal: number
  drawPileRemainingLabel: string
  drawPileRemaining?: number
  drawPileCalibrated: boolean
  midGameBaseline: boolean
  status: StatusState
  groups: CardGroupView[]
  enemyHands: EnemyHandView[]
  guanxing: GuanxingView
  events: EventLogRowView[]
  waitingTitle: string
  waitingDetail: string
}

export type TrackerStore = {
  revision: number
  ui: TrackerUiState
  state: {
    trackingPhase: TrackingPhase
    hasInGameSignal: boolean
    gameModeId: SupportedGameModeId | undefined
    gameModeSource: string
    deckProfileSource: string
    drawPileRemaining: number | undefined
    drawPileRemainingSource: string
    drawPileCalibrated: boolean
    midGameBaseline: boolean
    status: StatusState
    trackerState: TrackerState | undefined
    seenExactCards: ExactSeenCard[]
    displayEvents: DisplayEvent[]
  }
  snapshot: TrackerSnapshot
}

const defaultStatus: StatusState = {
  listening: true,
  hookVersion: "",
  lastRecordAt: 0,
  protocolCount: 0,
  textCount: 0,
  gameOverCount: 0,
  redactedCount: 0,
  reshuffleCount: 0,
  lastGameOverAt: 0
}

export const trackerStore = reactive<TrackerStore>({
  revision: 0,
  ui: {
    collapsed: false,
    logCollapsed: false,
    panelWidth: 388,
    openGroups: {
      basic: true,
      trick: true,
      equip: true
    }
  },
  state: {
    trackingPhase: "waiting" as TrackingPhase,
    hasInGameSignal: false,
    gameModeId: undefined as SupportedGameModeId | undefined,
    gameModeSource: "等待页面模式信号",
    deckProfileSource: "等待识别",
    drawPileRemaining: undefined as number | undefined,
    drawPileRemainingSource: "",
    drawPileCalibrated: false,
    midGameBaseline: false,
    status: { ...defaultStatus },
    trackerState: undefined as TrackerState | undefined,
    seenExactCards: [] as ExactSeenCard[],
    displayEvents: [] as DisplayEvent[]
  },
  snapshot: {
    contentVersion: "",
    hookVersion: "",
    trackingPhase: "waiting",
    hasInGameSignal: false,
    gameModeLabel: "未识别",
    gameModeSource: "等待页面模式信号",
    deckProfileSource: "等待识别",
    connectionLabel: "监听中 · 等待开局",
    connectionClass: "is-paused",
    phaseLabel: "等待开局",
    baselineText: "从开局统计",
    versionLabel: "",
    countTitle: "等待页面模式信号",
    countText: "--",
    countWaiting: true,
    isDeckActive: false,
    totalCards: 0,
    cycleRemainingTotal: 0,
    cycleSeenTotal: 0,
    drawPileRemainingLabel: "待协议",
    drawPileCalibrated: false,
    midGameBaseline: false,
    status: { ...defaultStatus },
    groups: [],
    enemyHands: [],
    guanxing: {
      visible: false,
      title: "",
      topCount: 0,
      topTitle: "",
      bottomCount: 0,
      bottomTitle: ""
    },
    events: [],
    waitingTitle: "等待开局",
    waitingDetail: "监听页面中，识别到 2v2 或 1v1 后开始记牌"
  }
})

export const trackerActions = {
  collapse: () => {},
  expand: () => {},
  toggleListen: () => {},
  reset: () => {},
  exportJson: () => {},
  toggleLog: () => {},
  toggleGroup: (_group: string) => {},
  setMode: (_mode: SupportedGameModeId) => {},
  setPanelWidth: (_width: number, _persist = false) => {}
}

export function replaceTrackerSnapshot(snapshot: TrackerSnapshot): void {
  trackerStore.snapshot = snapshot
  trackerStore.revision += 1
}
