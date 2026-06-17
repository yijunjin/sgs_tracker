import {
  applyEvent,
  applyDeckPileMove,
  createInitialTrackerState,
  deckMoveCount,
  defaultDeckProfile,
  deckProfiles,
  getDeckTotalCount,
  parseLogInput,
  canonicalPlayerKey,
  isAllyDrawText,
  allyDrawActor as sharedAllyDrawActor,
  allyGeneralNames,
  normalizeText,
  type CardName,
  type DeckCardEntry,
  type DeckPileState,
  type ParsedLogEvent,
  type SeatRosterEntry,
  type TrackerState
} from "@slt/shared"

type HookRecord = {
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

type HookMessage = {
  source: "sgs-tracker-page-hook" | "sgs-tracker-frame-hook"
  hookVersion: string
  frameUrl?: string
  record: HookRecord
}

type DisplayEvent = {
  id: string
  at: number
  text: string
  type: "text" | "protocol" | "game-over" | "redacted"
  event?: ParsedLogEvent
}

type ExactSeenCard = {
  id: string
  cardId?: number
  name: string
  suit?: string
  rank?: string
  zone: "player-visible" | "public" | "equip"
  owner?: string
  sourceText: string
  at: number
  // 闪烁时间戳：精确到“这一张实体牌”。每个 seenExactCards 条目独立持有，
  // renderChips 把每个条目映射到唯一变体下标，故只有真正变动的那张会闪，
  // 不会出现 2v2 双牌堆同名同花同点一起闪/像被扣减的错觉。
  pulseAt?: number
}

type DeckCardRow = {
  name: string
  count: number
  type?: DeckCardEntry["type"]
  description?: string
  variants: DeckCardEntry[]
}

type GuanxingCardDetail = Pick<DeckCardEntry, "name" | "rank" | "suit" | "description">

type GuanxingCard = {
  cardId: number
  detail?: GuanxingCardDetail
}

type GuanxingExportCard = {
  cardId: number
  name?: string
  suit?: string
  rank?: string
}

type LayaPosition = {
  x: number
  y: number
  width: number
  height: number
  visible?: boolean
}

type PlayerAnchor = {
  key: string
  label: string
  x: number
  y: number
  width: number
  height: number
  at: number
}

// 座位信息：来自协议 Players[]/ShowFigure。figure 为阵营编号（同 figure 即同队）。
type SeatInfo = {
  seatId: number
  generalName?: string
  nickName?: string
  figure?: number
  isSelf?: boolean
}

type DiagnosticHookRecord = Pick<
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

type SupportedGameModeId = "sgs-happy-2v2" | "sgs-1v1"
type TrackingPhase = "waiting" | "detecting-mode" | "in-game" | "ended"

type CollectorDiagnostics = {
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

const ROOT_ID = "sgs-card-tracker-root"
const HAND_OVERLAY_ROOT_ID = "sgs-known-hand-overlay-root"
const HOOK_SCRIPT_ID = "sgs-card-tracker-page-hook"
const CONTENT_VERSION = "extension-content-v34-reshuffle-keep-enemy"
const CONTENT_BOOT_KEY = "__SGS_TRACKER_CONTENT_VERSION__"
const PANEL_WIDTH_STORAGE_KEY = "sgs-tracker-panel-width"
const LOG_COLLAPSED_STORAGE_KEY = "sgs-tracker-log-collapsed"
const COLLECTOR_URL = "http://127.0.0.1:18765/snapshot"
const MIN_PANEL_WIDTH = 340
const MAX_PANEL_WIDTH = 760
const IS_TOP_FRAME = isTopFrame()
const PAGE_INSTANCE_ID = createPageInstanceId()

let deckProfile = defaultDeckProfile
let deckProfileSource = "等待识别"
let trackerState: TrackerState = createInitialTrackerState(deckProfile)
let gameModeId: SupportedGameModeId | undefined
let gameModeSource = "等待页面模式信号"
let manualModeLocked = false
let protocolModeLocked = false
let trackingPhase: TrackingPhase = "waiting"
let hasInGameSignal = false
let drawPileRemaining: number | undefined
let drawPileRemainingSource = ""
// 牌堆剩余是否已“校准”：只有从开局牌表(seedProtocolDeck)起算、或经一次洗牌锚点重置后才为 true。
// 中途接入旁观（未收到开局 52 张牌表）时为 false，此时累加值仅供参考、不可信，UI 标注“未校准”。
let drawPileCalibrated = false
let midGameBaseline = false
let collapsed = false
let logCollapsed = loadBoolean(LOG_COLLAPSED_STORAGE_KEY, false)
let panelWidth = loadNumber(PANEL_WIDTH_STORAGE_KEY, 388)
let renderQueued = false
let collectorQueued = false
let lastCollectorPostAt = 0
let collectorSequence = 0
let heartbeatTimer = 0
let lastRenderStateSignature = ""
let handOverlayQueued = false
let lastHandOverlayRenderAt = 0

let openGroups: Record<string, boolean> = {
  basic: true,
  trick: true,
  equip: true
}

const status = {
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

let extensionContextValid = true

const displayEvents: DisplayEvent[] = []
const seenExactCards: ExactSeenCard[] = []
const recentHookRecords: DiagnosticHookRecord[] = []
const recentRawHookRecords: DiagnosticHookRecord[] = []
const recentRawTexts: string[] = []
const seenStageTexts = new Set<string>()
const recentTextTimes = new Map<string, number>()
const exactSourceKeys = new Set<string>()
const playerLabelsByKey = new Map<string, string>()
const playerAnchorsByKey = new Map<string, PlayerAnchor>()
// 座位↔武将↔阵营注册表。来源：GAME_OVER/MsgGameOver 的 Players[]（SeatID+generalNames+Figure，
// SelfResult.SeatID 标识“您”）、MsgGameShowFigure（局中较早的 SeatID+Figure）。
// Figure 即阵营编号：同 Figure = 同队。
const seatRegistry = new Map<number, SeatInfo>()
let selfSeatId: number | undefined
let selfFigure: number | undefined
// 已确认“我方阵营”（含自己+队友）的玩家 key。队友判定的稳健来源：2v2 日志里凡“带花色的摸牌”，
// 其玩家必是我方（敌方摸牌不下发牌面，服务端反作弊），据此即可解禁，无需依赖座位映射。
const allyPlayerKeys = new Set<string>(["__self__"])
const rawCollectorBuffer: DiagnosticHookRecord[] = []
const protocolCardEntriesById = new Map<number, DeckCardEntry>()
const protocolCardZonesById = new Map<number, number>()
const recentProtocolMoveTimes = new Map<string, number>()
let rawCollectorQueued = false
let lastProtocolDeckSignature = ""

// 观星控底追踪（协议驱动，零猜测）：
//   观星开始：FromZone 1 → ToZone 8 (MoveType 6)，取走牌堆顶 N 张到观星暂存区。
//   摆回牌堆：FromZone 8 → ToZone 1 (MoveType 7)，ToPosition 65280(0xFF00)=顶部、0/缺失=底部。
// 真机抓包验证：摆到顶部组的 cardId 会被随后的摸牌(1→其它)按序摸走，故 guanxingTop 头部 = 下一张待摸。
// guanxingBottom 垫在牌堆最底，本轮一般摸不到（除非洗牌前摸空），仅作信息展示。
const GUANXING_ZONE = 8
const GUANXING_TOP_POSITION = 65280
let guanxingTop: GuanxingCard[] = []
let guanxingBottom: GuanxingCard[] = []
let pendingGuanxingTopDetails: GuanxingCardDetail[] = []
let pendingGuanxingBottomDetails: GuanxingCardDetail[] = []
let guanxingPeekCount = 0
let guanxingAt = 0

type ExportPayload = {
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
  deckProfile: typeof deckProfile
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
  status: typeof status
  trackerState: TrackerState
  seenExactCards: ExactSeenCard[]
  exactCardStates: ExactSeenCard[]
  guanxing?: {
    top: number[]
    bottom: number[]
    topCards?: GuanxingExportCard[]
    bottomCards?: GuanxingExportCard[]
    peekCount: number
    at: number
  }
  recentEvents: DisplayEvent[]
  diagnostics: CollectorDiagnostics
}

function isTopFrame(): boolean {
  try {
    return window.self === window.top
  } catch {
    return false
  }
}

function createPageInstanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const cardDisplayOrder = new Map<string, number>(
  [
    "杀",
    "雷杀",
    "火杀",
    "闪",
    "桃",
    "酒",
    "无懈可击",
    "过河拆桥",
    "顺手牵羊",
    "无中生有",
    "乐不思蜀",
    "南蛮入侵",
    "万箭齐发",
    "借刀杀人",
    "五谷丰登",
    "桃园结义",
    "闪电",
    "铁索连环",
    "兵粮寸断",
    "决斗",
    "火攻",
    "诸葛连弩",
    "雌雄双股剑",
    "青釭剑",
    "青龙偃月刀",
    "丈八蛇矛",
    "贯石斧",
    "麒麟弓",
    "古锭刀",
    "朱雀羽扇",
    "方天画戟",
    "寒冰剑",
    "八卦阵",
    "仁王盾",
    "藤甲",
    "白银狮子",
    "赤兔",
    "紫骍",
    "大宛",
    "绝影",
    "的卢",
    "爪黄飞电",
    "骅骝"
  ].map((name, index) => [name, index])
)

const exactCardAliases: Record<string, string> = {
  借刀: "借刀杀人",
  无懈: "无懈可击",
  过河: "过河拆桥",
  顺手: "顺手牵羊",
  五谷: "五谷丰登",
  桃园: "桃园结义",
  铁索: "铁索连环",
  兵粮: "兵粮寸断",
  南蛮: "南蛮入侵",
  万箭: "万箭齐发",
  无中: "无中生有",
  连弩: "诸葛连弩"
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function loadNumber(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key)
  const value = raw ? Number(raw) : Number.NaN
  return Number.isFinite(value) ? clamp(value, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH) : fallback
}

function loadBoolean(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(key)
  return raw === null ? fallback : raw === "true"
}

function runtimeUrl(path: string): string {
  if (!extensionContextValid) {
    return ""
  }
  try {
    return (globalThis as { chrome?: { runtime?: { getURL(path: string): string } } }).chrome?.runtime?.getURL(path) ?? ""
  } catch {
    extensionContextValid = false
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer)
      heartbeatTimer = 0
    }
    return ""
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function cardShortName(name: string): string {
  const map: Record<string, string> = {
    杀: "杀",
    雷杀: "雷",
    火杀: "火",
    闪: "闪",
    桃: "桃",
    酒: "酒",
    无懈可击: "无",
    过河拆桥: "拆",
    顺手牵羊: "顺",
    无中生有: "中",
    乐不思蜀: "乐",
    兵粮寸断: "粮",
    南蛮入侵: "蛮",
    万箭齐发: "箭",
    桃园结义: "园",
    铁索连环: "索",
    借刀杀人: "借",
    五谷丰登: "谷",
    闪电: "电"
  }
  return map[name] ?? name.slice(0, 2)
}

function handCardNameLabel(name: string): string {
  const map: Record<string, string> = {
    无懈可击: "无懈",
    过河拆桥: "过拆",
    顺手牵羊: "顺手",
    无中生有: "无中",
    乐不思蜀: "乐不",
    兵粮寸断: "兵粮",
    南蛮入侵: "南蛮",
    万箭齐发: "万箭",
    桃园结义: "桃园",
    铁索连环: "铁索",
    借刀杀人: "借刀",
    五谷丰登: "五谷",
    木牛流马: "木牛",
    闪电: "闪电"
  }
  return map[name] ?? (name.length <= 2 ? name : name.slice(0, 2))
}

function suitSymbol(suit: string | undefined): string {
  const map: Record<string, string> = {
    heart: "♥",
    diamond: "♦",
    club: "♣",
    spade: "♠",
    红桃: "♥",
    方片: "♦",
    方块: "♦",
    梅花: "♣",
    黑桃: "♠"
  }
  return suit ? map[suit] ?? suit : ""
}

function normalizeSuitSymbol(value: string | undefined): string | undefined {
  const map: Record<string, string> = {
    "♥": "红桃",
    "♦": "方片",
    "♣": "梅花",
    "♠": "黑桃"
  }
  return value ? map[value] ?? value : undefined
}

function suitAssetUrl(suit: string | undefined): string {
  const map: Record<string, string> = {
    heart: "hongxin.png",
    diamond: "fangpian.png",
    club: "meihua.png",
    spade: "kuihua.png",
    红桃: "hongxin.png",
    方片: "fangpian.png",
    方块: "fangpian.png",
    梅花: "meihua.png",
    黑桃: "kuihua.png"
  }
  const fileName = suit ? map[suit] : undefined
  return fileName ? runtimeUrl(`assets/${fileName}`) : ""
}

function isRedSuit(suit: string | undefined): boolean {
  return Boolean(suit && /heart|diamond|红桃|方片|方块/.test(suit))
}

function cardChipLabel(card: DeckCardEntry): string {
  if (card.rank || card.suit) {
    return `${card.rank ?? ""}${suitSymbol(card.suit)}`
  }
  return cardShortName(card.name)
}

function renderSuitIcon(suit: string | undefined): string {
  const url = suitAssetUrl(suit)
  if (!url) {
    return suit ? `<span class="sgs-suit-symbol">${escapeHtml(suitSymbol(suit))}</span>` : ""
  }
  return `<img class="sgs-suit-icon" src="${escapeHtml(url)}" alt="${escapeHtml(suitSymbol(suit))}" />`
}

function cardFullLabel(card: Pick<DeckCardEntry, "name" | "rank" | "suit">): string {
  const suit = suitSymbol(card.suit)
  const rank = card.rank ?? ""
  return `${card.name}${suit || rank ? ` ${suit}${rank}` : ""}`
}

function cardTooltip(card: Pick<DeckCardEntry, "name" | "rank" | "suit" | "description">, state: "公开区" | "玩家已见" | "未见"): string {
  return [cardFullLabel(card), state, card.description].filter(Boolean).join("\n")
}

function cardDescription(name: string): string | undefined {
  return deckProfile.cards.find((card) => card.name === name)?.description
}

function guanxingCardFromId(cardId: number): GuanxingCard {
  return { cardId }
}

function guanxingExportCard(card: GuanxingCard): GuanxingExportCard {
  return {
    cardId: card.cardId,
    ...(card.detail?.name ? { name: card.detail.name } : {}),
    ...(card.detail?.suit ? { suit: card.detail.suit } : {}),
    ...(card.detail?.rank ? { rank: card.detail.rank } : {})
  }
}

function guanxingCardLabel(card: GuanxingCard): string {
  if (card.detail) {
    return cardFullLabel(card.detail)
  }
  return card.cardId > 0 ? `牌面未捕获 #${card.cardId}` : "牌面未捕获"
}

function guanxingCardsTip(label: string, cards: GuanxingCard[], hint: string): string {
  const rows = cards.map((card, index) => `${index + 1}. ${guanxingCardLabel(card)}`)
  return [label, hint, ...rows].filter(Boolean).join("\n")
}

function fillGuanxingDetails(queue: GuanxingCard[], details: GuanxingCardDetail[], edge: "head" | "tail"): GuanxingCardDetail[] {
  if (!details.length) {
    return []
  }
  const indices = queue
    .map((card, index) => (card.detail ? -1 : index))
    .filter((index) => index >= 0)
  const targetIndices = edge === "head" ? indices.slice(0, details.length) : indices.slice(Math.max(0, indices.length - details.length))
  targetIndices.forEach((queueIndex, detailIndex) => {
    const card = queue[queueIndex]
    const detail = details[detailIndex]
    if (card && detail) {
      card.detail = detail
    }
  })
  return details.slice(targetIndices.length)
}

function attachDetailsToGuanxingCards(cards: GuanxingCard[], pendingDetails: GuanxingCardDetail[]): GuanxingCard[] {
  pendingDetails.forEach((detail, index) => {
    const card = cards[index]
    if (card) {
      card.detail = detail
    }
  })
  return cards
}

function stripGuanxingPlacementPrefix(content: string): string {
  return content
    .replace(/^\s*(?:[一二三四五六七八九十两\d]+)张(?:卡牌|牌)?/u, "")
    .replace(/^\s*卡牌/u, "")
    .trim()
}

function guanxingCardDetailsFromContent(content: string): GuanxingCardDetail[] {
  const normalizedContent = normalizeText(stripGuanxingPlacementPrefix(content))
  if (!normalizedContent) {
    return []
  }
  const aliases = exactCardNamesByLength()
  if (!aliases.length) {
    return []
  }
  const aliasMap = new Map(aliases.map((item) => [item.alias, item.canonical]))
  const namePattern = aliases.map((item) => item.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  const pattern = new RegExp(`(${namePattern})([♠♥♣♦])?(A|10|[2-9JQK])?`, "gu")
  const details: GuanxingCardDetail[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(normalizedContent))) {
    const name = aliasMap.get(match[1] ?? "") ?? match[1]
    if (!name) {
      continue
    }
    const suit = normalizeSuitSymbol(match[2])
    const rank = match[3]
    const description = cardDescription(name)
    details.push({
      name,
      ...(suit ? { suit } : {}),
      ...(rank ? { rank } : {}),
      ...(description ? { description } : {})
    })
  }
  return details
}

function ingestGuanxingPlacementText(text: string, at: number): boolean {
  if (!/置于牌堆[顶底]/u.test(text)) {
    return false
  }
  let changed = false
  const pattern = /置于牌堆([顶底])/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const prefix = text.slice(0, match.index)
    const lastJiangIndex = prefix.lastIndexOf("将")
    const rawContent = lastJiangIndex >= 0 ? prefix.slice(lastJiangIndex + 1) : (prefix.split(/[，,。；;]/u).pop() ?? "")
    const details = guanxingCardDetailsFromContent(rawContent)
    if (!details.length) {
      continue
    }
    const isTop = match[1] === "顶"
    const displayOrderDetails = isTop ? [...details].reverse() : details
    if (isTop) {
      const leftovers = fillGuanxingDetails(guanxingTop, displayOrderDetails, "head")
      pendingGuanxingTopDetails = leftovers.concat(pendingGuanxingTopDetails).slice(0, Math.max(8, guanxingPeekCount))
    } else {
      const leftovers = fillGuanxingDetails(guanxingBottom, displayOrderDetails, "tail")
      pendingGuanxingBottomDetails = pendingGuanxingBottomDetails.concat(leftovers).slice(-Math.max(8, guanxingPeekCount))
    }
    guanxingAt = at
    changed = true
  }
  return changed
}

function totalCards(): number {
  return getDeckTotalCount(deckProfile)
}

function deckProfileById(id: SupportedGameModeId): typeof deckProfile | undefined {
  return deckProfiles.find((profile) => profile.id === id)
}

function supportedModeLabel(id: SupportedGameModeId | undefined): string {
  if (id === "sgs-1v1") {
    return "1v1"
  }
  if (id === "sgs-happy-2v2") {
    return "欢乐 2v2"
  }
  return "未识别"
}

function isGameModeReady(): boolean {
  return Boolean(gameModeId)
}

function isDeckActive(): boolean {
  return Boolean(gameModeId && (trackingPhase === "in-game" || trackingPhase === "ended"))
}

function resetRuntimeStateForProfile(): void {
  trackerState = createInitialTrackerState(deckProfile)
  drawPileRemaining = undefined
  drawPileCalibrated = false
  seenExactCards.length = 0
  displayEvents.length = 0
  exactSourceKeys.clear()
  playerLabelsByKey.clear()
  playerAnchorsByKey.clear()
  resetSeatRegistry()
  resetProtocolCardState()
  resetGuanxingState()
}

function resetRoundCounters(): void {
  status.textCount = 0
  status.protocolCount = 0
  status.gameOverCount = 0
  status.redactedCount = 0
  status.reshuffleCount = 0
  status.lastGameOverAt = 0
}

function resetRoundStateForNewGame(at: number, source: string, options: { clearProtocolDeck?: boolean } = {}): void {
  trackerState = createInitialTrackerState(deckProfile)
  drawPileRemaining = undefined
  drawPileRemainingSource = ""
  drawPileCalibrated = false
  midGameBaseline = true
  displayEvents.length = 0
  seenExactCards.length = 0
  exactSourceKeys.clear()
  protocolCardZonesById.clear()
  recentProtocolMoveTimes.clear()
  resetGuanxingState()
  if (options.clearProtocolDeck) {
    resetProtocolCardState()
  }
  seenStageTexts.clear()
  recentTextTimes.clear()
  playerLabelsByKey.clear()
  playerAnchorsByKey.clear()
  resetRoundCounters()
  status.listening = true
  hasInGameSignal = true
  trackingPhase = "in-game"
  pushDisplayEvent({
    at,
    type: "protocol",
    text: `${source}，本局状态已重置`
  })
  queueKnownHandOverlayRender(true)
}

function resetProtocolCardState(): void {
  protocolCardEntriesById.clear()
  protocolCardZonesById.clear()
  recentProtocolMoveTimes.clear()
  lastProtocolDeckSignature = ""
}

function resetGuanxingState(): void {
  guanxingTop = []
  guanxingBottom = []
  pendingGuanxingTopDetails = []
  pendingGuanxingBottomDetails = []
  guanxingPeekCount = 0
  guanxingAt = 0
}

function setGameMode(id: SupportedGameModeId, source: string): boolean {
  const nextProfile = deckProfileById(id)
  if (!nextProfile) {
    return false
  }
  const fromProtocol = source.includes("协议")
  if (fromProtocol) {
    protocolModeLocked = true
    manualModeLocked = false
  }
  const changed = gameModeId !== id || deckProfile.id !== nextProfile.id
  gameModeId = id
  gameModeSource = source
  trackingPhase = status.gameOverCount > 0 ? "ended" : hasInGameSignal ? "in-game" : "waiting"
  deckProfile = nextProfile
  deckProfileSource = source
  if (changed) {
    resetRuntimeStateForProfile()
  }
  return changed
}

function detectGameModeIdFromText(text: string): SupportedGameModeId | undefined {
  const normalized = text.replace(/\s+/g, "").toLowerCase()
  if (/1v1|新1v1|一对一|一战到底/.test(normalized)) {
    return "sgs-1v1"
  }
  if (/2v2|二对二|欢乐成双|欢乐军争|欢乐2v2|欢乐/.test(normalized)) {
    return "sgs-happy-2v2"
  }
  return undefined
}

function detectGameModeIdFromRecord(record: HookRecord): SupportedGameModeId | undefined {
  if (record.text) {
    const textMode = detectGameModeIdFromText(record.text)
    if (textMode) {
      return textMode
    }
  }
  if (record.dataSummary !== undefined) {
    try {
      return detectGameModeIdFromText(JSON.stringify(record.dataSummary))
    } catch {
      return undefined
    }
  }
  return undefined
}

function updateGameModeFromRecord(record: HookRecord): boolean {
  if ((manualModeLocked || protocolModeLocked) && gameModeId) {
    return false
  }
  const mode = detectGameModeIdFromRecord(record)
  return mode ? setGameMode(mode, `页面识别 · ${formatClock(record.at)}`) : false
}

function markInGameSignal(record: HookRecord): boolean {
  if (!looksLikeInGameStart(record)) {
    return false
  }
  hasInGameSignal = true
  if (gameModeId) {
    if (trackingPhase !== "in-game") {
      trackingPhase = "in-game"
      return true
    }
    return false
  }
  if (trackingPhase === "waiting") {
    trackingPhase = "detecting-mode"
    gameModeSource = `已检测到开局，等待模式信号 · ${formatClock(record.at)}`
    return true
  }
  return false
}

function cycleRemainingTotal(): number {
  return Math.max(0, totalCards() - seenExactCards.length)
}

function cycleSeenTotal(): number {
  return seenExactCards.length
}

function drawPileRemainingLabel(): string {
  if (drawPileRemaining === undefined) {
    return "待协议"
  }
  // 中途接入未校准时，数字仅供参考，加 ~ 前缀提示不可信。
  return drawPileCalibrated ? String(drawPileRemaining) : `~${drawPileRemaining}`
}

// 观星控底信息条：协议负责位置和数量；页面文本若暴露牌面，则补到 tooltip。
// 顶部牌随摸牌出列，全部摸完则自动消失；底部牌垫底，本轮一般保留至洗牌。
function renderGuanxing(): string {
  const topCount = guanxingTop.length
  const bottomCount = guanxingBottom.length
  if (topCount === 0 && bottomCount === 0) {
    return ""
  }
  const parts: string[] = []
  if (topCount > 0) {
    const topTip = guanxingCardsTip("你观星控到牌堆顶、尚未被摸走的牌", guanxingTop, "按摸牌顺序排列，1 即下一张摸牌")
    parts.push(`<span class="sgs-gx-top" title="${escapeHtml(topTip)}">顶 ${topCount} 张待摸</span>`)
  }
  if (bottomCount > 0) {
    const bottomTip = guanxingCardsTip("你观星垫到牌堆底的牌", guanxingBottom, "本轮一般摸不到，洗牌后失效")
    parts.push(`<span class="sgs-gx-bottom" title="${escapeHtml(bottomTip)}">底 ${bottomCount} 张垫底</span>`)
  }
  const tip = `观星控底：查看过 ${guanxingPeekCount} 张；悬浮顶/底数字可看已捕获牌面`
  return `<div class="sgs-guanxing" title="${escapeHtml(tip)}"><span class="sgs-gx-head">观星控底</span>${parts.join("")}</div>`
}

function formatClock(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--"
}

function groupCards(type: DeckCardEntry["type"]): DeckCardRow[] {
  const rows = new Map<string, DeckCardRow>()
  for (const card of deckProfile.cards) {
    if (card.type !== type) {
      continue
    }
    const existing = rows.get(card.name)
    if (existing) {
      existing.count += card.count
      existing.variants.push(card)
      if (!existing.description && card.description) {
        existing.description = card.description
      }
    } else {
      rows.set(card.name, {
        name: card.name,
        count: card.count,
        variants: [card],
        ...(card.type ? { type: card.type } : {}),
        ...(card.description ? { description: card.description } : {})
      })
    }
  }
  return [...rows.values()].sort((left, right) => {
    const leftOrder = cardDisplayOrder.get(left.name) ?? 999
    const rightOrder = cardDisplayOrder.get(right.name) ?? 999
    return leftOrder - rightOrder || left.name.localeCompare(right.name, "zh-CN")
  })
}

function looksLikeInGameStart(record: HookRecord): boolean {
  if (record.kind === "protocol-event") {
    return Boolean(record.eventType && /MsgGameTurnNtf|GsCGamephaseNtf|MsgActionStateNtf/.test(record.eventType))
  }
  return Boolean(record.text && /剩余牌|牌堆|牌库|第\s*\d+\s*轮|出牌阶段|摸牌阶段|判定阶段/.test(record.text))
}

function looksLikeGameOverText(text: string | undefined): boolean {
  if (!text) {
    return false
  }
  const normalized = text.replace(/\s+/g, "")
  return (
    /牌局结束|游戏结束|战斗结束|最后结算|点击空白处关闭|熟练度|银两/.test(normalized) ||
    (normalized.length <= 4 && /^(胜利|失败|平局)$/.test(normalized))
  )
}

function finishRound(at: number, text = "牌局结束"): void {
  if (trackingPhase !== "ended") {
    status.gameOverCount += 1
  }
  status.listening = false
  status.lastGameOverAt = at
  trackingPhase = "ended"
  clearRoundStateForGameOver()
  pushDisplayEvent({
    at,
    type: "game-over",
    text
  })
}

function maybeSwitchDeckProfileFromText(text: string): boolean {
  if ((manualModeLocked || protocolModeLocked) && gameModeId) {
    return false
  }
  const mode = detectGameModeIdFromText(text)
  if (!mode) {
    return false
  }
  return setGameMode(mode, "页面文本识别")
}

function knownCardNamesByLength(): string[] {
  return [...new Set(deckProfile.cards.map((card) => card.name))].sort((left, right) => right.length - left.length)
}

function exactCardNamesByLength(): Array<{ alias: string; canonical: string }> {
  const names = knownCardNamesByLength().map((name) => ({ alias: name, canonical: name }))
  const aliases = Object.entries(exactCardAliases)
    .filter(([, canonical]) => deckProfile.cards.some((card) => card.name === canonical))
    .map(([alias, canonical]) => ({ alias, canonical }))
  return [...names, ...aliases].sort((left, right) => right.alias.length - left.alias.length)
}

function extractExactSeenCards(text: string, at: number): ExactSeenCard[] {
  const names = exactCardNamesByLength()
  if (names.length === 0) {
    return []
  }

  const aliasMap = new Map(names.map((item) => [item.alias, item.canonical]))
  const namePattern = names.map((item) => item.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  const pattern = new RegExp(`(${namePattern})([♠♥♣♦])(A|10|[2-9JQK])`, "gu")
  const cards: ExactSeenCard[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const name = aliasMap.get(match[1] ?? "") ?? match[1]
    const suit = normalizeSuitSymbol(match[2])
    const rank = match[3]
    if (!name || !suit || !rank) {
      continue
    }
    cards.push({
      id: `${at}-${cards.length}-${name}-${suit ?? ""}-${rank ?? ""}`,
      name,
      at,
      suit,
      rank,
      zone: "public",
      sourceText: text
    })
  }
  return cards
}

function exactCardKey(card: Pick<ExactSeenCard, "name" | "suit" | "rank">): string {
  // 花色必须归一成统一符号：协议路径存英文(club/spade)、文本路径存中文(梅花/黑桃)，
  // 若不归一，同一张实体牌(杀♣8)会因 "club" ≠ "梅花" 产生两个 key 被重复计入“已见”，
  // 导致“已见”超过牌库总数(曾观察到 68>52)。
  return `${card.name}|${suitSymbol(card.suit)}|${card.rank ?? ""}`
}

function exactDeckCount(card: Pick<ExactSeenCard, "name" | "suit" | "rank">): number {
  return deckProfile.cards.filter((item) => item.name === card.name && suitSymbol(item.suit) === suitSymbol(card.suit) && item.rank === card.rank).length
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  return undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function numberArrayValue(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(numberValue).filter((item): item is number => item !== undefined)
}

function rawProtocolMessage(record: HookRecord): Record<string, unknown> | undefined {
  if (!isObjectRecord(record.dataRaw)) {
    return undefined
  }
  if (isObjectRecord(record.dataRaw.msg)) {
    return record.dataRaw.msg
  }
  return record.dataRaw
}

function protocolCardEntry(cardId: number): DeckCardEntry | undefined {
  // 协议只下发 cardId，不下发花色点数；cardId 与本地牌表数组顺序并不对应。
  // 过去用 cardId-1 / cardId-2001 当数组下标猜花色，是错的（曾把你打出的桃♥6 误判成火杀♥7）。
  // 现在只信任显式建立的映射（protocolCardEntriesById，目前为空，保留以备将来有可靠来源）。
  // 拿不到映射时返回 undefined：协议移动只用于牌堆计数，不点亮具体花色格子。
  return protocolCardEntriesById.get(cardId)
}

function seedProtocolDeck(cardIds: number[], at: number): boolean {
  if (!cardIds.length) {
    return false
  }
  const signature = `${cardIds.length}:${cardIds.slice(0, 6).join(",")}:${cardIds.slice(-6).join(",")}`
  const isOneVOneDeck = cardIds.length === 52 || cardIds.some((id) => id >= 2001 && id <= 2052)
  const isHappyTwoVTwoDeck = cardIds.length >= 150 && cardIds.slice(0, 120).some((id) => id >= 1 && id <= 161)
  let changed = false
  if (isOneVOneDeck && gameModeId !== "sgs-1v1") {
    changed = setGameMode("sgs-1v1", `协议牌表识别 · ${formatClock(at)}`) || changed
  } else if (isOneVOneDeck && !protocolModeLocked) {
    protocolModeLocked = true
    manualModeLocked = false
    gameModeSource = `协议牌表识别 · ${formatClock(at)}`
    deckProfileSource = gameModeSource
    changed = true
  } else if (isHappyTwoVTwoDeck && gameModeId !== "sgs-happy-2v2") {
    changed = setGameMode("sgs-happy-2v2", `协议牌表识别 · ${formatClock(at)}`) || changed
  } else if (isHappyTwoVTwoDeck && !protocolModeLocked) {
    protocolModeLocked = true
    manualModeLocked = false
    gameModeSource = `协议牌表识别 · ${formatClock(at)}`
    deckProfileSource = gameModeSource
    changed = true
  }

  if (signature !== lastProtocolDeckSignature) {
    resetRoundStateForNewGame(at, "协议牌表更新", { clearProtocolDeck: true })
    lastProtocolDeckSignature = signature
    changed = true
  }

  // 不再按位置把 cardIds[index] 配 deckProfile.cards[index]：协议发牌列表顺序与本地牌表
  // 数组顺序无对应关系，按位置配对同样是猜测，会导致已见牌花色点数错乱。协议牌表仅用于
  // 识别模式与牌堆总数，不建立 cardId→花色点数映射。
  const total = totalCards()
  if (drawPileRemaining !== total) {
    drawPileRemaining = total
    drawPileRemainingSource = `协议牌表初始化 ${total} 张 · ${formatClock(at)}`
    changed = true
  }
  // 收到完整开局牌表 = 权威起点，从此牌堆计数可信。
  drawPileCalibrated = true
  hasInGameSignal = true
  if (trackingPhase !== "in-game") {
    trackingPhase = "in-game"
    changed = true
  }
  status.listening = true
  return changed
}

// 观星：处理与观星暂存区(zone 8)相关的协议移动。返回 true 表示这是观星移动、已被本函数消化。
//   1 → 8 (MoveType 6)：取走牌堆顶 N 张进入观星，记录 peek 数并清空上一轮残留。
//   8 → 1 (MoveType 7)：摆回牌堆。ToPosition 65280=顶部(下家会摸到)、其余=底部。
function handleGuanxingMove(
  fromZone: number | undefined,
  toZone: number | undefined,
  toPosition: number | undefined,
  cardIds: number[],
  at: number
): boolean {
  if (fromZone === 1 && toZone === GUANXING_ZONE) {
    // 观星开始：牌堆顶若干张被取出观看。新一轮观星，丢弃上一轮残留。
    guanxingTop = []
    guanxingBottom = []
    pendingGuanxingTopDetails = []
    pendingGuanxingBottomDetails = []
    guanxingPeekCount = cardIds.length
    guanxingAt = at
    pushDisplayEvent({ at, type: "protocol", text: `观星：查看牌堆顶 ${cardIds.length} 张` })
    return true
  }

  if (fromZone === GUANXING_ZONE && toZone === 1) {
    // 摆回牌堆。顶部牌按“数组靠后=更接近下一张摸牌”排列（真机验证）；为便于消费，
    // guanxingTop 头部即下一张待摸，故反转入队。底部牌按文本/协议顺序累积展示。
    if (toPosition === GUANXING_TOP_POSITION) {
      const cards = attachDetailsToGuanxingCards(
        [...cardIds].reverse().map(guanxingCardFromId),
        pendingGuanxingTopDetails.splice(0, cardIds.length)
      )
      guanxingTop = cards.concat(guanxingTop)
    } else {
      const cards = attachDetailsToGuanxingCards(
        cardIds.map(guanxingCardFromId),
        pendingGuanxingBottomDetails.splice(0, cardIds.length)
      )
      guanxingBottom = guanxingBottom.concat(cards)
    }
    guanxingAt = at
    return true
  }

  return false
}

// 摸牌(1→其它)时推进观星控顶消费：每从牌堆顶摸走 1 张，控顶队列头部出列。
function consumeGuanxingTopOnDraw(drawnCount: number): void {
  if (drawnCount <= 0 || guanxingTop.length === 0) {
    return
  }
  guanxingTop.splice(0, Math.min(drawnCount, guanxingTop.length))
}

function markProtocolCardSeen(cardId: number, toZone: number | undefined, at: number, sourceText: string, ownerSeatId?: number): boolean {
  const card = protocolCardEntry(cardId)
  if (!card) {
    return false
  }
  // 座位→武将名（用于浮窗归属）。座位映射缺失时不归属，仅计入已见。
  const ownerName = ownerSeatId === undefined ? undefined : seatRegistry.get(ownerSeatId)?.generalName
  if (ownerName) {
    rememberPlayerLabel(ownerName)
  }
  // 协议 toZone 6 = 装备区：单列 equip，洗牌时保留（装备不参与洗牌）。
  const targetZone: ExactSeenCard["zone"] = toZone === 6 ? "equip" : "public"
  const existing = seenExactCards.find((item) => item.cardId === cardId)
  if (existing) {
    // 由“玩家已见(暗手牌)”转为“公开/装备(打出/弃置/装备/明置)”：牌已离开暗手牌区，
    // 无论持有者是否变化都必须递减原持有者计数。自己装备自己的牌 owner 不变，
    // 若加“仅 owner 变化才减”的判断会漏减，导致已知手牌残留（如仁王盾装备后仍显示）。
    if (existing.zone === "player-visible") {
      addKnownCardForExactOwner(existing.owner, existing.name, -1)
    }
    existing.zone = targetZone
    existing.at = at
    existing.sourceText = sourceText
    if (ownerName) {
      existing.owner = ownerName
    }
    protocolCardZonesById.set(cardId, toZone ?? protocolCardZonesById.get(cardId) ?? -1)
    existing.pulseAt = at
    return true
  }

  const textExact = seenExactCards.find((item) => item.cardId === undefined && isSameExactCard(card, item))
  if (textExact) {
    if (textExact.zone === "player-visible") {
      addKnownCardForExactOwner(textExact.owner, textExact.name, -1)
    }
    textExact.id = `protocol-card:${cardId}`
    textExact.cardId = cardId
    textExact.zone = targetZone
    textExact.at = at
    textExact.sourceText = sourceText
    if (ownerName) {
      textExact.owner = ownerName
    }
    protocolCardZonesById.set(cardId, toZone ?? -1)
    textExact.pulseAt = at
    return true
  }

  seenExactCards.push({
    id: `protocol-card:${cardId}`,
    cardId,
    name: card.name,
    ...(card.suit ? { suit: card.suit } : {}),
    ...(card.rank ? { rank: card.rank } : {}),
    zone: targetZone,
    ...(ownerName ? { owner: ownerName } : {}),
    sourceText,
    at,
    pulseAt: at
  })
  protocolCardZonesById.set(cardId, toZone ?? -1)
  if (seenExactCards.length > 360) {
    seenExactCards.splice(0, seenExactCards.length - 360)
  }
  return true
}

// 把模块级牌堆变量打包成 shared 纯函数所需的状态对象。
function currentDeckPileState(): DeckPileState {
  return {
    remaining: drawPileRemaining,
    calibrated: drawPileCalibrated,
    reshuffleCount: status.reshuffleCount
  }
}

function applyDeckPileState(next: DeckPileState): void {
  drawPileRemaining = next.remaining
  drawPileCalibrated = next.calibrated
  status.reshuffleCount = next.reshuffleCount
}

function clearSeenCardStateForRecycle(): void {
  // 洗牌把弃牌堆洗回摸牌堆，花色点数信息作废。只保留“敌方可见牌”——即我通过
  // 过河拆桥/攻心等看到的敌方手牌（zone=player-visible 且 owner 为敌方）。这类信息
  // 可靠且有价值（敌人没打出就还在）。自己/队友的牌局内本就可见，无需保留；尤其
  // 1v1 自己摸+自己装备的牌，装备离手在日志/协议里都无信号（自装备无文字、协议无
  // 花色映射），保留只会变成“幽灵装备”——曾出现洗牌后已被替换的旧武器仍显示可见。
  const preserved = seenExactCards.filter((card) => {
    if (card.zone !== "player-visible") {
      return false
    }
    const ownerKey = playerKeyOf(card.owner)
    return Boolean(ownerKey) && !allyPlayerKeys.has(ownerKey as string)
  })
  trackerState = createInitialTrackerState(deckProfile)
  seenExactCards.length = 0
  protocolCardZonesById.clear()
  recentProtocolMoveTimes.clear()
  exactSourceKeys.clear()
  // 洗牌后牌堆顺序作废，观星控底信息失效。
  resetGuanxingState()
  // 重新放回保留的敌方可见牌，并重建其来源去重键 + 敌方已知手牌计数。
  for (const card of preserved) {
    seenExactCards.push(card)
    exactSourceKeys.add(`${exactCardKey(card)}|${card.zone}|${card.sourceText}`)
    addKnownCardForExactOwner(card.owner, card.name, 1)
  }
}

function recycleProtocolDiscardPile(at: number, cardCount?: number): boolean {
  // 牌堆数值/洗牌判定交给 shared 纯函数（deckPile）。弃牌堆同步的 cardCount 是牌堆权威
  // 剩余张数，直接校准；牌堆涨大才算洗牌。content 只负责清理“已见牌”等 UI 副作用。
  const total = totalCards()
  const outcome = applyDeckPileMove(
    currentDeckPileState(),
    { fromZone: 2, toZone: 9, cardCount, moveType: 255, deckCardCount: 0 },
    total
  )
  applyDeckPileState(outcome.state)

  if (outcome.didReshuffle) {
    // 洗牌：弃牌洗回牌堆，花色点数信息作废，重置已见牌。
    clearSeenCardStateForRecycle()
    drawPileRemainingSource = `协议洗牌：牌堆洗回校准为 ${drawPileRemaining} · ${formatClock(at)}`
    pushDisplayEvent({
      at,
      type: "protocol",
      text: `协议检测到洗牌，牌堆校准为 ${drawPileRemaining}，已见牌重置`
    })
  } else {
    // 常规牌堆快照：只校准牌堆数，不动已见牌（牌入弃牌堆但身份仍已知）。
    drawPileRemainingSource = cardCount !== undefined
      ? `协议同步牌堆剩余 ${drawPileRemainingLabel()} · ${formatClock(at)}`
      : `协议同步牌堆剩余 ${drawPileRemainingLabel()} · ${formatClock(at)}`
    pushDisplayEvent({
      at,
      type: "protocol",
      text: `协议同步牌堆剩余 ${drawPileRemainingLabel()} 张`
    })
  }
  return true
}

function updateDrawPileRemainingFromProtocolMove(
  fromZone: number | undefined,
  toZone: number | undefined,
  cardCount: number | undefined,
  cardIds: number[],
  at: number
): boolean {
  // 牌堆增减交给 shared 纯函数。content 只把暗牌处理（deckMoveCount）和文案/校准提示补上。
  const total = totalCards()
  const deckCardCount = deckMoveCount(cardIds, cardCount ?? 0, (cardId) => Boolean(protocolCardEntry(cardId)))
  const prevRemaining = drawPileRemaining
  const outcome = applyDeckPileMove(
    currentDeckPileState(),
    { fromZone, toZone, cardCount, moveType: undefined, deckCardCount },
    total
  )
  if (!outcome.changed) {
    return false
  }
  const firstSignal = prevRemaining === undefined
  applyDeckPileState(outcome.state)

  if (fromZone === 1 && toZone !== 1) {
    drawPileRemainingSource = firstSignal
      ? drawPileCalibrated
        ? `协议牌堆首次校准 ${drawPileRemaining} 张 · ${formatClock(at)}`
        : `中途接入按 ${total} 估算后移出 ${deckCardCount} 张（未校准）· ${formatClock(at)}`
      : drawPileCalibrated
        ? `协议牌堆移出 ${deckCardCount} 张 · ${formatClock(at)}`
        : `协议牌堆移出 ${deckCardCount} 张（未校准）· ${formatClock(at)}`
  } else if (toZone === 1 && fromZone !== 1) {
    drawPileRemainingSource = `协议牌堆移入 ${deckCardCount} 张 · ${formatClock(at)}`
  }
  return true
}

function protocolMoveSignature(msg: Record<string, unknown>): string {
  const cardIds = numberArrayValue(msg.CardIDs).join(",")
  return [
    numberValue(msg.FromZone) ?? "",
    numberValue(msg.ToZone) ?? "",
    numberValue(msg.MoveType) ?? "",
    numberValue(msg.CardCount) ?? "",
    numberValue(msg.SrcSeatID) ?? "",
    numberValue(msg.DstSeatID) ?? "",
    numberValue(msg.FromZoneParam) ?? "",
    numberValue(msg.ToZoneParam) ?? "",
    numberValue(msg.SpellID) ?? "",
    cardIds
  ].join("|")
}

function shouldSkipDuplicateProtocolMove(msg: Record<string, unknown>, at: number): boolean {
  const key = protocolMoveSignature(msg)
  const previousAt = recentProtocolMoveTimes.get(key) ?? 0
  recentProtocolMoveTimes.set(key, at)
  if (recentProtocolMoveTimes.size > 300) {
    const cutoff = at - 60000
    for (const [itemKey, itemAt] of recentProtocolMoveTimes.entries()) {
      if (itemAt < cutoff) {
        recentProtocolMoveTimes.delete(itemKey)
      }
    }
  }
  return previousAt > 0 && at - previousAt >= 0 && at - previousAt < 800
}

function isVisibleProtocolMove(
  fromZone: number | undefined,
  toZone: number | undefined,
  moveType: number | undefined,
  cardIds: number[]
): boolean {
  void moveType
  // 摸牌进手牌（1→5）一律不记入“公开已见”：即使 1v1 协议会下发真实 cardId，对手摸进
  // 手牌的牌玩家本来也看不到。摸牌可见性只由文本“X从摸牌堆获得…”决定（且仅自己/队友带牌面，
  // 归 player-visible），不能靠协议 cardId 一概当公开——否则对手摸的牌会被错误扣减。
  if (fromZone === 1 && toZone === 5) {
    return false
  }
  // 其余移动只要携带真实 cardId（>0）即对我可见（打出/弃置/明置/局末摊牌等）。暗牌（全 0）无信息可记。
  if (!cardIds.some((cardId) => cardId > 0)) {
    return false
  }
  return toZone !== undefined || fromZone !== undefined
}

function inferGameModeFromProtocolCardIds(cardIds: number[], at: number): boolean {
  if (cardIds.some((cardId) => cardId >= 2001 && cardId <= 2052)) {
    if (gameModeId === "sgs-1v1" && protocolModeLocked) {
      return false
    }
    return setGameMode("sgs-1v1", `协议牌号识别 · ${formatClock(at)}`)
  }

  if (!cardIds.some((cardId) => cardId >= 1 && cardId <= 161)) {
    return false
  }
  if (gameModeId === "sgs-happy-2v2" && protocolModeLocked) {
    return false
  }
  return setGameMode("sgs-happy-2v2", `协议牌号识别 · ${formatClock(at)}`)
}

function ensureRoundActiveFromRawProtocol(record: HookRecord, reason: string): boolean {
  if (trackingPhase !== "ended" && status.listening) {
    return false
  }
  if (status.lastGameOverAt && record.at - status.lastGameOverAt < 1500) {
    return false
  }
  resetRoundStateForNewGame(record.at, reason)
  return true
}

function ingestRawProtocolRecord(record: HookRecord): boolean {
  if (record.kind !== "raw-protocol-event" || !record.eventType) {
    return false
  }
  const msg = rawProtocolMessage(record)
  if (!msg) {
    return false
  }
  let changed = false
  // 局末花名册：Players[] 含 SeatID+generalNames+Figure，SelfResult.SeatID 标识“您”。
  // 用于把座位↔武将↔阵营落实（队友判定 B 不依赖它，但 A/D 的精确归属需要）。
  if (record.eventType === "GAME_OVER_EVENT" || record.eventType === "MsgGameOver") {
    registerSeatRosterFromGameOver(msg)
  }
  // 局中较早的阵营广播：仅 SeatID+Figure（无武将名），先补 figure。
  if (record.eventType === "MsgGameShowFigure") {
    const seatId = numberValue(msg.SeatID)
    const figure = numberValue(msg.Figure)
    if (seatId !== undefined) {
      registerSeatsFromPlayers([{ seatId, ...(figure !== undefined ? { figure } : {}) }], undefined)
    }
  }
  if (record.eventType === "MsgGameOver") {
    finishRound(record.at)
    return true
  }
  if (record.eventType === "MsgGamePlayCardNtf") {
    changed = ensureRoundActiveFromRawProtocol(record, "协议检测到新牌局") || changed
    const cardIds = numberArrayValue(msg.CardList)
    const cardCount = numberValue(msg.cardCount)
    if (cardIds.length || cardCount === 52) {
      changed = seedProtocolDeck(cardIds, record.at) || changed
      pushDisplayEvent({
        at: record.at,
        type: "protocol",
        text: cardIds.length ? `协议牌表 ${cardIds.length} 张，已按实体牌记牌` : `协议牌表 ${cardCount} 张`
      })
      return true
    }
  }

  if (record.eventType !== "PubGsCMoveCard") {
    return changed
  }
  if (shouldSkipDuplicateProtocolMove(msg, record.at)) {
    return changed
  }

  const cardIds = numberArrayValue(msg.CardIDs)
  changed = inferGameModeFromProtocolCardIds(cardIds, record.at) || changed
  const moveType = numberValue(msg.MoveType)
  const fromZone = numberValue(msg.FromZone)
  const toZone = numberValue(msg.ToZone)
  const cardCount = numberValue(msg.CardCount)
  const toPosition = numberValue(msg.ToPosition)
  const srcSeatId = numberValue(msg.SrcSeatID)
  const fromId = numberValue(msg.FromID)
  const toId = numberValue(msg.ToID)
  if (cardIds.length || fromZone !== undefined || toZone !== undefined) {
    changed = ensureRoundActiveFromRawProtocol(record, "协议检测到新旁观移动") || changed
  }
  if (fromZone === 2 && toZone === 9 && moveType === 255) {
    return recycleProtocolDiscardPile(record.at, cardCount)
  }
  // 观星暂存区(zone 8)进出：记录控顶/控底，再交给牌堆计数（1→8 出、8→1 入，净额为 0）。
  if (handleGuanxingMove(fromZone, toZone, toPosition, cardIds, record.at)) {
    changed = updateDrawPileRemainingFromProtocolMove(fromZone, toZone, cardCount, cardIds, record.at) || changed
    return true
  }
  changed = updateDrawPileRemainingFromProtocolMove(fromZone, toZone, cardCount, cardIds, record.at) || changed
  // 普通摸牌(牌堆→非牌堆且非观星)推进控顶消费：顶部牌被摸走则出列。
  if (fromZone === 1 && toZone !== 1 && toZone !== GUANXING_ZONE && cardIds.length) {
    consumeGuanxingTopOnDraw(cardIds.length)
  }

  if (!cardIds.length) {
    return changed
  }
  // 可见性按“是否携带真实 cardId”判定：暗牌（全 0）无信息可记，带真实 id 即可见
  // （含局末摊牌 5→5 mt24，旧逻辑曾一刀切丢弃）。
  if (!isVisibleProtocolMove(fromZone, toZone, moveType, cardIds)) {
    return changed
  }
  // 归属座位：进入手牌/装备区（toZone 5/6）归去向 ToID，其余（出牌/弃置/明置）归来源。
  const ownerSeatId =
    toZone === 5 || toZone === 6
      ? toId ?? srcSeatId ?? fromId
      : srcSeatId ?? fromId ?? toId

  for (const cardId of cardIds) {
    if (cardId <= 0) {
      continue
    }
    protocolCardZonesById.set(cardId, toZone ?? -1)
    changed = markProtocolCardSeen(cardId, toZone, record.at, `protocol:${record.eventType}:${fromZone ?? "?"}->${toZone ?? "?"}:move${moveType ?? "?"}`, ownerSeatId) || changed
  }
  return changed
}

function playerKeyOf(playerName?: string): string | undefined {
  return canonicalPlayerKey(playerName)
}

function resetSeatRegistry(): void {
  seatRegistry.clear()
  selfSeatId = undefined
  selfFigure = undefined
  allyPlayerKeys.clear()
  allyPlayerKeys.add("__self__")
}

// 标记某玩家为“我方阵营”（自己或队友），其可见牌可解禁入库。
function markAllyPlayer(playerName: string | undefined): void {
  const key = playerKeyOf(playerName)
  if (key) {
    allyPlayerKeys.add(key)
  }
}

// 从 GAME_OVER/MsgGameOver 消息解析花名册：Players[]（SeatID/generalNames/nickName/Figure）+ SelfResult.SeatID。
function registerSeatRosterFromGameOver(msg: Record<string, unknown>): void {
  const players = Array.isArray(msg.Players) ? msg.Players : []
  const parsed: SeatInfo[] = []
  for (const raw of players) {
    if (!isObjectRecord(raw)) {
      continue
    }
    const seatId = numberValue(raw.SeatID)
    if (seatId === undefined) {
      continue
    }
    const generalName = stringValue(raw.generalNames) ?? stringValue(raw.generalNames1)
    const nickName = stringValue(raw.nickName) ?? stringValue(raw.showName)
    const figure = numberValue(raw.Figure)
    parsed.push({
      seatId,
      ...(generalName ? { generalName } : {}),
      ...(nickName ? { nickName } : {}),
      ...(figure !== undefined ? { figure } : {})
    })
  }
  const selfResult = isObjectRecord(msg.SelfResult) ? msg.SelfResult : undefined
  const selfSeat = selfResult ? numberValue(selfResult.SeatID) : undefined
  if (parsed.length) {
    registerSeatsFromPlayers(parsed, selfSeat)
  }
}

// 用座位 Players[] 回填注册表，并按 SelfResult.SeatID 标识自己、按 Figure 归并队友。
function registerSeatsFromPlayers(players: SeatInfo[], selfSeat: number | undefined): void {
  for (const p of players) {
    if (p.seatId === undefined || p.seatId < 0) {
      continue
    }
    const existing = seatRegistry.get(p.seatId) ?? { seatId: p.seatId }
    seatRegistry.set(p.seatId, {
      ...existing,
      ...(p.generalName ? { generalName: p.generalName } : {}),
      ...(p.nickName ? { nickName: p.nickName } : {}),
      ...(p.figure !== undefined ? { figure: p.figure } : {})
    })
  }
  if (selfSeat !== undefined) {
    selfSeatId = selfSeat
    const self = seatRegistry.get(selfSeat)
    if (self) {
      self.isSelf = true
      if (self.figure !== undefined) {
        selfFigure = self.figure
      }
    }
  }
  // 同 Figure 即同队：用 shared 纯逻辑算出我方武将名并加入 allyPlayerKeys。
  const roster: SeatRosterEntry[] = Array.from(seatRegistry.values()).map((info) => ({
    seatId: info.seatId,
    ...(info.generalName ? { generalName: info.generalName } : {}),
    ...(info.figure !== undefined ? { figure: info.figure } : {})
  }))
  for (const generalName of allyGeneralNames(roster, selfSeatId)) {
    markAllyPlayer(generalName)
  }
}

function rememberPlayerLabel(playerName?: string): string | undefined {
  const key = playerKeyOf(playerName)
  if (!key) {
    return undefined
  }
  const label = playerName?.replace(/（您）/gu, "").trim() || (key === "__self__" ? "您" : key)
  playerLabelsByKey.set(key, label)
  return key
}

function normalizeAnchorText(text: string): string {
  return text.replace(/（您）/gu, "").replace(/您/gu, "").replace(/\s+/g, "").trim()
}

function isLayaPosition(value: unknown): value is LayaPosition {
  if (!value || typeof value !== "object") {
    return false
  }
  const pos = value as Partial<LayaPosition>
  return Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.width) && Number.isFinite(pos.height)
}

function updatePlayerAnchorFromRecord(record: HookRecord): boolean {
  if (!record.text || !isLayaPosition(record.pos) || record.pos.visible === false) {
    return false
  }
  const text = normalizeAnchorText(record.text)
  if (!text || text.length > 18) {
    return false
  }

  let matchedKey: string | undefined
  for (const [key, label] of playerLabelsByKey.entries()) {
    const normalizedLabel = normalizeAnchorText(label)
    if (normalizedLabel && (text === normalizedLabel || normalizedLabel.includes(text) || text.includes(normalizedLabel))) {
      matchedKey = key
      break
    }
  }
  matchedKey ??= playerKeyOf(record.text)
  if (!matchedKey) {
    return false
  }

  const previous = playerAnchorsByKey.get(matchedKey)
  const next: PlayerAnchor = {
    key: matchedKey,
    label: playerLabelsByKey.get(matchedKey) ?? record.text,
    x: record.pos.x,
    y: record.pos.y,
    width: record.pos.width,
    height: record.pos.height,
    at: record.at
  }
  if (
    previous &&
    Math.abs(previous.x - next.x) < 2 &&
    Math.abs(previous.y - next.y) < 2 &&
    Math.abs(previous.width - next.width) < 2 &&
    Math.abs(previous.height - next.height) < 2
  ) {
    return false
  }
  playerAnchorsByKey.set(matchedKey, next)
  return true
}

function canAcceptExactCardState(card: Pick<ExactSeenCard, "name" | "suit" | "rank">, zone: ExactSeenCard["zone"], rawText: string): boolean {
  const key = exactCardKey(card)
  const sourceKey = `${key}|${zone}|${rawText}`
  if (exactSourceKeys.has(sourceKey)) {
    return false
  }

  if ((zone === "public" || zone === "equip") && seenExactCards.some((item) => item.zone === "player-visible" && exactCardKey(item) === key)) {
    return true
  }
  if (zone === "player-visible" && seenExactCards.some((item) => exactCardKey(item) === key)) {
    return true
  }

  const maxCopies = exactDeckCount(card)
  const existingCopies = seenExactCards.filter((item) => exactCardKey(item) === key).length
  return maxCopies === 0 || existingCopies < maxCopies
}

// 看牌/亮牌类文案：这些事件让某玩家的（原本不可见的）手牌对我可见，应归入“玩家已见”并挂浮窗。
// 含：展示手牌区、亮出（所有）手牌、观看…手牌（攻心类“令…亮出/观看手牌”）、展示…的手牌。
// 注意排除“观看牌堆顶”（那是看牌堆不是看手牌），由 parser 的 IGNORE 与这里的精确措辞共同保证。
const HAND_REVEAL_PATTERN = /展示手牌区|亮出(?:所有)?手牌|观看(?:了)?(?:.{0,6})手牌|展示(?:了)?.{0,8}的手牌/u
const HAND_REVEAL_OWNER_PATTERN = /^(.+?)(?:展示手牌区|亮出(?:所有)?手牌|观看(?:了)?(?:.{0,6})手牌|展示(?:了)?.{0,8}的手牌)/u

function isHandRevealText(text: string): boolean {
  if (/观看牌堆顶|牌堆顶/.test(text)) {
    return false
  }
  return HAND_REVEAL_PATTERN.test(text)
}

function exactEventZone(event: ParsedLogEvent): ExactSeenCard["zone"] {
  if (event.action === "gainKnown" || isHandRevealText(event.rawText) || /手牌区获得|获得.+手牌|从.+的(手牌区|装备区|判定区|手牌|装备)获得/.test(event.rawText)) {
    return "player-visible"
  }
  // 装备牌进装备区：牌面公开、且“仍在场上”，洗牌时不应被清除（装备不参与洗牌）。
  // 单列 equip 区与 public（打出/弃置，进弃牌堆）区分，供洗牌重置时保留。
  if (event.action === "equip") {
    return "equip"
  }
  return "public"
}

function exactTokensForEvent(event: ParsedLogEvent, at: number): ExactSeenCard[] {
  return extractExactSeenCards(event.rawText, at)
}

function hasExactTokenForEvent(event: ParsedLogEvent, at: number): boolean {
  return exactTokensForEvent(event, at).length > 0
}

function addKnownCardForExactOwner(owner: string | undefined, cardName: CardName, delta: number): void {
  const ownerKey = playerKeyOf(owner)
  if (!ownerKey) {
    return
  }
  const counts = trackerState.knownCardsByPlayer[ownerKey] ?? {}
  counts[cardName] = Math.max(0, (counts[cardName] ?? 0) + delta)
  if (counts[cardName] === 0) {
    delete counts[cardName]
  }
  if (Object.keys(counts).length === 0) {
    delete trackerState.knownCardsByPlayer[ownerKey]
    return
  }
  trackerState.knownCardsByPlayer[ownerKey] = counts
}

function upsertExactCardState(card: ExactSeenCard, zone: ExactSeenCard["zone"], event: ParsedLogEvent): boolean {
  const key = exactCardKey(card)
  const sourceKey = `${key}|${zone}|${event.rawText}`
  rememberPlayerLabel(event.playerName)
  if (!canAcceptExactCardState(card, zone, event.rawText)) {
    return false
  }
  exactSourceKeys.add(sourceKey)

  if (zone === "public" || zone === "equip") {
    const visible = seenExactCards.find((item) => item.zone === "player-visible" && exactCardKey(item) === key)
    if (visible) {
      // 离开暗手牌进公开区/装备区（打出/弃置/装备/明置）：始终递减原持有者，
      // 自己装备自己的牌 owner 不变也要减，否则已知手牌残留。
      addKnownCardForExactOwner(visible.owner, visible.name, -1)
      visible.zone = zone
      visible.at = card.at
      visible.sourceText = event.rawText
      if (event.playerName) {
        visible.owner = event.playerName
      }
      visible.pulseAt = card.at
      return true
    }
  }

  if (zone === "player-visible") {
    const existing = seenExactCards.find((item) => exactCardKey(item) === key)
    if (existing) {
      const previousOwner = existing.zone === "player-visible" ? existing.owner : undefined
      const previousOwnerKey = playerKeyOf(previousOwner)
      if (previousOwner && previousOwnerKey !== playerKeyOf(event.playerName) && previousOwnerKey !== playerKeyOf(event.sourcePlayerName)) {
        addKnownCardForExactOwner(previousOwner, existing.name, -1)
      }
      existing.zone = "player-visible"
      if (event.playerName) {
        existing.owner = event.playerName
      } else {
        delete existing.owner
      }
      existing.at = card.at
      existing.sourceText = event.rawText
      existing.pulseAt = card.at
      return true
    }
  }

  const maxCopies = exactDeckCount(card)
  const existingCopies = seenExactCards.filter((item) => exactCardKey(item) === key).length
  if (maxCopies > 0 && existingCopies >= maxCopies) {
    return false
  }

  seenExactCards.push({
    ...card,
    zone,
    sourceText: event.rawText,
    pulseAt: card.at,
    ...(event.playerName ? { owner: event.playerName } : {})
  })
  if (seenExactCards.length > 360) {
    seenExactCards.splice(0, seenExactCards.length - 360)
  }
  return true
}

function applyExactTokenEvent(baseEvent: ParsedLogEvent, token: ExactSeenCard, index: number): ParsedLogEvent {
  const { cardNames: _cardNames, ...singleCardEvent } = baseEvent
  void _cardNames
  const zone = exactEventZone(baseEvent)
  if (!canAcceptExactCardState(token, zone, baseEvent.rawText)) {
    return baseEvent
  }
  const exactEvent: ParsedLogEvent = {
    ...singleCardEvent,
    id: `${baseEvent.id}-exact-${index}-${token.name}-${token.suit}-${token.rank}`,
    cardName: token.name,
    suit: token.suit,
    rank: token.rank,
    status: "accepted",
    quality: "strict",
    autoAcceptable: true,
    fingerprint: `${baseEvent.fingerprint ?? baseEvent.rawText}|${token.name}${token.suit}${token.rank}`
  }
  trackerState = applyEvent(trackerState, exactEvent)
  const applied = trackerState.events.find((item) => item.id === exactEvent.id) ?? exactEvent
  upsertExactCardState(token, zone, exactEvent)
  return applied
}

function applyAcceptedExactEvent(event: ParsedLogEvent, at: number): ParsedLogEvent | undefined {
  const tokens = exactTokensForEvent(event, at)
  if (!tokens.length) {
    return undefined
  }
  let applied: ParsedLogEvent | undefined
  tokens.forEach((token, index) => {
    applied = applyExactTokenEvent(event, token, index)
  })
  return applied
}

function visibleHandOwner(text: string): string | undefined {
  return text.match(HAND_REVEAL_OWNER_PATTERN)?.[1]?.trim()
}

function visibleHandEventId(ownerKey: string, token: ExactSeenCard, index: number): string {
  return `visible-hand:${ownerKey}:${index}:${token.name}:${token.suit ?? ""}:${token.rank ?? ""}`
}

function isVisibleHandSnapshotEventForOwner(event: ParsedLogEvent, ownerKey: string): boolean {
  return (
    event.action === "gainKnown" &&
    isHandRevealText(event.rawText) &&
    (event.id.startsWith(`visible-hand:${ownerKey}:`) || playerKeyOf(event.playerName) === ownerKey)
  )
}

function rebuildTrackerStateFromEvents(events: ParsedLogEvent[]): void {
  let nextState = createInitialTrackerState(deckProfile)
  events.forEach((event) => {
    nextState = applyEvent(nextState, event)
  })
  trackerState = nextState
}

function removeVisibleHandExactCardsForOwner(ownerKey: string): boolean {
  let changed = false
  for (let index = seenExactCards.length - 1; index >= 0; index -= 1) {
    const card = seenExactCards[index]
    if (card?.zone !== "player-visible" || playerKeyOf(card.owner) !== ownerKey || !isHandRevealText(card.sourceText)) {
      continue
    }
    exactSourceKeys.delete(`${exactCardKey(card)}|player-visible|${card.sourceText}`)
    seenExactCards.splice(index, 1)
    changed = true
  }
  return changed
}

function ingestVisibleExactText(text: string, at: number): boolean {
  if (!isHandRevealText(text)) {
    return false
  }
  const tokens = extractExactSeenCards(text, at)
  if (!tokens.length) {
    return false
  }
  const owner = visibleHandOwner(text)
  const ownerKey = playerKeyOf(owner)
  if (!owner || !ownerKey) {
    return false
  }
  const retainedEvents = trackerState.events.filter((event) => !isVisibleHandSnapshotEventForOwner(event, ownerKey))
  const removedOldExactCards = removeVisibleHandExactCardsForOwner(ownerKey)
  if (retainedEvents.length !== trackerState.events.length) {
    rebuildTrackerStateFromEvents(retainedEvents)
  }
  let changed = false
  tokens.forEach((token, index) => {
    const syntheticEvent: ParsedLogEvent = {
      id: visibleHandEventId(ownerKey, token, index),
      rawText: text,
      normalizedText: text,
      normalizedRawText: text,
      playerName: owner,
      action: "gainKnown",
      cardName: token.name,
      confidence: 1,
      source: "hook",
      status: "accepted",
      quality: "strict",
      autoAcceptable: true,
      suit: token.suit,
      rank: token.rank,
      fingerprint: `visible-hand|${text}|${token.name}${token.suit}${token.rank}`,
      createdAt: new Date(at).toISOString()
    }
    if (canAcceptExactCardState(token, "player-visible", text)) {
      changed = upsertExactCardState(token, "player-visible", syntheticEvent) || changed
    }
  })
  changed = changed || removedOldExactCards || retainedEvents.length !== trackerState.events.length
  if (changed) {
    pushDisplayEvent({
      at,
      type: "text",
      text
    })
  }
  return changed
}

function isSameExactCard(card: DeckCardEntry, exact: ExactSeenCard): boolean {
  return card.name === exact.name && Boolean(card.suit && exact.suit && suitSymbol(card.suit) === suitSymbol(exact.suit)) && Boolean(card.rank && exact.rank && card.rank === exact.rank)
}

function exactSeenCountByName(name: string): number {
  return seenExactCards.filter((card) => card.name === name).length
}

function fallbackVariant(card: DeckCardRow, index: number): DeckCardEntry {
  return card.variants[index] ?? {
    name: card.name,
    count: 1,
    ...(card.type ? { type: card.type } : {}),
    ...(card.description ? { description: card.description } : {})
  }
}

function renderChip(card: DeckCardEntry, state: "public" | "player-visible" | "equip" | "remaining", index: number, pulsing: boolean): string {
  const label = escapeHtml(card.rank || cardChipLabel(card))
  const redClass = isRedSuit(card.suit) ? " is-red" : ""
  const seenClass = state === "public" || state === "player-visible" || state === "equip" ? " is-seen" : ""
  const playerClass = state === "player-visible" ? " is-player-visible" : ""
  const pulseClass = state !== "remaining" && pulsing ? " is-pulsing" : ""
  const zoneName = state === "public" ? "公开区" : state === "player-visible" ? "玩家已见" : state === "equip" ? "装备区" : "未见"
  const title = escapeHtml(cardTooltip(card, state === "player-visible" ? "玩家已见" : state === "remaining" ? "未见" : "公开区"))
  return `<span class="sgs-card-chip${seenClass}${playerClass}${redClass}${pulseClass}" title="${title} · ${zoneName} #${index + 1}">${renderSuitIcon(card.suit)}<span>${label}</span></span>`
}

function renderChips(card: DeckCardRow, remaining: number): string {
  const maxVisible = 48
  const exactSeen = seenExactCards.filter((item) => item.name === card.name)
  const variants = card.variants.length ? card.variants : Array.from({ length: card.count }, (_, index) => fallbackVariant(card, index))
  const seenVariantStates = new Map<number, "public" | "player-visible" | "equip">()
  const seenVariantPulse = new Set<number>()

  for (const exact of exactSeen) {
    const index = variants.findIndex((variant, variantIndex) => !seenVariantStates.has(variantIndex) && isSameExactCard(variant, exact))
    if (index >= 0) {
      seenVariantStates.set(index, exact.zone)
      // pulse 精确到“这一张实体牌”：用条目自身的 pulseAt。每个 seenExactCards 条目都被
      // findIndex 映射到唯一变体下标，所以只有真正变动的那一张会闪——文本牌（无 cardId）
      // 同样能闪，且不会出现 2v2 双牌堆同名同花同点一起闪/像被扣减的错觉。
      if (exact.pulseAt !== undefined && Date.now() - exact.pulseAt < 1800) {
        seenVariantPulse.add(index)
      }
    }
  }

  const visibleVariants = variants
    .map((variant, index) => ({ variant, index }))
    .slice(0, maxVisible)

  const chips = visibleVariants
    .map((item, displayIndex) => {
      const state = seenVariantStates.get(item.index) ?? "remaining"
      return renderChip(item.variant, state, displayIndex, seenVariantPulse.has(item.index) && state !== "remaining")
    })
    .join("")

  const overflowCount = Math.max(0, variants.length - visibleVariants.length)
  const overflow = overflowCount > 0 ? `<span class="sgs-card-overflow">+${overflowCount}</span>` : ""
  void remaining
  return chips + overflow
}

function renderGroup(type: NonNullable<DeckCardEntry["type"]>, label: string): string {
  const cards = groupCards(type)
  const remaining = cards.reduce((sum, card) => sum + Math.max(0, card.count - exactSeenCountByName(card.name)), 0)
  const open = openGroups[type] !== false
  const rows = cards
    .map((card) => {
      const seen = exactSeenCountByName(card.name)
      const left = Math.max(0, card.count - seen)
      const exhaustedClass = left <= 0 ? " is-empty" : ""
      return `
        <div class="sgs-card-row${exhaustedClass}" data-card-name="${escapeHtml(card.name)}">
          <div class="sgs-card-name"><span>${escapeHtml(card.name)}</span><b>× ${left}</b></div>
          <div class="sgs-card-cells">${renderChips(card, left)}</div>
          <div class="sgs-card-seen">已见 ${seen}</div>
        </div>
      `
    })
    .join("")

  return `
    <section class="sgs-deck-section" data-group="${type}">
      <button class="sgs-section-head" type="button" data-action="toggle-group" data-group="${type}">
        <span class="sgs-chevron">${open ? "⌄" : "›"}</span>
        <span>${label}（${cards.length}）</span>
        <strong>${remaining}</strong>
      </button>
      <div class="sgs-section-body${open ? "" : " is-closed"}">
        ${rows}
      </div>
    </section>
  `
}

// 敌方已知手牌列表（面板内固定区域，不依赖屏幕坐标）。
// 只列“敌方”：自己和队友的牌牌局内本就可见，无需在此重复。
// 数据源直接取 seenExactCards 里仍处于 player-visible（暗手牌/被我看到的手牌/获得的判定牌）
// 且 owner 为敌方的牌——而非 knownCardsByPlayer 粗计数表。后者由 shared tracker 维护，
// 展示手牌/获得判定牌等合成事件不会往里 +1，会导致敌方面板漏显（曾出现过河拆桥看了对方
// 整手牌却不显示）。改为直接读 seenExactCards 后，敌人把该牌打出/弃置时其 zone 会转 public，
// 自然从面板消失，无需额外同步。
function renderEnemyKnownHands(): string {
  const byOwnerKey = new Map<string, { label: string; cards: ExactSeenCard[] }>()
  for (const card of seenExactCards) {
    if (card.zone !== "player-visible") {
      continue
    }
    const ownerKey = playerKeyOf(card.owner)
    if (!ownerKey || allyPlayerKeys.has(ownerKey)) {
      continue
    }
    const label = playerLabelsByKey.get(ownerKey) ?? card.owner ?? (ownerKey.startsWith("seat:") ? `座位${ownerKey.slice(5)}` : ownerKey)
    const bucket = byOwnerKey.get(ownerKey) ?? { label, cards: [] }
    bucket.cards.push(card)
    byOwnerKey.set(ownerKey, bucket)
  }

  const rows: string[] = []
  for (const { label, cards } of byOwnerKey.values()) {
    if (!cards.length) {
      continue
    }
    const chips = cards.slice(0, 16).map(renderKnownHandChip).join("")
    const more = cards.length > 16 ? `<span class="sgs-hand-more">+${cards.length - 16}</span>` : ""
    rows.push(`
      <div class="sgs-enemy-hand">
        <div class="sgs-enemy-hand-name">${escapeHtml(label)}<b>${cards.length}</b></div>
        <div class="sgs-enemy-hand-cards">${chips}${more}</div>
      </div>
    `)
  }

  if (!rows.length) {
    return ""
  }

  return `
    <section class="sgs-known-zone">
      <div class="sgs-known-zone-head">
        <span>敌方已知手牌</span>
        <strong>${rows.length}</strong>
      </div>
      <div class="sgs-known-zone-body">
        ${rows.join("")}
      </div>
    </section>
  `
}

type CurrentKnownCard = {
  name: CardName
  suit?: string
  rank?: string
}

function renderKnownHandChip(card: CurrentKnownCard): string {
  const redClass = isRedSuit(card.suit) ? " is-red" : ""
  const nameLabel = escapeHtml(handCardNameLabel(card.name))
  const rankLabel = escapeHtml(card.rank ?? "")
  const metaClass = card.suit || card.rank ? "" : " is-empty"
  const description = cardDescription(card.name)
  const title = escapeHtml(
    cardTooltip(
      {
        name: card.name,
        ...(card.suit ? { suit: card.suit } : {}),
        ...(card.rank ? { rank: card.rank } : {}),
        ...(description ? { description } : {})
      },
      "玩家已见"
    )
  )
  return `<span class="sgs-hand-card${redClass}" title="${title}"><span class="sgs-hand-card-name">${nameLabel}</span><span class="sgs-hand-card-meta${metaClass}">${renderSuitIcon(card.suit)}${rankLabel}</span></span>`
}

// 浮窗已废弃：敌方已知手牌改为记牌器面板内的固定列表（renderEnemyKnownHands），
// 不再依赖屏幕坐标/锚点（坐标换算脆弱、且会延迟）。此处仅清空旧浮窗根，保证不残留。
function renderKnownHandOverlay(): void {
  const root = document.getElementById(HAND_OVERLAY_ROOT_ID)
  if (root && root.innerHTML) {
    root.innerHTML = ""
  }
}

function queueKnownHandOverlayRender(force = false): void {
  if (!IS_TOP_FRAME) {
    return
  }
  const now = Date.now()
  if (!force && now - lastHandOverlayRenderAt < 200) {
    if (!handOverlayQueued) {
      handOverlayQueued = true
      window.setTimeout(() => {
        handOverlayQueued = false
        lastHandOverlayRenderAt = Date.now()
        renderKnownHandOverlay()
      }, 200)
    }
    return
  }
  if (handOverlayQueued) {
    return
  }
  handOverlayQueued = true
  scheduleRenderWork(() => {
    handOverlayQueued = false
    lastHandOverlayRenderAt = Date.now()
    renderKnownHandOverlay()
  })
}

function renderEventLog(): string {
  const rows = displayEvents
    .slice(-80)
    .map((item) => {
      const typeClass = ` is-${item.type}`
      return `
        <div class="sgs-event-row${typeClass}">
          <time>${formatClock(item.at)}</time>
          <span>${escapeHtml(item.text)}</span>
        </div>
      `
    })
    .join("")
  return rows || `<div class="sgs-empty">等待对局内公开事件</div>`
}

function phaseLabel(): string {
  if (trackingPhase === "in-game") {
    return "对局中"
  }
  if (trackingPhase === "ended") {
    return "已结束"
  }
  if (trackingPhase === "detecting-mode") {
    return "识别模式"
  }
  return "等待开局"
}

function renderWaitingView(): string {
  const waitingTitle = trackingPhase === "detecting-mode" ? "检测到开局" : "等待开局"
  const waitingDetail =
    trackingPhase === "detecting-mode"
      ? gameModeSource
      : gameModeId
        ? `${supportedModeLabel(gameModeId)} · 等待开局信号`
        : "监听页面中，识别到 2v2 或 1v1 后开始记牌"
  return `
    <div class="sgs-waiting-view">
      <div class="sgs-waiting-status">${escapeHtml(waitingTitle)}</div>
      <div class="sgs-waiting-detail">${escapeHtml(waitingDetail)}</div>
      <div class="sgs-mode-row">
        <button type="button" data-action="set-mode" data-mode="sgs-happy-2v2" class="${gameModeId === "sgs-happy-2v2" ? "is-active" : ""}">2v2</button>
        <button type="button" data-action="set-mode" data-mode="sgs-1v1" class="${gameModeId === "sgs-1v1" ? "is-active" : ""}">1v1</button>
      </div>
    </div>
  `
}

function currentStateSignature(): string {
  const tail = seenExactCards
    .slice(-30)
    .map((card) => `${card.cardId ?? ""}:${card.zone}:${card.name}:${card.suit ?? ""}:${card.rank ?? ""}`)
    .join("|")
  return [
    PAGE_INSTANCE_ID,
    trackingPhase,
    hasInGameSignal ? "started" : "not-started",
    gameModeId ?? "",
    seenExactCards.length,
    seenExactCards.filter((card) => card.zone === "player-visible").length,
    seenExactCards.filter((card) => card.zone === "public").length,
    drawPileRemaining ?? "",
    status.gameOverCount,
    status.reshuffleCount,
    tail
  ].join("~")
}

function queueRenderStateSnapshot(): void {
  const signature = currentStateSignature()
  if (signature === lastRenderStateSignature) {
    return
  }
  lastRenderStateSignature = signature
  queueCollectorSnapshot("render-state", true)
}

function renderPanel(): void {
  const root = ensureRoot()
  root.style.setProperty("--sgs-panel-width", `${panelWidth}px`)
  const previousDeckList = root.querySelector<HTMLElement>(".sgs-deck-list")
  const previousEventLog = root.querySelector<HTMLElement>(".sgs-event-log")
  const deckScrollTop = previousDeckList?.scrollTop ?? 0
  const eventLogScrollTop = previousEventLog?.scrollTop ?? 0
  const eventLogWasAtBottom = previousEventLog
    ? previousEventLog.scrollTop + previousEventLog.clientHeight >= previousEventLog.scrollHeight - 8
    : true

  if (collapsed) {
    root.innerHTML = `
      <button class="sgs-tracker-tab" type="button" data-action="expand" title="展开三国杀记牌器">
        <span>杀</span>
        <b>${isDeckActive() ? drawPileRemainingLabel() : "待命"}</b>
      </button>
    `
    bindPanelEvents(root)
    queueKnownHandOverlayRender()
    queueRenderStateSnapshot()
    return
  }

  const connectionLabel = `${trackingPhase === "ended" ? "已结束" : status.listening ? "监听中" : "已暂停"} · ${phaseLabel()}`
  const connectionClass = status.listening && trackingPhase !== "waiting" ? " is-live" : " is-paused"
  const baselineText = midGameBaseline ? "中途接入" : "从开局统计"
  const versionLabel = `${CONTENT_VERSION.replace("extension-content-", "")}${status.hookVersion ? ` · ${status.hookVersion.replace("extension-public-hook-", "")}` : ""}`
  const displayedRemainingSource = `协议牌堆剩余 ${drawPileRemainingLabel()}；未见实体牌 ${cycleRemainingTotal()}；${drawPileRemainingSource || "等待协议牌堆信号"}`
  const modeLabel = supportedModeLabel(gameModeId)
  const summaryLabel = isGameModeReady()
    ? `${modeLabel} · ${escapeHtml(deckProfileSource)}`
    : `${modeLabel} · ${escapeHtml(gameModeSource)}`
  const countMarkup = isDeckActive()
    ? drawPileRemaining === undefined
      ? `<span class="sgs-count-waiting">--</span><small>/${totalCards()}</small>`
      : `${drawPileCalibrated ? "" : "~"}${drawPileRemaining}<small>/${totalCards()}</small>`
    : `<span class="sgs-count-waiting">--</span>`
  root.innerHTML = `
    <aside class="sgs-tracker-panel${panelWidth >= 520 ? " is-wide" : ""}${logCollapsed ? " is-log-collapsed" : ""}" aria-label="三国杀记牌器">
      <div class="sgs-resize-handle" data-resize-handle title="拖拽调整宽度"></div>
      <header class="sgs-tracker-header">
        <div class="sgs-title-lockup">
          <div class="sgs-logo-mark">杀</div>
          <div>
            <h2>三国杀记牌器</h2>
            <p><span class="sgs-status-dot${connectionClass}"></span>${escapeHtml(connectionLabel)} · ${summaryLabel} · ${escapeHtml(versionLabel)}</p>
          </div>
        </div>
        <div class="sgs-count" title="${escapeHtml(isDeckActive() ? displayedRemainingSource : gameModeSource)}">${countMarkup}</div>
      </header>

      <div class="sgs-toolbar" role="toolbar" aria-label="记牌器操作">
        <button type="button" data-action="toggle-listen" title="${status.listening ? "暂停监听" : "继续监听"}">${status.listening ? "Ⅱ" : "▶"}</button>
        <button type="button" data-action="set-mode" data-mode="sgs-happy-2v2" class="${gameModeId === "sgs-happy-2v2" ? "is-active" : ""}" title="手动锁定欢乐 2v2">2v2</button>
        <button type="button" data-action="set-mode" data-mode="sgs-1v1" class="${gameModeId === "sgs-1v1" ? "is-active" : ""}" title="手动锁定 1v1">1v1</button>
        <button type="button" data-action="reset" title="重置本局">↻</button>
        <button type="button" data-action="export" title="复制本局 JSON">⤓</button>
        <button type="button" data-action="collapse" title="收起">×</button>
      </div>

      <div class="sgs-deck-list">
        ${
          isDeckActive()
            ? `${renderGroup("basic", "基本牌")}${renderGroup("trick", "锦囊牌")}${renderGroup("equip", "装备牌")}${renderEnemyKnownHands()}`
            : renderWaitingView()
        }
      </div>

      <footer class="sgs-tracker-footer">
        ${isDeckActive() ? renderGuanxing() : ""}
        <div class="sgs-footer-stats">
          ${
            isDeckActive()
              ? `<span>${baselineText}</span><span>牌堆 ${drawPileRemainingLabel()}</span><span>未见 ${cycleRemainingTotal()}</span><span>已见 ${cycleSeenTotal()}</span><span>洗牌 ${status.reshuffleCount}</span><span>结束 ${status.gameOverCount}</span>`
              : `<span>${escapeHtml(phaseLabel())}</span><span>支持 2v2 / 1v1</span><span>${escapeHtml(gameModeSource)}</span>`
          }
          <button type="button" data-action="toggle-log" title="${logCollapsed ? "展开日志" : "折叠日志"}">${logCollapsed ? "日志展开" : "日志折叠"}</button>
        </div>
        ${logCollapsed ? "" : `<div class="sgs-event-log">${renderEventLog()}</div>`}
      </footer>
    </aside>
  `
  bindPanelEvents(root)

  const nextDeckList = root.querySelector<HTMLElement>(".sgs-deck-list")
  if (nextDeckList) {
    nextDeckList.scrollTop = deckScrollTop
  }
  const nextEventLog = root.querySelector<HTMLElement>(".sgs-event-log")
  if (nextEventLog) {
    nextEventLog.scrollTop = eventLogWasAtBottom ? nextEventLog.scrollHeight : eventLogScrollTop
  }
  queueKnownHandOverlayRender()
  queueRenderStateSnapshot()
}

function queueRender(): void {
  if (renderQueued) {
    return
  }
  renderQueued = true
  scheduleRenderWork(() => {
    renderQueued = false
    renderPanel()
  })
}

function scheduleRenderWork(callback: () => void): void {
  if (document.visibilityState === "hidden") {
    window.setTimeout(callback, 0)
    return
  }
  window.requestAnimationFrame(callback)
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById(ROOT_ID)
  if (!root) {
    root = document.createElement("div")
    root.id = ROOT_ID
    document.documentElement.append(root)
  }
  if (!root.dataset.eventsBound) {
    root.dataset.eventsBound = "true"
    root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true })
    root.addEventListener("dragstart", (event) => event.preventDefault())
    root.addEventListener("selectstart", (event) => event.preventDefault())
  }
  return root
}

function bindPanelEvents(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", () => {
      const action = element.dataset.action
      if (action === "collapse") {
        collapsed = true
      } else if (action === "expand") {
        collapsed = false
      } else if (action === "toggle-listen") {
        status.listening = !status.listening
      } else if (action === "reset") {
        resetTracker({ preserveMode: true })
      } else if (action === "export") {
        void exportJson()
      } else if (action === "toggle-log") {
        logCollapsed = !logCollapsed
        window.localStorage.setItem(LOG_COLLAPSED_STORAGE_KEY, String(logCollapsed))
      } else if (action === "toggle-group") {
        const group = element.dataset.group
        if (group) {
          openGroups = {
            ...openGroups,
            [group]: openGroups[group] === false
          }
        }
      } else if (action === "set-mode") {
        const mode = element.dataset.mode as SupportedGameModeId | undefined
        if (mode) {
          manualModeLocked = true
          protocolModeLocked = false
          setGameMode(mode, "手动选择")
          if (trackingPhase !== "ended") {
            hasInGameSignal = true
            trackingPhase = "in-game"
          }
        }
      }
      queueRender()
    })
  })

  const resizeHandle = root.querySelector<HTMLElement>("[data-resize-handle]")
  resizeHandle?.addEventListener("mousedown", (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth
    const panel = root.querySelector<HTMLElement>(".sgs-tracker-panel")
    const onMove = (moveEvent: MouseEvent) => {
      panelWidth = clamp(startWidth + startX - moveEvent.clientX, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 16))
      root.style.setProperty("--sgs-panel-width", `${panelWidth}px`)
      panel?.classList.toggle("is-wide", panelWidth >= 520)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidth))
      queueRender()
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  })
}

