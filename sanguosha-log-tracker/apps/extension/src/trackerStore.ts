import { reactive } from "vue"
import type { DeckCardEntry, ParsedLogEvent, RuleDefinition, TrackerState } from "@slt/shared"

/**
 * 插件 UI 的共享 store。
 *
 * 设计上分三层：
 * - state：content.ts 的业务运行时状态镜像，保留给规则面板/调试读取。
 * - snapshot：Vue 面板真正渲染的数据模型，已经被 content.ts 整理成“直接显示”的结构。
 * - ui：纯 UI 偏好，例如面板宽度、折叠状态、分组展开状态。
 *
 * 这样组件不用理解协议、文本解析、牌堆校准等复杂业务，只负责展示 snapshot 和触发 actions。
 */

export type SupportedGameModeId = "sgs-happy-2v2" | "sgs-1v1"
export type TrackingPhase = "waiting" | "detecting-mode" | "in-game" | "ended"

// 与 content.ts 内部 ExactSeenCard 同构。这里导出是为了让 UI ViewModel 类型能描述
// “一张实体牌当前在哪个区、归谁、是否需要闪烁”。
export type ExactSeenCard = {
  id: string
  cardId?: number
  name: string
  suit?: string
  rank?: string
  zone: "player-visible" | "public" | "equip" | "judge-area" | "skill-pile"
  owner?: string
  sourceText: string
  at: number
  pulseAt?: number
}

// 底部事件日志。event 是 parser 产出的结构化结果；没有 event 时仅作为提示/诊断文本。
export type DisplayEvent = {
  id: string
  at: number
  text: string
  type: "text" | "protocol" | "game-over" | "redacted"
  event?: ParsedLogEvent
}

// 采集链路状态计数，主要显示在 UI 和导出诊断里。
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

// 这些字段不影响记牌业务，只影响面板如何展开、收起、调整宽度。
export type TrackerUiState = {
  collapsed: boolean
  ruleConfigOpen: boolean
  logCollapsed: boolean
  panelWidth: number
  openGroups: Record<string, boolean>
}

// 规则面板的状态。系统规则只读，自定义规则会持久化到 localStorage。
export type RuleConfigState = {
  systemRules: RuleDefinition[]
  customRules: RuleDefinition[]
  lastError: string
  lastSavedAt: number
}

// 以下 *View 类型是“给 Vue 直接渲染”的数据，不再包含复杂业务判断。
// 例如 CardChipView.state 已经把 public/player-visible/equip 等区域算好，
// 组件只需要按 state 选择 class。
export type CardChipView = {
  key: string
  label: string
  title: string
  suitIconUrl: string
  suitSymbol: string
  state: "public" | "player-visible" | "equip" | "judge-area" | "skill-pile" | "remaining"
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

export type DeckOrderPreviewView = {
  visible: boolean
  heading: string
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
  deckOrderPreview: DeckOrderPreviewView
  events: EventLogRowView[]
  waitingTitle: string
  waitingDetail: string
}

// trackerStore 是唯一 reactive 根对象。content.ts 会更新它，Vue 组件只读取它。
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
    ruleConfig: RuleConfigState
  }
  snapshot: TrackerSnapshot
}

// 默认状态要保持轻量、无业务副作用；真正开局后的 TrackerState 由 content.ts 创建。
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

// 初始 snapshot 让面板在还没收到任何 pageHook 消息时也能正常渲染“等待开局”界面。
export const trackerStore = reactive<TrackerStore>({
  revision: 0,
  ui: {
    collapsed: false,
    ruleConfigOpen: false,
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
    displayEvents: [] as DisplayEvent[],
    ruleConfig: {
      systemRules: [] as RuleDefinition[],
      customRules: [] as RuleDefinition[],
      lastError: "",
      lastSavedAt: 0
    }
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
    deckOrderPreview: {
      visible: false,
      heading: "",
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

// actions 先放空函数，是为了让组件在 content.ts 绑定真实实现之前也不会报错。
// bootstrap() 中的 bindTrackerActions() 会把这些占位函数替换成真正的业务动作。
export const trackerActions = {
  collapse: () => {},
  expand: () => {},
  toggleListen: () => {},
  reset: () => {},
  exportJson: () => {},
  openRuleConfig: () => {},
  closeRuleConfig: () => {},
  saveCustomRule: (_rule: RuleDefinition) => false,
  toggleCustomRule: (_ruleId: string, _enabled: boolean) => {},
  removeCustomRule: (_ruleId: string) => {},
  toggleLog: () => {},
  toggleGroup: (_group: string) => {},
  setMode: (_mode: SupportedGameModeId) => {},
  setPanelWidth: (_width: number, _persist = false) => {}
}

// content.ts 每次构造完新 snapshot 后调用这里。
// revision 专门给需要监听“快照已替换”的逻辑使用，例如 App.vue 自动滚动日志到底部。
export function replaceTrackerSnapshot(snapshot: TrackerSnapshot): void {
  trackerStore.snapshot = snapshot
  trackerStore.revision += 1
}
