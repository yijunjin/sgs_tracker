import type {
  CardName,
  DeckCardEntry,
  DeckOrderPreviewConfig,
  DeckProfile,
  ParsedLogEvent,
  TrackerState
} from "@slt/shared"
import type { StatusState } from "./trackerStore"

/**
 * content script 的领域类型集中放在这里。
 *
 * 这个文件刻意只放“形状定义”，不放任何运行时逻辑：这样别的模块可以安全引用这些
 * 类型而不会把 content.ts 的全局状态、Vue 挂载、Chrome runtime 等副作用一起带进来。
 * 后续继续拆 protocol/text/snapshot 时，也应优先从这里取类型，避免每个文件重新声明一遍。
 */

// pageHook.js 发回来的最小事件单元。字段很多是可选的，因为不同来源只能提供部分信息：
// 文本 hook 主要提供 text/rawText/pos；协议 hook 主要提供 eventType/dataRaw；
// WebSocket 抓包主要提供 direction/wsUrl/payload。
export type HookRecord = {
  at: number
  kind: string
  text?: string
  rawText?: string
  eventType?: string
  dataSummary?: unknown
  dataRaw?: unknown
  direction?: string
  wsUrl?: string
  payload?: unknown
  frameUrl?: string
  pos?: unknown
  redacted?: boolean
  redactionReason?: string
  sampleReason?: string
}

// postMessage 的外层包。source 用来区分主 frame 和 iframe 转发，hookVersion 用于排查旧 hook 未刷新。
export type HookMessage = {
  source: "sgs-tracker-page-hook" | "sgs-tracker-frame-hook"
  hookVersion: string
  frameUrl?: string
  record: HookRecord
}

// UI 底部日志使用的轻量事件。真正会改变牌堆的事件放在 event 里，纯诊断/提示只展示 text。
export type DisplayEvent = {
  id: string
  at: number
  text: string
  type: "text" | "protocol" | "game-over" | "redacted"
  event?: ParsedLogEvent
}

// “精确已见牌”表示我们已经知道一张实体牌的名称、花色、点数、当前位置。
// 和 TrackerState 里的按名称计数不同，这里尽量追踪到“某一张实体牌”，用于：
// - 判断同名牌的不同花色/点数是否已见；
// - 敌方已知手牌列表；
// - 牌区动画高亮 pulseAt；
// - 洗牌/回收时把实体状态移动回牌堆。
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
  // 闪烁时间戳：精确到“这一张实体牌”。每个 seenExactCards 条目独立持有，
  // renderChips 把每个条目映射到唯一变体下标，故只有真正变动的那张会闪，
  // 不会出现 2v2 双牌堆同名同花同点一起闪/像被扣减的错觉。
  pulseAt?: number
}

export type ExactCardZone = ExactSeenCard["zone"]

export type DeckCardRow = {
  name: string
  count: number
  type?: DeckCardEntry["type"]
  description?: string
  variants: DeckCardEntry[]
}

export type DeckOrderPreviewExportCard = {
  cardId: number
  name?: string
  suit?: string
  rank?: string
}

// pageHook.js 会把 Laya 节点坐标换算到浏览器视口坐标。当前敌方手牌已并入面板展示，
// 坐标主要保留给 collector 诊断和后续如果恢复页面浮层时复用。
export type LayaPosition = {
  x: number
  y: number
  width: number
  height: number
  visible?: boolean
}

export type PlayerAnchor = {
  key: string
  label: string
  x: number
  y: number
  width: number
  height: number
  at: number
}

// 座位信息：来自协议 Players[]/ShowFigure。figure 为阵营编号（同 figure 即同队）。
export type SeatInfo = {
  seatId: number
  generalName?: string
  nickName?: string
  figure?: number
  isSelf?: boolean
}

export type SeatPlayerBinding = {
  key: string
  label: string
  at: number
  source: string
}

export type RecentHandProtocolMove = {
  at: number
  fromZone?: number
  toZone?: number
  moveType?: number
  spellId?: number
  cardCount?: number
  fromId?: number
  toId?: number
  srcSeatId?: number
  boundText?: boolean
}

// 缔盟等“整把手牌临时挪走再给别人”的技能，会导致已知手牌在短时间内换 owner。
// 这里先暂存来源玩家的已知手牌，等协议里的目标座位出现后再落到目标玩家。
export type PendingDimengHand = {
  ownerKey: string
  ownerLabel: string
  cards: Record<CardName, number>
  exactCards: ExactSeenCard[]
  at: number
}

export type DiagnosticHookRecord = Pick<
  HookRecord,
  | "at"
  | "kind"
  | "text"
  | "rawText"
  | "eventType"
  | "dataSummary"
  | "dataRaw"
  | "direction"
  | "wsUrl"
  | "payload"
  | "frameUrl"
  | "redacted"
  | "redactionReason"
  | "sampleReason"
  | "pos"
>

export type SupportedGameModeId = "sgs-happy-2v2" | "sgs-1v1"
export type TrackingPhase = "waiting" | "detecting-mode" | "in-game" | "ended"

// 牌堆顺序预览来源配置。当前只有观星使用它，但这里不出现“诸葛亮/观星”的业务判断；
// 具体协议区号、顶部顺序和 UI 文案由配置决定，后续别的武将复用同一状态机即可。
export type DeckOrderPreviewSource = {
  id: string
  label: string
  heading: string
  titlePrefix: string
  topTipLabel: string
  bottomTipLabel: string
  config: DeckOrderPreviewConfig
}

// 发给本机 collector 的诊断快照结构。collector 是可选辅助服务：
// 插件没有 collector 也能正常工作，有 collector 时可以保存原始 hook 记录便于复盘问题。
export type CollectorDiagnostics = {
  href: string
  title: string
  pageInstanceId: string
  contentVersion: string
  isTopFrame: boolean
  visibilityState: DocumentVisibilityState
  hasFocus: boolean
  lastRecordAgeMs: number | null
  collectorLastPostAt: string | null
  collectorPostAgeMs: number | null
  collectorSequence: number
  recentHookRecords: DiagnosticHookRecord[]
  recentRawHookRecords: DiagnosticHookRecord[]
  recentRawTextCount: number
  seenStageTextCount: number
  recentTextKeyCount: number
  exactSourceKeyCount: number
}

export type ExportPayload = {
  exportedAt: string
  source: "sgs-extension-hook"
  pageInstanceId: string
  sequence: number
  reason: string
  pageUrl: string
  trackingPhase: TrackingPhase
  hasInGameSignal: boolean
  gameModeId?: SupportedGameModeId
  gameModeLabel: string
  gameModeSource: string
  deckProfile: DeckProfile
  deckProfileSource: string
  drawPileRemaining?: number
  drawPileRemainingSource: string
  drawPileCalibrated: boolean
  midGameBaseline: boolean
  seatRegistry: SeatInfo[]
  selfSeatId?: number
  selfFigure?: number
  allyPlayerKeys: string[]
  playerAnchors: PlayerAnchor[]
  status: StatusState
  trackerState: TrackerState
  seenExactCards: ExactSeenCard[]
  exactCardStates: ExactSeenCard[]
  guanxing?: {
    top: number[]
    bottom: number[]
    topCards?: DeckOrderPreviewExportCard[]
    bottomCards?: DeckOrderPreviewExportCard[]
    peekCount: number
    at: number
  }
  recentEvents: DisplayEvent[]
  diagnostics: CollectorDiagnostics
}