function resetTracker(options: { preserveMode?: boolean } = {}): void {
  const preservedMode = options.preserveMode ? gameModeId : undefined
  const preservedProfile = preservedMode ? deckProfileById(preservedMode) : undefined
  const preservedSource = preservedMode ? gameModeSource || deckProfileSource : undefined
  const preservedManualModeLocked = options.preserveMode ? manualModeLocked : false
  const preservedProtocolModeLocked = options.preserveMode ? protocolModeLocked : false
  deckProfile = preservedProfile ?? defaultDeckProfile
  deckProfileSource = preservedSource ?? "等待识别"
  gameModeId = preservedMode
  gameModeSource = preservedSource ?? "等待页面模式信号"
  manualModeLocked = preservedManualModeLocked
  protocolModeLocked = preservedProtocolModeLocked
  trackingPhase = preservedMode ? "in-game" : "waiting"
  hasInGameSignal = Boolean(preservedMode)
  trackerState = createInitialTrackerState(deckProfile)
  drawPileRemaining = undefined
  drawPileRemainingSource = ""
  drawPileCalibrated = false
  midGameBaseline = false
  displayEvents.length = 0
  seenExactCards.length = 0
  exactSourceKeys.clear()
  resetProtocolCardState()
  seenStageTexts.clear()
  recentTextTimes.clear()
  playerLabelsByKey.clear()
  playerAnchorsByKey.clear()
  status.textCount = 0
  status.protocolCount = 0
  status.gameOverCount = 0
  status.redactedCount = 0
  status.reshuffleCount = 0
  status.lastGameOverAt = 0
  status.listening = true
  queueKnownHandOverlayRender(true)
  queueCollectorSnapshot("reset", true)
}

function clearRoundStateForGameOver(): void {
  trackerState = createInitialTrackerState(deckProfile)
  drawPileRemaining = undefined
  drawPileRemainingSource = ""
  drawPileCalibrated = false
  midGameBaseline = false
  seenExactCards.length = 0
  exactSourceKeys.clear()
  playerLabelsByKey.clear()
  playerAnchorsByKey.clear()
  resetProtocolCardState()
  status.reshuffleCount = 0
  queueKnownHandOverlayRender(true)
}

function pushRecentHookRecord(record: HookRecord): void {
  const item: DiagnosticHookRecord = {
    at: record.at,
    kind: record.kind,
    ...(record.text ? { text: record.text } : {}),
    ...(record.rawText ? { rawText: record.rawText } : {}),
    ...(record.eventType ? { eventType: record.eventType } : {}),
    ...(record.dataSummary !== undefined ? { dataSummary: record.dataSummary } : {}),
    ...(record.dataRaw !== undefined ? { dataRaw: record.dataRaw } : {}),
    ...(record.direction ? { direction: record.direction } : {}),
    ...(record.wsUrl ? { wsUrl: record.wsUrl } : {}),
    ...(record.payload !== undefined ? { payload: record.payload } : {}),
    ...(record.frameUrl ? { frameUrl: record.frameUrl } : {}),
    ...(record.redacted ? { redacted: true } : {}),
    ...(record.redactionReason ? { redactionReason: record.redactionReason } : {}),
    ...(record.sampleReason ? { sampleReason: record.sampleReason } : {}),
    ...(record.pos !== undefined ? { pos: record.pos } : {})
  }
  recentHookRecords.push(item)
  if (recentHookRecords.length > 300) {
    recentHookRecords.splice(0, recentHookRecords.length - 300)
  }
  if (record.kind === "raw-protocol-event" || record.kind === "raw-ws-frame") {
    recentRawHookRecords.push(item)
    rawCollectorBuffer.push(item)
    if (recentRawHookRecords.length > 300) {
      recentRawHookRecords.splice(0, recentRawHookRecords.length - 300)
    }
    if (rawCollectorBuffer.length > 120) {
      rawCollectorBuffer.splice(0, rawCollectorBuffer.length - 120)
    }
    queueRawCollectorSnapshot()
  }
  if (record.text) {
    recentRawTexts.push(record.rawText ?? record.text)
    if (recentRawTexts.length > 100) {
      recentRawTexts.splice(0, recentRawTexts.length - 100)
    }
  }
}

function buildDiagnostics(): CollectorDiagnostics {
  const now = Date.now()
  return {
    href: location.href,
    title: document.title,
    pageInstanceId: PAGE_INSTANCE_ID,
    contentVersion: CONTENT_VERSION,
    isTopFrame: IS_TOP_FRAME,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    lastRecordAgeMs: status.lastRecordAt ? now - status.lastRecordAt : null,
    collectorLastPostAt: lastCollectorPostAt ? new Date(lastCollectorPostAt).toISOString() : null,
    collectorPostAgeMs: lastCollectorPostAt ? now - lastCollectorPostAt : null,
    collectorSequence,
    recentHookRecords: recentHookRecords.slice(-120),
    recentRawHookRecords: recentRawHookRecords.slice(-120),
    recentRawTextCount: recentRawTexts.length,
    seenStageTextCount: seenStageTexts.size,
    recentTextKeyCount: recentTextTimes.size,
    exactSourceKeyCount: exactSourceKeys.size
  }
}

function buildExportPayload(reason: string): ExportPayload {
  return {
    exportedAt: new Date().toISOString(),
    source: "sgs-extension-hook",
    pageInstanceId: PAGE_INSTANCE_ID,
    sequence: collectorSequence,
    reason,
    pageUrl: location.href,
    trackingPhase,
    hasInGameSignal,
    ...(gameModeId ? { gameModeId } : {}),
    gameModeLabel: supportedModeLabel(gameModeId),
    gameModeSource,
    deckProfile,
    deckProfileSource,
    drawPileRemainingSource,
    drawPileCalibrated,
    midGameBaseline,
    seatRegistry: Array.from(seatRegistry.values()),
    allyPlayerKeys: Array.from(allyPlayerKeys),
    playerAnchors: Array.from(playerAnchorsByKey.values()),
    status: { ...status },
    trackerState,
    seenExactCards: seenExactCards.slice(),
    exactCardStates: seenExactCards.slice(),
    ...(guanxingTop.length || guanxingBottom.length || guanxingPeekCount
      ? {
          guanxing: {
            top: guanxingTop.map((card) => card.cardId),
            bottom: guanxingBottom.map((card) => card.cardId),
            topCards: guanxingTop.map(guanxingExportCard),
            bottomCards: guanxingBottom.map(guanxingExportCard),
            peekCount: guanxingPeekCount,
            at: guanxingAt
          }
        }
      : {}),
    recentEvents: displayEvents.slice(-100),
    diagnostics: buildDiagnostics(),
    ...(selfSeatId !== undefined ? { selfSeatId } : {}),
    ...(selfFigure !== undefined ? { selfFigure } : {}),
    ...(drawPileRemaining !== undefined ? { drawPileRemaining } : {})
  }
}

async function postCollectorSnapshot(reason: string): Promise<void> {
  collectorSequence += 1
  lastCollectorPostAt = Date.now()
  const payload = buildExportPayload(reason)
  try {
    await fetch(COLLECTOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    })
  } catch {
    // Collector is optional during normal use.
  }
}

async function postRawCollectorSnapshot(): Promise<void> {
  if (!rawCollectorBuffer.length) {
    return
  }
  collectorSequence += 1
  const records = rawCollectorBuffer.splice(0, rawCollectorBuffer.length)
  try {
    await fetch(COLLECTOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exportedAt: new Date().toISOString(),
        source: "sgs-extension-hook",
        pageInstanceId: PAGE_INSTANCE_ID,
        sequence: collectorSequence,
        reason: "raw-protocol-batch",
        pageUrl: location.href,
        trackingPhase,
        gameModeId,
        gameModeLabel: supportedModeLabel(gameModeId),
        ...(drawPileRemaining !== undefined ? { drawPileRemaining } : {}),
        drawPileRemainingSource,
        exactSeenCount: cycleSeenTotal(),
        cycleRemaining: cycleRemainingTotal(),
        status: { ...status },
        diagnostics: {
          href: location.href,
          title: document.title,
          pageInstanceId: PAGE_INSTANCE_ID,
          contentVersion: CONTENT_VERSION,
          hookVersion: status.hookVersion,
          isTopFrame: IS_TOP_FRAME,
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus()
        },
        rawRecords: records
      })
    })
  } catch {
    rawCollectorBuffer.unshift(...records.slice(-80))
  }
}

function queueRawCollectorSnapshot(): void {
  if (rawCollectorQueued) {
    return
  }
  rawCollectorQueued = true
  window.setTimeout(() => {
    rawCollectorQueued = false
    void postRawCollectorSnapshot()
  }, 500)
}

function queueCollectorSnapshot(reason: string, force = false): void {
  if (force) {
    void postCollectorSnapshot(reason)
    return
  }
  if (!force && Date.now() - lastCollectorPostAt < 1200) {
    return
  }
  if (collectorQueued) {
    return
  }
  collectorQueued = true
  window.setTimeout(() => {
    collectorQueued = false
    void postCollectorSnapshot(reason)
  }, force ? 0 : 250)
}

async function exportJson(): Promise<void> {
  const payload = buildExportPayload("manual-export")
  await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2))
  queueCollectorSnapshot("manual-export", true)
}

function pushDisplayEvent(item: Omit<DisplayEvent, "id">): void {
  displayEvents.push({
    ...item,
    id: `${item.at}-${displayEvents.length}`
  })
  if (displayEvents.length > 160) {
    displayEvents.splice(0, displayEvents.length - 160)
  }
}

function updateDrawPileRemainingFromText(text: string, at: number, kind: string): boolean {
  let changed = false
  if (!gameModeId && !manualModeLocked) {
    changed = maybeSwitchDeckProfileFromText(text) || changed
  }
  if (changed) {
    drawPileRemainingSource = `页面文本只用于模式识别，牌堆数等待协议 · ${formatClock(at)}`
  }
  return changed
}

function shouldSkipTextRecord(record: HookRecord): boolean {
  if (!record.text) {
    return true
  }
  const textKey = record.text.replace(/\s+/g, "")
  if (!textKey) {
    return true
  }
  if (record.kind === "laya-stage-snapshot") {
    if (seenStageTexts.has(textKey)) {
      return true
    }
    seenStageTexts.add(textKey)
    return false
  }

  const lastAt = recentTextTimes.get(textKey) ?? 0
  if (record.at - lastAt < 1200) {
    return true
  }
  recentTextTimes.set(textKey, record.at)
  return false
}

function ingestTextRecord(record: HookRecord): boolean {
  if (!record.text || shouldSkipTextRecord(record)) {
    return false
  }

  let changed = maybeSwitchDeckProfileFromText(record.text)
  changed = updateDrawPileRemainingFromText(record.text, record.at, record.kind) || changed
  status.textCount += 1
  if (looksLikeGameOverText(record.text)) {
    finishRound(record.at, "页面检测到牌局结束")
    return true
  }
  if (record.redacted) {
    // 队友摸牌解禁：2v2 日志里凡“带花色的摸牌”，其玩家必是我方（敌方摸牌不下发牌面）。
    // 这类记录被 pageHook 误当“离屏暗牌”审查了，但完整内容仍在 rawText。此处用 rawText 还原，
    // 标记该玩家为队友，并走正常已见牌入库（不再当审查丢弃）。
    const allyText = allyDrawRawText(record)
    if (allyText) {
      markAllyPlayer(allyDrawActor(allyText))
      const { rawText: _rawText, redactionReason: _reason, ...rest } = record
      const promoted: HookRecord = { ...rest, text: allyText, redacted: false }
      return ingestUnredactedTextRecord(promoted, record.at) || changed
    }
    status.redactedCount += 1
    pushDisplayEvent({
      at: record.at,
      type: "redacted",
      text: record.rawText
        ? `审查文本：${record.rawText}`
        : `${record.text}（${record.redactionReason ?? "redacted"}）`
    })
    return changed
  }
  return ingestUnredactedTextRecord(record, record.at) || changed
}

// 判断是否为“队友带花色摸牌”被审查的记录；命中则返回可用于入库的完整文本（rawText）。
function allyDrawRawText(record: HookRecord): string | undefined {
  return record.rawText && isAllyDrawText(record.rawText) ? record.rawText : undefined
}

function allyDrawActor(text: string): string | undefined {
  return sharedAllyDrawActor(text)
}

function ingestUnredactedTextRecord(record: HookRecord, at: number): boolean {
  let changed = false
  if (!isDeckActive()) {
    return changed
  }
  if (!record.text) {
    return changed
  }

  changed = ingestGuanxingPlacementText(record.text, at) || changed
  const parsedEvents = parseLogInput([{ text: record.text, score: 1 }], "hook", deckProfile)
  const event = parsedEvents[0]
  if (!event) {
    return ingestVisibleExactText(record.text, at) || changed
  }
  return ingestParsedTextEvent(event, record, at) || changed
}

function ingestParsedTextEvent(event: ParsedLogEvent, record: HookRecord, at: number): boolean {
  let changed = false
  const text = record.text ?? ""
  rememberPlayerLabel(event.playerName)
  rememberPlayerLabel(event.targetName)

  const canAcceptExact =
    event.quality === "strict" &&
    event.autoAcceptable &&
    event.supportStatus !== "unsupported" &&
    hasExactTokenForEvent(event, at)
  const acceptedEvent: ParsedLogEvent =
    canAcceptExact
      ? { ...event, status: "accepted" }
      : event

  let appliedEvent: ParsedLogEvent | undefined
  if (acceptedEvent.status === "accepted") {
    appliedEvent = applyAcceptedExactEvent(acceptedEvent, at)
    changed = Boolean(appliedEvent) || changed
  }
  if (acceptedEvent.action !== "ignore" && acceptedEvent.action !== "unknown") {
    pushDisplayEvent({
      at,
      type: "text",
      text,
      event: appliedEvent ?? acceptedEvent
    })
    changed = true
  }
  return ingestVisibleExactText(text, at) || changed
}

function ingestProtocolRecord(record: HookRecord): boolean {
  if (!record.eventType) {
    return false
  }
  status.protocolCount += 1
  let changed = updateGameModeFromRecord(record)
  changed = markInGameSignal(record) || changed
  if (record.eventType === "MsgGameOver") {
    finishRound(record.at)
    return true
  }
  return changed
}

function handleHookRecord(record: HookRecord): void {
  pushRecentHookRecord(record)
  status.lastRecordAt = record.at
  if (record.kind === "page-lifecycle") {
    queueCollectorSnapshot(record.text ? `page-${record.text}` : "page-lifecycle", true)
    return
  }
  if (record.kind === "laya-anchor-candidate") {
    if (updatePlayerAnchorFromRecord(record)) {
      queueKnownHandOverlayRender()
    }
    return
  }
  if (!status.listening && looksLikeInGameStart(record) && (!status.lastGameOverAt || record.at - status.lastGameOverAt > 1500)) {
    resetTracker({ preserveMode: true })
  }
  let changed = updateGameModeFromRecord(record)
  changed = markInGameSignal(record) || changed
  if (record.kind === "protocol-event") {
    changed = ingestProtocolRecord(record) || changed
    if (changed) {
      queueRender()
      queueCollectorSnapshot(record.eventType === "MsgGameOver" ? "game-over" : "protocol", record.eventType === "MsgGameOver")
    } else {
      queueCollectorSnapshot("protocol")
    }
    return
  }
  if (record.kind === "raw-protocol-event") {
    changed = ingestRawProtocolRecord(record) || changed
    if (changed) {
      queueRender()
      queueKnownHandOverlayRender()
      queueCollectorSnapshot(record.eventType === "MsgGameOver" ? "game-over" : "raw-protocol-state", record.eventType === "MsgGameOver")
    }
    return
  }
  if (record.kind === "raw-ws-frame") {
    return
  }
  if (!status.listening) {
    return
  }
  if (ingestTextRecord(record)) {
    changed = true
  }
  if (changed) {
    queueRender()
    queueKnownHandOverlayRender()
    queueCollectorSnapshot("text-change")
  }
}

function injectPageHook(): void {
  if (document.getElementById(HOOK_SCRIPT_ID)) {
    return
  }

  const hookUrl = runtimeUrl("pageHook.js")
  if (!hookUrl) {
    return
  }

  const script = document.createElement("script")
  script.id = HOOK_SCRIPT_ID
  script.src = hookUrl
  script.async = false
  script.onload = () => script.remove()
  ;(document.head || document.documentElement).append(script)
}

function isHookMessage(value: unknown): value is HookMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as HookMessage).source === "sgs-tracker-page-hook" || (value as HookMessage).source === "sgs-tracker-frame-hook") &&
      (value as HookMessage).record
  )
}

function forwardFrameHookMessage(message: HookMessage): void {
  try {
    window.top?.postMessage(
      {
        source: "sgs-tracker-frame-hook",
        hookVersion: message.hookVersion,
        frameUrl: location.href,
        record: {
          ...message.record,
          frameUrl: location.href
        }
      } satisfies HookMessage,
      "*"
    )
  } catch {
    // Cross-frame forwarding is best-effort; collector diagnostics will reveal gaps.
  }
}

function reconnectPageHook(reason: string): void {
  if (!extensionContextValid) {
    return
  }
  injectPageHook()
  if (IS_TOP_FRAME) {
    queueCollectorSnapshot(reason, true)
  }
}

function startCollectorHeartbeat(): void {
  if (heartbeatTimer) {
    return
  }
  heartbeatTimer = window.setInterval(() => {
    queueCollectorSnapshot("heartbeat")
  }, 5000)
}

function bootstrap(): void {
  const hostWindow = window as unknown as Window & Record<string, unknown>
  if (hostWindow[CONTENT_BOOT_KEY] === CONTENT_VERSION) {
    return
  }
  hostWindow[CONTENT_BOOT_KEY] = CONTENT_VERSION

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || !isHookMessage(event.data)) {
      if (IS_TOP_FRAME && isHookMessage(event.data) && event.data.source === "sgs-tracker-frame-hook") {
        status.hookVersion = event.data.hookVersion
        const frameUrl = event.data.frameUrl ?? event.data.record.frameUrl
        handleHookRecord(frameUrl ? { ...event.data.record, frameUrl } : event.data.record)
      }
      return
    }
    if (!IS_TOP_FRAME) {
      forwardFrameHookMessage(event.data)
      return
    }
    status.hookVersion = event.data.hookVersion
    handleHookRecord(event.data.record)
  })

  window.addEventListener("pageshow", () => reconnectPageHook("pageshow"))
  window.addEventListener("focus", () => reconnectPageHook("focus"))
  window.addEventListener("online", () => reconnectPageHook("online"))
  document.addEventListener("visibilitychange", () => {
    reconnectPageHook(document.visibilityState === "visible" ? "visible" : "hidden")
  })
  window.addEventListener("pagehide", () => queueCollectorSnapshot("pagehide", true))
  window.addEventListener("beforeunload", () => queueCollectorSnapshot("beforeunload", true))

  injectPageHook()
  if (IS_TOP_FRAME) {
    ensureRoot()
    renderPanel()
    queueCollectorSnapshot("content-ready", true)
    startCollectorHeartbeat()
  }
}

bootstrap()
