import {
  applyEvent,
  applyDeckPileMove,
  addDeckOrderPreviewDetails,
  applyDeckOrderPreviewMove,
  consumeDeckOrderPreviewTop,
  createInitialTrackerState,
  createDeckOrderPreviewState,
  deckMoveCount,
  defaultDeckProfile,
  deckProfiles,
  createRuleLibrary,
  gameEventsToParsedLogEvents,
  getDeckTotalCount,
  parseGameEvents,
  canonicalPlayerKey,
  isAllyDrawText,
  allyDrawActor as sharedAllyDrawActor,
  allyGeneralNames,
  normalizeText,
  systemRuleLibrary,
  type CardName,
  type DeckCardEntry,
  type DeckOrderPreviewCard,
  type DeckOrderPreviewCardDetail,
  type DeckOrderPreviewState,
  type DeckPileState,
  type ParsedLogEvent,
  type RuleDefinition,
  type RuleLibrary,
  type SeatRosterEntry,
  type TrackerState
} from "@slt/shared"
import TrackerApp from "./App.vue"
import trackerStyles from "./content.css?raw"
import {
  replaceTrackerSnapshot,
  trackerActions,
  trackerStore,
  type CardChipView,
  type CardGroupView,
  type EnemyHandView,
  type EnemyKnownCardView,
  type DeckOrderPreviewView,
  type TrackerSnapshot
} from "./trackerStore"
import {
  COLLECTOR_URL,
  CONTENT_BOOT_KEY,
  CONTENT_VERSION,
  CUSTOM_RULES_STORAGE_KEY,
  DECK_ORDER_PREVIEW_SOURCE,
  DIMENG_SPELL_ID,
  HAND_OVERLAY_ROOT_ID,
  HAND_ZONE,
  HOOK_SCRIPT_ID,
  LOG_COLLAPSED_STORAGE_KEY,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  PANEL_WIDTH_STORAGE_KEY,
  ROOT_ID,
  TEMP_HAND_ZONE
} from "./contentConfig"
import { buildCollectorDiagnostics, buildCollectorExportPayload } from "./collectorPayload"
import {
  cardChipLabel,
  cardDisplayOrder,
  cardFullLabel,
  cardTooltip,
  delayedTrickNames,
  exactCardAliases,
  handCardNameLabel,
  isRedSuit,
  normalizeSuitSymbol,
  suitAssetFileName,
  suitSymbol
} from "./cardPresentation"
import {
  detectGameModeIdFromRecord,
  detectGameModeIdFromText,
  looksLikeGameOverText,
  looksLikeInGameStart,
  supportedModeLabel
} from "./gameModeSignals"
import { forwardFrameHookMessage, isHookMessage } from "./hookBridge"
import { createPanelRenderer } from "./panelRenderer"
import {
  loadCustomRules as loadStoredCustomRules,
  persistCustomRules as persistStoredCustomRules,
  prepareCustomRule
} from "./customRulesStorage"
import {
  type DeckCardRow,
  type DeckOrderPreviewExportCard,
  type CollectorDiagnostics,
  type DiagnosticHookRecord,
  type DisplayEvent,
  type ExactCardZone,
  type ExactSeenCard,
  type ExportPayload,
  type HookMessage,
  type HookRecord,
  type LayaPosition,
  type PendingDimengHand,
  type PlayerAnchor,
  type RecentHandProtocolMove,
  type SeatInfo,
  type SeatPlayerBinding,
  type SupportedGameModeId,
  type TrackingPhase
} from "./contentTypes"
import { createRuntimeUrlResolver } from "./extensionRuntime"
import { createPageInstanceId, isTopFrame } from "./frameIdentity"
import { isObjectRecord, numberArrayValue, numberValue, rawProtocolMessage, stringValue } from "./protocolValues"
import {
  drawPileRemainingLabel as formatDrawPileRemainingLabel,
  eventLogRows as buildEventLogRows,
  formatClock,
} from "./snapshotText"
import { clamp, loadBoolean, loadNumber } from "./storageValues"
import { buildTrackerSnapshotView } from "./trackerSnapshot"

/**
 * content script 是插件的主控层，运行在三国杀网页的隔离世界里。
 *
 * 数据流从下往上看大概是：
 * 1. bootstrap() 把 public/pageHook.js 注入到页面真实上下文。
 * 2. pageHook.js 监听 Laya 文本、Laya 协议事件、WebSocket 原始帧，并用 window.postMessage 发回这里。
 * 3. handleHookRecord() 按 record.kind 分流：协议事件优先、文本事件兜底、锚点事件用于诊断/未来定位能力。
 * 4. ingest* 系列函数把原始信号转成 TrackerState、seenExactCards、displayEvents 等运行时状态。
 * 5. buildTrackerSnapshot() 把复杂运行时状态压成 Vue 组件直接可渲染的 ViewModel。
 *
 * 注意：这里同时承担“插件桥接层”和“记牌业务层”，所以注释会更偏向解释边界、
 * 数据来源可信度、以及为什么要保留某些看似重复的状态。
 */

const IS_TOP_FRAME = isTopFrame()
const PAGE_INSTANCE_ID = createPageInstanceId()

// 当前牌局使用的牌堆模板。模式未识别前使用 defaultDeckProfile，
// 识别到 1v1/2v2 后切换到对应 deckProfile，并重建 TrackerState。
let deckProfile = defaultDeckProfile
let deckProfileSource = "等待识别"
let trackerState: TrackerState = createInitialTrackerState(deckProfile)

// 模式锁有两种来源：
// - manualModeLocked：用户在面板里手动点了 1v1/2v2，后续页面文本不再覆盖。
// - protocolModeLocked：协议已经给出高置信模式，文本识别不再抢占。
let gameModeId: SupportedGameModeId | undefined
let gameModeSource = "等待页面模式信号"
let manualModeLocked = false
let protocolModeLocked = false

// 对局生命周期。hasInGameSignal 比 trackingPhase 更粗：只表示已经看到过开局相关信号，
// 用于判断“刚刚 game over 后又出现开局信号”时是否自动 reset。
let trackingPhase: TrackingPhase = "waiting"
let hasInGameSignal = false

// drawPileRemaining 是“摸牌堆剩余张数”的独立估计，不完全等价于 remainingTotal：
// remainingTotal 是从可见/已见牌反推，drawPileRemaining 尽量跟协议里的牌堆移动同步。
let drawPileRemaining: number | undefined
let drawPileRemainingSource = ""
// 牌堆剩余是否已“校准”：只有从开局牌表(seedProtocolDeck)起算、或经一次洗牌锚点重置后才为 true。
// 中途接入旁观（未收到开局 52 张牌表）时为 false，此时累加值仅供参考、不可信，UI 标注“未校准”。
let drawPileCalibrated = false
let midGameBaseline = false

// collectorQueued 只管理网络上报合并；DOM 渲染队列由 panelRenderer 管。
// Laya 文本和 WebSocket 帧可能在一秒内触发很多次，直接同步渲染/上报会拖慢游戏页面。
let collectorQueued = false
let lastCollectorPostAt = 0
let collectorSequence = 0
let heartbeatTimer = 0
let lastRenderStateSignature = ""
let customRules: RuleDefinition[] = loadStoredCustomRules(CUSTOM_RULES_STORAGE_KEY)
let activeRuleLibrary: RuleLibrary = createRuleLibrary(customRules)

// localStorage 只存 UI 偏好和用户规则。真正的牌局状态不持久化，
// 避免刷新页面后把上一局的已见牌误带入新页面。
trackerStore.ui.logCollapsed = loadBoolean(LOG_COLLAPSED_STORAGE_KEY, false)
trackerStore.ui.panelWidth = loadNumber(PANEL_WIDTH_STORAGE_KEY, 388, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)
trackerStore.state.ruleConfig.systemRules = systemRuleLibrary.rules
trackerStore.state.ruleConfig.customRules = customRules
const openGroups: Record<string, boolean> = trackerStore.ui.openGroups

const status = trackerStore.state.status

// runtimeUrls 只负责解析扩展资源 URL；一旦扩展上下文失效，停止 collector 心跳，
// 避免旧 content script 在扩展热更新后持续访问 chrome.runtime 造成控制台噪声。
const runtimeUrls = createRuntimeUrlResolver(() => {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = 0
  }
})

const panelRenderer = createPanelRenderer({
  rootId: ROOT_ID,
  handOverlayRootId: HAND_OVERLAY_ROOT_ID,
  trackerStyles,
  appComponent: TrackerApp,
  isTopFrame: IS_TOP_FRAME,
  syncReactiveState,
  bindTrackerActions,
  queueRenderStateSnapshot
})

// 下列数组/Map 是运行时内存索引：
// - displayEvents：底部日志；
// - seenExactCards：当前周期内“实体牌”的可见状态；
// - recent*：诊断/去重窗口；
// - playerLabels/Anchors：把协议座位、文本玩家名、Laya 坐标逐步拼起来，方便诊断归属问题。
const displayEvents = trackerStore.state.displayEvents as DisplayEvent[]
const seenExactCards = trackerStore.state.seenExactCards as ExactSeenCard[]
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
const seatPlayerBindings = new Map<number, SeatPlayerBinding>()
const recentHandProtocolMoves: RecentHandProtocolMove[] = []
const pendingDimengHands = new Map<number, PendingDimengHand>()
let selfSeatId: number | undefined
let selfFigure: number | undefined
// 已确认“我方阵营”（含自己+队友）的玩家 key。队友判定的稳健来源：2v2 日志里凡“带花色的摸牌”，
// 其玩家必是我方（敌方摸牌不下发牌面，服务端反作弊），据此即可解禁，无需依赖座位映射。
const allyPlayerKeys = new Set<string>(["__self__"])
const rawCollectorBuffer: DiagnosticHookRecord[] = []

// 协议 cardId -> DeckCardEntry 的可靠映射预留表。
// 当前版本不会按位置猜花色点数；只有未来拿到权威映射来源时才写入这里。
const protocolCardEntriesById = new Map<number, DeckCardEntry>()
const protocolCardZonesById = new Map<number, number>()
const recentProtocolMoveTimes = new Map<string, number>()
let rawCollectorQueued = false
let lastProtocolDeckSignature = ""

let deckOrderPreviewState: DeckOrderPreviewState = createDeckOrderPreviewState()

// -----------------------------
// 通用小工具与用户规则持久化
// -----------------------------

function refreshRuleLibrary(): void {
  activeRuleLibrary = createRuleLibrary(customRules)
  trackerStore.state.ruleConfig.systemRules = systemRuleLibrary.rules
  trackerStore.state.ruleConfig.customRules = [...customRules]
}

// -----------------------------
// 牌面展示与观星文本解析
// -----------------------------

function suitAssetUrl(suit: string | undefined): string {
  const fileName = suitAssetFileName(suit)
  return fileName ? runtimeUrls.runtimeUrl(`assets/${fileName}`) : ""
}

function cardDescription(name: string): string | undefined {
  return deckProfile.cards.find((card) => card.name === name)?.description
}

function deckOrderPreviewExportCard(card: DeckOrderPreviewCard): DeckOrderPreviewExportCard {
  return {
    cardId: card.cardId,
    ...(card.detail?.name ? { name: card.detail.name } : {}),
    ...(card.detail?.suit ? { suit: card.detail.suit } : {}),
    ...(card.detail?.rank ? { rank: card.detail.rank } : {})
  }
}

function deckOrderPreviewCardLabel(card: DeckOrderPreviewCard): string {
  if (card.detail) {
    return cardFullLabel(card.detail)
  }
  return card.cardId > 0 ? `牌面未捕获 #${card.cardId}` : "牌面未捕获"
}

function deckOrderPreviewCardsTip(label: string, cards: DeckOrderPreviewCard[], hint: string): string {
  const rows = cards.map((card, index) => `${index + 1}. ${deckOrderPreviewCardLabel(card)}`)
  return [label, hint, ...rows].filter(Boolean).join("\n")
}

function stripDeckOrderPreviewPlacementPrefix(content: string): string {
  return content
    .replace(/^\s*(?:[一二三四五六七八九十两\d]+)张(?:卡牌|牌)?/u, "")
    .replace(/^\s*卡牌/u, "")
    .trim()
}

function deckOrderPreviewCardDetailsFromContent(content: string): DeckOrderPreviewCardDetail[] {
  const normalizedContent = normalizeText(stripDeckOrderPreviewPlacementPrefix(content))
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
  const details: DeckOrderPreviewCardDetail[] = []
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

// 处理类似“将 X 张牌置于牌堆顶/底”的公开文本。
// 这类文本可以补齐牌堆顺序预览的牌面详情，但不作为牌堆移动的权威来源；
// 真正的顺序仍以协议里的 FromZone/ToZone/ToPosition 为准。
function ingestDeckOrderPreviewPlacementText(text: string, at: number): boolean {
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
    const details = deckOrderPreviewCardDetailsFromContent(rawContent)
    if (!details.length) {
      continue
    }
    const isTop = match[1] === "顶"
    const displayOrderDetails = isTop && DECK_ORDER_PREVIEW_SOURCE.config.topOrder === "reverse" ? [...details].reverse() : details
    deckOrderPreviewState = addDeckOrderPreviewDetails(
      deckOrderPreviewState,
      DECK_ORDER_PREVIEW_SOURCE.config,
      isTop ? "top" : "bottom",
      displayOrderDetails,
      at
    )
    changed = true
  }
  return changed
}

function totalCards(): number {
  return getDeckTotalCount(deckProfile)
}

// -----------------------------
// 对局模式与生命周期
// -----------------------------

function deckProfileById(id: SupportedGameModeId): typeof deckProfile | undefined {
  return deckProfiles.find((profile) => profile.id === id)
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
  resetDeckOrderPreviewState()
}

function resetRoundCounters(): void {
  status.textCount = 0
  status.protocolCount = 0
  status.gameOverCount = 0
  status.redactedCount = 0
  status.reshuffleCount = 0
  status.lastGameOverAt = 0
}

// 新一局开始时清掉“上一局才有意义”的状态，但保留已经识别/手动锁定的模式。
// options.clearProtocolDeck 用于处理协议明确给出新牌表的情况：此时旧 cardId 映射必须全部作废。
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
  resetDeckOrderPreviewState()
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
  recentHandProtocolMoves.length = 0
  pendingDimengHands.clear()
  lastProtocolDeckSignature = ""
}

function resetDeckOrderPreviewState(): void {
  deckOrderPreviewState = createDeckOrderPreviewState()
}

// 切换模式时会同步切换 deckProfile。注意：这不是单纯改 UI 标签，
// 因为 1v1 / 2v2 的牌堆数量和卡牌集合不同，必须重建 TrackerState。
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

// -----------------------------
// 牌堆计数、精确牌抽取与协议 cardId 映射
// -----------------------------

function cycleRemainingTotal(): number {
  return Math.max(0, totalCards() - seenExactCards.length)
}

function cycleSeenTotal(): number {
  return seenExactCards.length
}

function currentDrawPileRemainingLabel(): string {
  return formatDrawPileRemainingLabel(drawPileRemaining, drawPileCalibrated)
}

function applyRuleDrawPileDecrement(params: Record<string, unknown>, at: number): boolean {
  if (!isDeckActive() || drawPileRemaining === undefined) {
    return false
  }
  const amount = Number(params.amount ?? 1)
  if (!Number.isFinite(amount) || amount <= 0) {
    return false
  }

  const delta = Math.floor(amount)
  const previous = drawPileRemaining
  drawPileRemaining = Math.max(0, drawPileRemaining - delta)
  const reason = typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : "规则动作"
  drawPileRemainingSource = `规则扣减 ${delta} 张：${reason} · ${formatClock(at)}`
  pushDisplayEvent({
    at,
    type: "protocol",
    text: `规则扣减牌堆 ${previous} → ${drawPileRemaining}（${reason}）`
  })
  return true
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

// 从公开文本里抓“带花色点数”的牌，例如 杀♠7、桃♥6。
// 只有带花色点数的文本才会生成 ExactSeenCard；“获得 2 张牌”这种暗牌只走计数逻辑。
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

function protocolCardEntry(cardId: number): DeckCardEntry | undefined {
  // 协议只下发 cardId，不下发花色点数；cardId 与本地牌表数组顺序并不对应。
  // 过去用 cardId-1 / cardId-2001 当数组下标猜花色，是错的（曾把你打出的桃♥6 误判成火杀♥7）。
  // 现在只信任显式建立的映射（protocolCardEntriesById，目前为空，保留以备将来有可靠来源）。
  // 拿不到映射时返回 undefined：协议移动只用于牌堆计数，不点亮具体花色格子。
  return protocolCardEntriesById.get(cardId)
}

// 开局牌表是最可信的校准点：拿到完整 cardIds 后，
// drawPileRemaining 可以从牌表对应的总张数开始扣。当前版本不建立 cardId→花色点数映射，
// 因为协议牌表顺序与本地牌表顺序没有可靠对应关系，宁可少点亮，也不误点亮。
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

// 处理“查看牌堆顶若干张，再放回牌堆顶/底”的协议移动。返回 true 表示已被顺序预览状态机消化。
function handleDeckOrderPreviewMove(
  fromZone: number | undefined,
  toZone: number | undefined,
  toPosition: number | undefined,
  cardIds: number[],
  at: number
): boolean {
  const result = applyDeckOrderPreviewMove(deckOrderPreviewState, DECK_ORDER_PREVIEW_SOURCE.config, {
    fromZone,
    toZone,
    toPosition,
    cardIds,
    at
  })
  deckOrderPreviewState = result.state
  if (result.started) {
    pushDisplayEvent({ at, type: "protocol", text: `${DECK_ORDER_PREVIEW_SOURCE.label}：查看牌堆顶 ${cardIds.length} 张` })
  }
  return result.handled
}

// 摸牌(1→其它)时推进控顶消费：每从牌堆顶摸走 1 张，预览队列头部出列。
function consumeDeckOrderPreviewTopOnDraw(drawnCount: number): void {
  deckOrderPreviewState = consumeDeckOrderPreviewTop(deckOrderPreviewState, drawnCount)
}

// 协议移动如果能解析到实体牌，就把它合并进 seenExactCards。
// 合并规则比“直接 push”复杂，是为了避免同一张牌从暗手牌 -> 公开区时被计两次。
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

function isActiveSeenZone(zone: ExactCardZone): boolean {
  return zone !== "public"
}

function clearSeenCardStateForRecycle(): void {
  // 洗牌只把弃牌堆洗回摸牌堆。仍在场上的公开占用牌（装备区、判定区、武将牌上的“创/雾”等）
  // 以及仍在手里的已知牌都不能回到未见牌池，否则洗牌后会把场上牌误算回牌堆。
  const preserved = seenExactCards.filter((card) => isActiveSeenZone(card.zone))
  trackerState = createInitialTrackerState(deckProfile)
  seenExactCards.length = 0
  protocolCardZonesById.clear()
  recentProtocolMoveTimes.clear()
  exactSourceKeys.clear()
  // 洗牌后牌堆顺序作废，控顶/控底信息失效。
  resetDeckOrderPreviewState()
  // 重新放回保留的场上/手牌占用牌；只有 player-visible 是“已知手牌”，需要重建玩家已知牌计数。
  for (const card of preserved) {
    seenExactCards.push(card)
    exactSourceKeys.add(`${exactCardKey(card)}|${card.zone}|${card.sourceText}`)
    if (card.zone === "player-visible") {
      addKnownCardForExactOwner(card.owner, card.name, 1)
    }
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
      ? `协议同步牌堆剩余 ${currentDrawPileRemainingLabel()} · ${formatClock(at)}`
      : `协议同步牌堆剩余 ${currentDrawPileRemainingLabel()} · ${formatClock(at)}`
    pushDisplayEvent({
      at,
      type: "protocol",
      text: `协议同步牌堆剩余 ${currentDrawPileRemainingLabel()} 张`
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

// 有些协议移动会被 Laya 事件系统重复派发；签名只取影响记牌状态的字段，
// 短时间内同签名视为重复，避免一张牌被扣两次。
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

function rememberHandProtocolMove(move: RecentHandProtocolMove): void {
  if (
    move.fromZone !== HAND_ZONE &&
    move.toZone !== HAND_ZONE &&
    move.fromZone !== TEMP_HAND_ZONE &&
    move.toZone !== TEMP_HAND_ZONE
  ) {
    return
  }
  recentHandProtocolMoves.push(move)
  const cutoff = move.at - 8000
  while (recentHandProtocolMoves.length > 80 || (recentHandProtocolMoves[0]?.at ?? move.at) < cutoff) {
    recentHandProtocolMoves.shift()
  }
}

// 文本里有玩家名，协议里有座位号；两者通常不是同一个事件同时给全。
// recentHandProtocolMoves 是一个短时间窗口：当文本事件到来时，回看附近的手牌协议移动，
// 把“某座位”绑定到“某玩家名/武将名”，后续敌方已知手牌浮窗才知道挂到谁身上。
function parsedEventCardCount(event: Pick<ParsedLogEvent, "cardName" | "cardNames">): number {
  return event.cardNames?.length ?? (event.cardName ? 1 : 0)
}

function findRecentHandMove(
  at: number,
  predicate: (move: RecentHandProtocolMove) => boolean,
  expectedCardCount?: number
): RecentHandProtocolMove | undefined {
  return recentHandProtocolMoves
    .filter((move) => {
      if (move.boundText || Math.abs(at - move.at) > 2500 || !predicate(move)) {
        return false
      }
      return expectedCardCount === undefined || move.cardCount === undefined || move.cardCount === expectedCardCount
    })
    .sort((left, right) => Math.abs(at - left.at) - Math.abs(at - right.at))[0]
}

function bindSeatsFromParsedTextEvent(event: ParsedLogEvent, at: number): boolean {
  if (event.action !== "gainKnown") {
    return false
  }
  const cardCount = parsedEventCardCount(event)
  let changed = false

  if (/从摸牌堆获得/u.test(event.rawText)) {
    const move = findRecentHandMove(
      at,
      (item) => item.fromZone === 1 && item.toZone === HAND_ZONE && item.toId !== undefined,
      cardCount
    )
    if (move) {
      changed = bindSeatToPlayer(move.toId ?? move.srcSeatId, event.playerName, at, "text-deck-gain") || changed
      move.boundText = true
    }
  }

  if (event.sourcePlayerName && /手牌区.*获得/u.test(event.rawText)) {
    const directMove = findRecentHandMove(
      at,
      (item) => item.fromZone === HAND_ZONE && item.toZone === HAND_ZONE && item.fromId !== undefined && item.toId !== undefined,
      cardCount
    )
    if (directMove) {
      changed = bindSeatToPlayer(directMove.fromId, event.sourcePlayerName, at, "text-hand-transfer-source") || changed
      changed = bindSeatToPlayer(directMove.toId ?? directMove.srcSeatId, event.playerName, at, "text-hand-transfer-target") || changed
      directMove.boundText = true
    } else {
      const sourceMove = findRecentHandMove(
        at,
        (item) => item.fromZone === HAND_ZONE && item.fromId !== undefined && item.toZone !== 2,
        cardCount
      )
      const targetMove = findRecentHandMove(
        at,
        (item) =>
          item.toZone === HAND_ZONE &&
          item.toId !== undefined &&
          (!sourceMove?.spellId || !item.spellId || item.spellId === sourceMove.spellId),
        cardCount
      )
      if (sourceMove || targetMove) {
        changed = bindSeatToPlayer(sourceMove?.fromId, event.sourcePlayerName, at, "text-hand-transfer-source") || changed
        changed = bindSeatToPlayer(targetMove?.toId ?? targetMove?.srcSeatId, event.playerName, at, "text-hand-transfer-target") || changed
        if (sourceMove) {
          sourceMove.boundText = true
        }
        if (targetMove) {
          targetMove.boundText = true
        }
      }
    }
  }

  return changed
}

// -----------------------------
// 已知手牌与特殊手牌转移
// -----------------------------

function knownCardTotal(cards: Record<CardName, number>): number {
  return Object.values(cards).reduce((sum, count) => sum + Math.max(0, count), 0)
}

// 缔盟会把一名玩家整把手牌先移动到临时区，再放到另一名玩家手里。
// 对记牌器来说，这意味着“已知手牌 owner”要跟着换，而不是把旧 owner 的牌清掉。
function takeDimengKnownHand(fromSeatId: number | undefined, at: number): boolean {
  const binding = seatBinding(fromSeatId)
  if (!binding || fromSeatId === undefined || pendingDimengHands.has(fromSeatId)) {
    return false
  }
  const cards = takeKnownCardsByOwnerKey(binding.key)
  const exactCards = takeVisibleExactCardsByOwnerKey(binding.key)
  pendingDimengHands.set(fromSeatId, {
    ownerKey: binding.key,
    ownerLabel: binding.label,
    cards,
    exactCards,
    at
  })
  return knownCardTotal(cards) > 0 || exactCards.length > 0
}

function placeDimengKnownHand(fromSeatId: number | undefined, toSeatId: number | undefined, at: number): boolean {
  if (fromSeatId === undefined) {
    return false
  }
  const pending = pendingDimengHands.get(fromSeatId)
  const target = seatBinding(toSeatId)
  if (!pending || !target) {
    return false
  }
  pendingDimengHands.delete(fromSeatId)
  addKnownCardsToOwnerKey(target.key, pending.cards)
  restoreVisibleExactCardsForOwner(pending.exactCards, target.label, at, "协议缔盟交换手牌")

  const total = knownCardTotal(pending.cards) + pending.exactCards.length
  if (total > 0) {
    pushDisplayEvent({
      at,
      type: "protocol",
      text: `缔盟：${pending.ownerLabel} 的 ${total} 张已知手牌转至 ${target.label}`
    })
    return true
  }
  return false
}

function handleDimengKnownHandMove(move: RecentHandProtocolMove): boolean {
  if (move.spellId !== DIMENG_SPELL_ID || move.moveType !== 11) {
    return false
  }
  if (move.fromZone === HAND_ZONE && move.toZone === TEMP_HAND_ZONE) {
    return takeDimengKnownHand(move.fromId, move.at)
  }
  if (move.fromZone === TEMP_HAND_ZONE && move.toZone === HAND_ZONE) {
    return placeDimengKnownHand(move.fromId, move.toId, move.at)
  }
  return false
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

// 原始协议入口。这里尽量只做“协议字段 -> 运行时状态”的转换：
// - GAME_OVER/ShowFigure：维护座位/阵营注册表；
// - MsgGamePlayCardNtf：识别完整牌表和新局；
// - PubGsCMoveCard：处理摸牌堆、观星、洗牌、缔盟和可见实体牌。
// 文本解析不会走这里，避免把协议可信度和页面文案混在一起。
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
  const spellId = numberValue(msg.SpellID)
  const handMove: RecentHandProtocolMove = {
    at: record.at,
    ...(fromZone !== undefined ? { fromZone } : {}),
    ...(toZone !== undefined ? { toZone } : {}),
    ...(moveType !== undefined ? { moveType } : {}),
    ...(spellId !== undefined ? { spellId } : {}),
    ...(cardCount !== undefined ? { cardCount } : {}),
    ...(fromId !== undefined ? { fromId } : {}),
    ...(toId !== undefined ? { toId } : {}),
    ...(srcSeatId !== undefined ? { srcSeatId } : {})
  }
  rememberHandProtocolMove(handMove)
  if (cardIds.length || fromZone !== undefined || toZone !== undefined) {
    changed = ensureRoundActiveFromRawProtocol(record, "协议检测到新旁观移动") || changed
  }
  if (fromZone === 2 && toZone === 9 && moveType === 255) {
    return recycleProtocolDiscardPile(record.at, cardCount)
  }
  // 牌堆顺序预览暂存区进出：记录控顶/控底，再交给牌堆计数（1→暂存出、暂存→1 入，净额为 0）。
  if (handleDeckOrderPreviewMove(fromZone, toZone, toPosition, cardIds, record.at)) {
    changed = updateDrawPileRemainingFromProtocolMove(fromZone, toZone, cardCount, cardIds, record.at) || changed
    return true
  }
  changed = updateDrawPileRemainingFromProtocolMove(fromZone, toZone, cardCount, cardIds, record.at) || changed
  // 普通摸牌(牌堆→非牌堆且非预览暂存区)推进控顶消费：顶部牌被摸走则出列。
  if (fromZone === 1 && toZone !== 1 && toZone !== DECK_ORDER_PREVIEW_SOURCE.config.previewZone && cardIds.length) {
    consumeDeckOrderPreviewTopOnDraw(cardIds.length)
  }
  changed = handleDimengKnownHandMove(handMove) || changed

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

// -----------------------------
// 座位、玩家名、阵营与页面锚点
// -----------------------------

function playerKeyOf(playerName?: string): string | undefined {
  return canonicalPlayerKey(playerName)
}

function resetSeatRegistry(): void {
  seatRegistry.clear()
  seatPlayerBindings.clear()
  pendingDimengHands.clear()
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
    if (p.generalName) {
      bindSeatToPlayer(p.seatId, p.generalName, Date.now(), "protocol-roster")
    }
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

function playerLabelForKey(playerKey: string): string {
  return playerLabelsByKey.get(playerKey) ?? (playerKey === "__self__" ? "您" : playerKey)
}

function bindSeatToPlayer(seatId: number | undefined, playerName: string | undefined, at: number, source: string): boolean {
  if (seatId === undefined || seatId < 0 || seatId === 255) {
    return false
  }
  const key = rememberPlayerLabel(playerName)
  if (!key) {
    return false
  }
  const label = playerLabelForKey(key)
  const previous = seatPlayerBindings.get(seatId)
  if (previous?.key === key) {
    seatPlayerBindings.set(seatId, { ...previous, label, at, source })
    return false
  }
  seatPlayerBindings.set(seatId, { key, label, at, source })

  const existing = seatRegistry.get(seatId) ?? { seatId }
  seatRegistry.set(seatId, {
    ...existing,
    generalName: label,
    ...(key === "__self__" ? { isSelf: true } : {})
  })
  if (key === "__self__") {
    selfSeatId = seatId
    const self = seatRegistry.get(seatId)
    if (self?.figure !== undefined) {
      selfFigure = self.figure
    }
  }
  return true
}

function seatBinding(seatId: number | undefined): SeatPlayerBinding | undefined {
  if (seatId === undefined || seatId < 0 || seatId === 255) {
    return undefined
  }
  const binding = seatPlayerBindings.get(seatId)
  if (binding) {
    return binding
  }
  const info = seatRegistry.get(seatId)
  const key = playerKeyOf(info?.isSelf ? "您" : info?.generalName)
  if (!key) {
    return undefined
  }
  const label = playerLabelsByKey.get(key) ?? info?.generalName ?? key
  return { key, label, at: 0, source: "seat-registry" }
}

// Laya stage 里采到的“候选玩家名”可能带“您”、空白或装饰符。
// 归一化后再和 playerLabelsByKey 匹配，降低玩家名显示差异造成的锚点匹配失败。
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

  if (zone !== "player-visible" && seenExactCards.some((item) => isActiveSeenZone(item.zone) && exactCardKey(item) === key)) {
    return true
  }
  if (zone === "player-visible" && seenExactCards.some((item) => exactCardKey(item) === key)) {
    return true
  }

  const maxCopies = exactDeckCount(card)
  const existingCopies = seenExactCards.filter((item) => exactCardKey(item) === key).length
  return maxCopies === 0 || existingCopies < maxCopies
}

function isDelayedTrickCard(cardName: string | undefined): boolean {
  return Boolean(cardName && delayedTrickNames.has(cardName as CardName))
}

function eventHasDelayedTrick(event: Pick<ParsedLogEvent, "cardName" | "cardNames">): boolean {
  return Boolean(event.cardNames?.some(isDelayedTrickCard) || isDelayedTrickCard(event.cardName))
}

function isSkillPileText(text: string): boolean {
  if (/弃置|使用|打出|装备|获得/.test(text)) {
    return false
  }
  return /(?:不屈|创|大雾|狂风|雾|武将牌上|武将牌旁|置于.+?牌上|称为|作为)/u.test(text)
}

function fieldOwnerFromText(text: string): string | undefined {
  return text.match(/^(.+?)(?:发动|的|将|亮出|展示|置于|翻开)/u)?.[1]?.trim()
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
  if (event.action === "use" && eventHasDelayedTrick(event)) {
    return "judge-area"
  }
  if (isSkillPileText(event.rawText)) {
    return "skill-pile"
  }
  // 装备牌进装备区：牌面公开、且“仍在场上”，洗牌时不应被清除（装备不参与洗牌）。
  // 单列 equip 区与 public（打出/弃置，进弃牌堆）区分，供洗牌重置时保留。
  if (event.action === "equip") {
    return "equip"
  }
  return "public"
}

function exactEventOwner(event: ParsedLogEvent, zone: ExactCardZone): string | undefined {
  if (zone === "judge-area") {
    return event.targetName ?? event.playerName
  }
  if (zone === "equip") {
    return event.targetName ?? event.playerName
  }
  if (zone === "skill-pile") {
    return fieldOwnerFromText(event.rawText) ?? event.playerName
  }
  return event.playerName
}

function exactTokensForEvent(event: ParsedLogEvent, at: number): ExactSeenCard[] {
  return extractExactSeenCards(event.rawText, at)
}

// -----------------------------
// 文本事件落库：ParsedLogEvent -> TrackerState / seenExactCards
// -----------------------------

function hasExactTokenForEvent(event: ParsedLogEvent, at: number): boolean {
  return exactTokensForEvent(event, at).length > 0
}

function addKnownCardForOwnerKey(ownerKey: string | undefined, cardName: CardName, delta: number): void {
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

function addKnownCardForExactOwner(owner: string | undefined, cardName: CardName, delta: number): void {
  addKnownCardForOwnerKey(playerKeyOf(owner), cardName, delta)
}

function cloneKnownCardCounts(counts: Record<CardName, number> | undefined): Record<CardName, number> {
  return Object.fromEntries(Object.entries(counts ?? {}).filter(([, count]) => count > 0)) as Record<CardName, number>
}

function takeKnownCardsByOwnerKey(ownerKey: string): Record<CardName, number> {
  const cards = cloneKnownCardCounts(trackerState.knownCardsByPlayer[ownerKey])
  delete trackerState.knownCardsByPlayer[ownerKey]
  return cards
}

function addKnownCardsToOwnerKey(ownerKey: string, cards: Record<CardName, number>): void {
  for (const [cardName, count] of Object.entries(cards) as Array<[CardName, number]>) {
    if (count > 0) {
      addKnownCardForOwnerKey(ownerKey, cardName, count)
    }
  }
}

function takeVisibleExactCardsByOwnerKey(ownerKey: string): ExactSeenCard[] {
  const cards: ExactSeenCard[] = []
  for (let index = seenExactCards.length - 1; index >= 0; index -= 1) {
    const card = seenExactCards[index]
    if (card?.zone !== "player-visible" || playerKeyOf(card.owner) !== ownerKey) {
      continue
    }
    seenExactCards.splice(index, 1)
    cards.unshift({ ...card })
  }
  return cards
}

function restoreVisibleExactCardsForOwner(cards: ExactSeenCard[], ownerLabel: string, at: number, sourceText: string): void {
  for (const card of cards) {
    seenExactCards.push({
      ...card,
      owner: ownerLabel,
      zone: "player-visible",
      at,
      sourceText,
      pulseAt: at
    })
  }
  if (seenExactCards.length > 360) {
    seenExactCards.splice(0, seenExactCards.length - 360)
  }
}

// 把一张精确牌写入 seenExactCards。这个函数是“去重/迁移”的核心：
// - 同一张手牌被看见后又被打出，要从 player-visible 迁到 public；
// - 装备/判定/技能牌堆属于场上占用，洗牌时不能清除；
// - 若已经达到牌堆里该花色点数的最大副本数，则拒绝重复写入。
function upsertExactCardState(card: ExactSeenCard, zone: ExactSeenCard["zone"], event: ParsedLogEvent): boolean {
  const key = exactCardKey(card)
  const sourceKey = `${key}|${zone}|${event.rawText}`
  const owner = exactEventOwner(event, zone)
  rememberPlayerLabel(owner)
  if (!canAcceptExactCardState(card, zone, event.rawText)) {
    return false
  }
  exactSourceKeys.add(sourceKey)

  if (zone !== "player-visible") {
    const active = seenExactCards.find((item) => isActiveSeenZone(item.zone) && exactCardKey(item) === key)
    if (active) {
      // 离开暗手牌或场上占用区进入公开/装备/判定/技能牌堆时，旧占用要迁移而非新增一张。
      if (active.zone === "player-visible") {
        addKnownCardForExactOwner(active.owner, active.name, -1)
      }
      active.zone = zone
      active.at = card.at
      active.sourceText = event.rawText
      if (owner) {
        active.owner = owner
      } else {
        delete active.owner
      }
      active.pulseAt = card.at
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
      if (owner) {
        existing.owner = owner
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
    ...(owner ? { owner } : {})
  })
  if (seenExactCards.length > 360) {
    seenExactCards.splice(0, seenExactCards.length - 360)
  }
  return true
}

// 一个文本事件可能包含多张精确牌。shared 的 applyEvent 以单牌事件为主，
// 所以这里把多牌事件拆成多个 synthetic ParsedLogEvent 再逐个应用。
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

function activeJudgeResolution(text: string): { owner?: string; cardName: CardName } | undefined {
  const match = text.match(/^(.+?)的(乐不思蜀|兵粮寸断|闪电)(?:判定结果是|生效|失效|判定)/u)
  if (!match?.[2]) {
    return undefined
  }
  return {
    ...(match[1]?.trim() ? { owner: match[1].trim() } : {}),
    cardName: match[2] as CardName
  }
}

function moveActiveJudgeCardToPublic(text: string, at: number): boolean {
  const resolution = activeJudgeResolution(text)
  if (!resolution) {
    return false
  }
  const ownerKey = playerKeyOf(resolution.owner)
  const card = seenExactCards.find((item) => {
    if (item.zone !== "judge-area" || item.name !== resolution.cardName) {
      return false
    }
    return !ownerKey || playerKeyOf(item.owner) === ownerKey
  })
  if (!card) {
    return false
  }
  card.zone = "public"
  card.at = at
  card.sourceText = text
  card.pulseAt = at
  return true
}

function skillPileEventId(ownerKey: string, token: ExactSeenCard, index: number): string {
  return `skill-pile:${ownerKey}:${index}:${token.name}:${token.suit ?? ""}:${token.rank ?? ""}`
}

function ingestSkillPileExactText(text: string, at: number): boolean {
  if (!isSkillPileText(text)) {
    return false
  }
  const tokens = extractExactSeenCards(text, at)
  if (!tokens.length) {
    return false
  }
  const owner = fieldOwnerFromText(text)
  const ownerKey = playerKeyOf(owner)
  if (!owner || !ownerKey) {
    return false
  }

  let changed = false
  tokens.forEach((token, index) => {
    const syntheticEvent: ParsedLogEvent = {
      id: skillPileEventId(ownerKey, token, index),
      rawText: text,
      normalizedText: text,
      normalizedRawText: text,
      playerName: owner,
      action: "judge",
      cardName: token.name,
      confidence: 1,
      source: "hook",
      status: "accepted",
      quality: "strict",
      autoAcceptable: true,
      suit: token.suit,
      rank: token.rank,
      fingerprint: `skill-pile|${text}|${token.name}${token.suit}${token.rank}`,
      createdAt: new Date(at).toISOString()
    }
    changed = upsertExactCardState(token, "skill-pile", syntheticEvent) || changed
  })
  if (changed) {
    pushDisplayEvent({
      at,
      type: "text",
      text
    })
  }
  return changed
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

// “展示/观看手牌”是一个快照事件：它告诉我们某个玩家此刻手里有哪些牌。
// 所以同一 owner 的旧展示快照要先移除，再用最新文本重建，避免旧手牌残留。
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

// -----------------------------
// Vue 展示层 ViewModel 构造
// -----------------------------

function exactZoneLabel(state: ExactCardZone | "remaining"): string {
  if (state === "public") {
    return "弃牌/公开区"
  }
  if (state === "player-visible") {
    return "玩家已见"
  }
  if (state === "equip") {
    return "装备区"
  }
  if (state === "judge-area") {
    return "判定区"
  }
  if (state === "skill-pile") {
    return "武将牌上"
  }
  return "未见"
}

// 把 DeckCardEntry + 当前状态转换成单个小格子的展示数据。
// Vue 组件不再关心业务状态，只根据 state/isRed/pulsing/title 渲染样式。
function chipView(card: DeckCardEntry, state: ExactCardZone | "remaining", index: number, pulsing: boolean): CardChipView {
  const zoneName = exactZoneLabel(state)
  return {
    key: `${card.name}:${card.suit ?? ""}:${card.rank ?? ""}:${index}:${state}`,
    label: card.rank || cardChipLabel(card),
    title: `${cardTooltip(card, state === "player-visible" ? "玩家已见" : state === "remaining" ? "未见" : "公开区")} · ${zoneName} #${index + 1}`,
    suitIconUrl: suitAssetUrl(card.suit),
    suitSymbol: suitSymbol(card.suit),
    state,
    isRed: isRedSuit(card.suit),
    pulsing
  }
}

// 一行牌可能有多张同名不同花色点数的实体牌。这里把 seenExactCards 映射回 deckProfile
// 里的变体下标，保证“哪一张已见/哪一张闪烁”尽量稳定。
function chipViews(card: DeckCardRow): { chips: CardChipView[]; overflowCount: number } {
  const maxVisible = 48
  const exactSeen = seenExactCards.filter((item) => item.name === card.name)
  const variants = card.variants.length ? card.variants : Array.from({ length: card.count }, (_, index) => fallbackVariant(card, index))
  const seenVariantStates = new Map<number, ExactCardZone>()
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

  return {
    chips: visibleVariants.map((item, displayIndex) => {
      const state = seenVariantStates.get(item.index) ?? "remaining"
      return chipView(item.variant, state, displayIndex, seenVariantPulse.has(item.index) && state !== "remaining")
    }),
    overflowCount: Math.max(0, variants.length - visibleVariants.length)
  }
}

function cardGroupView(type: NonNullable<DeckCardEntry["type"]>, label: string): CardGroupView {
  const cards = groupCards(type)
  const remaining = cards.reduce((sum, card) => sum + Math.max(0, card.count - exactSeenCountByName(card.name)), 0)
  const open = openGroups[type] !== false
  return {
    type,
    label,
    cardCount: cards.length,
    remaining,
    open,
    rows: cards.map((card) => {
      const seen = exactSeenCountByName(card.name)
      const left = Math.max(0, card.count - seen)
      const chips = chipViews(card)
      return {
        name: card.name,
        seen,
        left,
        exhausted: left <= 0,
        chips: chips.chips,
        overflowCount: chips.overflowCount
      }
    })
  }
}

// 敌方已知手牌列表（面板内固定区域，不依赖屏幕坐标）。
// 只列“敌方”：自己和队友的牌牌局内本就可见，无需在此重复。
// 数据源直接取 seenExactCards 里仍处于 player-visible（暗手牌/被我看到的手牌/获得的判定牌）
// 且 owner 为敌方的牌——而非 knownCardsByPlayer 粗计数表。后者由 shared tracker 维护，
// 展示手牌/获得判定牌等合成事件不会往里 +1，会导致敌方面板漏显（曾出现过河拆桥看了对方
// 整手牌却不显示）。改为直接读 seenExactCards 后，敌人把该牌打出/弃置时其 zone 会转 public，
// 自然从面板消失，无需额外同步。
function enemyKnownHandsView(): EnemyHandView[] {
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

  const rows: EnemyHandView[] = []
  for (const [ownerKey, { label, cards }] of byOwnerKey.entries()) {
    if (!cards.length) {
      continue
    }
    rows.push({
      key: ownerKey,
      label,
      count: cards.length,
      cards: cards.slice(0, 16).map(knownHandChipView),
      moreCount: Math.max(0, cards.length - 16)
    })
  }
  return rows
}

type CurrentKnownCard = {
  name: CardName
  suit?: string
  rank?: string
}

function knownHandChipView(card: CurrentKnownCard): EnemyKnownCardView {
  const description = cardDescription(card.name)
  return {
    key: `${card.name}:${card.suit ?? ""}:${card.rank ?? ""}`,
    nameLabel: handCardNameLabel(card.name),
    rankLabel: card.rank ?? "",
    title: cardTooltip(
      {
        name: card.name,
        ...(card.suit ? { suit: card.suit } : {}),
        ...(card.rank ? { rank: card.rank } : {}),
        ...(description ? { description } : {})
      },
      "玩家已见"
    ),
    suitIconUrl: suitAssetUrl(card.suit),
    suitSymbol: suitSymbol(card.suit),
    isRed: isRedSuit(card.suit),
    hasMeta: Boolean(card.suit || card.rank)
  }
}

function emptyDeckOrderPreviewView(): DeckOrderPreviewView {
  return {
    visible: false,
    heading: "",
    title: "",
    topCount: 0,
    topTitle: "",
    bottomCount: 0,
    bottomTitle: ""
  }
}

function deckOrderPreviewView(): DeckOrderPreviewView {
  const topCount = deckOrderPreviewState.top.length
  const bottomCount = deckOrderPreviewState.bottom.length
  const source = DECK_ORDER_PREVIEW_SOURCE
  return {
    visible: topCount > 0 || bottomCount > 0,
    heading: source.heading,
    title: `${source.titlePrefix}：查看过 ${deckOrderPreviewState.peekCount} 张；悬浮顶/底数字可看已捕获牌面`,
    topCount,
    topTitle: topCount > 0
      ? deckOrderPreviewCardsTip(source.topTipLabel, deckOrderPreviewState.top, "按摸牌顺序排列，1 即下一张摸牌")
      : "",
    bottomCount,
    bottomTitle: bottomCount > 0
      ? deckOrderPreviewCardsTip(source.bottomTipLabel, deckOrderPreviewState.bottom, "本轮一般摸不到，洗牌后失效")
      : ""
  }
}

// content.ts 内部状态比较复杂；Vue 只消费这个快照。
// 这样 UI 组件保持“纯展示”，业务决策集中在 content.ts，调试时也可以直接导出 snapshot 看全貌。
function buildTrackerSnapshot(): TrackerSnapshot {
  const deckActive = isDeckActive()
  return buildTrackerSnapshotView({
    contentVersion: CONTENT_VERSION,
    hookVersion: status.hookVersion,
    trackingPhase,
    hasInGameSignal,
    ...(gameModeId ? { gameModeId } : {}),
    gameModeSource,
    deckProfileSource,
    ...(drawPileRemaining !== undefined ? { drawPileRemaining } : {}),
    drawPileRemainingSource,
    drawPileCalibrated,
    midGameBaseline,
    status,
    deckActive,
    totalCards: totalCards(),
    cycleRemainingTotal: cycleRemainingTotal(),
    cycleSeenTotal: cycleSeenTotal(),
    groups: deckActive
      ? [cardGroupView("basic", "基本牌"), cardGroupView("trick", "锦囊牌"), cardGroupView("equip", "装备牌")]
      : [],
    enemyHands: deckActive ? enemyKnownHandsView() : [],
    deckOrderPreview: deckActive ? deckOrderPreviewView() : emptyDeckOrderPreviewView(),
    events: buildEventLogRows(displayEvents)
  })
}

// Vue store 是 reactive 对象，不能整棵随意替换深层业务状态。
// 这里把模块级变量同步进 store，再用 replaceTrackerSnapshot 增加 revision 触发 UI 更新。
function syncReactiveState(): void {
  trackerStore.state.trackingPhase = trackingPhase
  trackerStore.state.hasInGameSignal = hasInGameSignal
  trackerStore.state.gameModeId = gameModeId
  trackerStore.state.gameModeSource = gameModeSource
  trackerStore.state.deckProfileSource = deckProfileSource
  trackerStore.state.drawPileRemaining = drawPileRemaining
  trackerStore.state.drawPileRemainingSource = drawPileRemainingSource
  trackerStore.state.drawPileCalibrated = drawPileCalibrated
  trackerStore.state.midGameBaseline = midGameBaseline
  trackerStore.state.trackerState = trackerState
  replaceTrackerSnapshot(buildTrackerSnapshot())
}

function renderPanel(): void {
  panelRenderer.renderPanel()
}

function queueRender(): void {
  panelRenderer.queueRender()
}

function bindTrackerActions(): void {
  trackerActions.collapse = () => {
    trackerStore.ui.collapsed = true
    queueRender()
  }
  trackerActions.expand = () => {
    trackerStore.ui.collapsed = false
    queueRender()
  }
  trackerActions.toggleListen = () => {
    status.listening = !status.listening
    queueRender()
  }
  trackerActions.reset = () => {
    resetTracker({ preserveMode: true })
    queueRender()
  }
  trackerActions.exportJson = () => {
    void exportJson()
  }
  trackerActions.openRuleConfig = () => {
    trackerStore.ui.ruleConfigOpen = true
    refreshRuleLibrary()
    queueRender()
  }
  trackerActions.closeRuleConfig = () => {
    trackerStore.ui.ruleConfigOpen = false
    trackerStore.state.ruleConfig.lastError = ""
    queueRender()
  }
  trackerActions.saveCustomRule = (incomingRule: RuleDefinition) => {
    try {
      const rule = prepareCustomRule(incomingRule)
      const existingIndex = customRules.findIndex((item) => item.id === rule.id)
      customRules =
        existingIndex >= 0
          ? customRules.map((item) => (item.id === rule.id ? rule : item))
          : [...customRules, rule]
      persistStoredCustomRules(CUSTOM_RULES_STORAGE_KEY, customRules)
      refreshRuleLibrary()
      trackerStore.state.ruleConfig.lastError = ""
      trackerStore.state.ruleConfig.lastSavedAt = Date.now()
      pushDisplayEvent({ at: Date.now(), type: "protocol", text: `${existingIndex >= 0 ? "已更新" : "已新增"}规则：${rule.id}` })
      queueRender()
      return true
    } catch (error) {
      trackerStore.state.ruleConfig.lastError = error instanceof Error ? error.message : "规则配置无效"
      queueRender()
      return false
    }
  }
  trackerActions.toggleCustomRule = (ruleId: string, enabled: boolean) => {
    let changed = false
    customRules = customRules.map((rule) => {
      if (rule.id !== ruleId) {
        return rule
      }
      changed = true
      return { ...rule, enabled }
    })
    if (!changed) {
      return
    }
    persistStoredCustomRules(CUSTOM_RULES_STORAGE_KEY, customRules)
    refreshRuleLibrary()
    trackerStore.state.ruleConfig.lastError = ""
    trackerStore.state.ruleConfig.lastSavedAt = Date.now()
    pushDisplayEvent({ at: Date.now(), type: "protocol", text: `${enabled ? "已启用" : "已停用"}规则：${ruleId}` })
    queueRender()
  }
  trackerActions.removeCustomRule = (ruleId: string) => {
    const nextRules = customRules.filter((rule) => rule.id !== ruleId)
    if (nextRules.length === customRules.length) {
      return
    }
    customRules = nextRules
    persistStoredCustomRules(CUSTOM_RULES_STORAGE_KEY, customRules)
    refreshRuleLibrary()
    trackerStore.state.ruleConfig.lastError = ""
    trackerStore.state.ruleConfig.lastSavedAt = Date.now()
    pushDisplayEvent({ at: Date.now(), type: "protocol", text: `已删除规则：${ruleId}` })
    queueRender()
  }
  trackerActions.toggleLog = () => {
    trackerStore.ui.logCollapsed = !trackerStore.ui.logCollapsed
    window.localStorage.setItem(LOG_COLLAPSED_STORAGE_KEY, String(trackerStore.ui.logCollapsed))
    queueRender()
  }
  trackerActions.toggleGroup = (group: string) => {
    openGroups[group] = openGroups[group] === false
    queueRender()
  }
  trackerActions.setMode = (mode: SupportedGameModeId) => {
    manualModeLocked = true
    protocolModeLocked = false
    setGameMode(mode, "手动选择")
    if (trackingPhase !== "ended") {
      hasInGameSignal = true
      trackingPhase = "in-game"
    }
    queueRender()
  }
  trackerActions.setPanelWidth = (width: number, persist = false) => {
    trackerStore.ui.panelWidth = clamp(width, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 16))
    if (persist) {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(trackerStore.ui.panelWidth))
      queueRender()
    }
  }
}

function ensureRoot(): HTMLElement {
  return panelRenderer.ensureRoot()
}

function bindPanelEvents(_root: HTMLElement): void {
  panelRenderer.bindPanelEvents()
}

function queueKnownHandOverlayRender(force = false): void {
  panelRenderer.queueKnownHandOverlayRender(force)
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

// 渲染后的状态变化也会上报 collector，便于比对“内部状态变了但 UI 没变”这类问题。
// signature 只取关键字段和最近实体牌尾巴，避免每次都序列化完整状态。
function queueRenderStateSnapshot(): void {
  const signature = currentStateSignature()
  if (signature === lastRenderStateSignature) {
    return
  }
  lastRenderStateSignature = signature
  queueCollectorSnapshot("render-state", true)
}

// 手动重置入口。preserveMode 用在“上一局结束后又检测到新开局”：
// 保留已识别模式，清空本局牌状态，让用户不必每局重新点模式。
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

// 局末清理比完整 reset 更轻：保留模式和日志里的 game-over 信息，
// 但清掉本局实体牌、座位锚点、协议 cardId 等会污染下一局的状态。
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

// 保存最近 hook 记录用于诊断，同时对 raw 协议单独做短批量上报。
// 这里不改变记牌状态，只维护“可解释性”的证据链。
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

// 导出/collector 使用的快照会比 Vue snapshot 更完整，包含原始诊断窗口和内部状态。
// 面板展示用 buildTrackerSnapshot；复盘问题用 buildExportPayload。
function buildDiagnostics(): CollectorDiagnostics {
  return buildCollectorDiagnostics({
    href: location.href,
    title: document.title,
    pageInstanceId: PAGE_INSTANCE_ID,
    contentVersion: CONTENT_VERSION,
    visibilityState: document.visibilityState,
    isTopFrame: IS_TOP_FRAME,
    hasFocus: document.hasFocus(),
    lastRecordAt: status.lastRecordAt,
    collectorLastPostAt: lastCollectorPostAt,
    collectorSequence,
    recentHookRecords,
    recentRawHookRecords,
    recentRawTextCount: recentRawTexts.length,
    seenStageTextCount: seenStageTexts.size,
    recentTextKeyCount: recentTextTimes.size,
    exactSourceKeyCount: exactSourceKeys.size
  })
}

function buildExportPayload(reason: string): ExportPayload {
  const deckOrderPreview =
    deckOrderPreviewState.top.length || deckOrderPreviewState.bottom.length || deckOrderPreviewState.peekCount
      ? {
          top: deckOrderPreviewState.top.map((card) => card.cardId),
          bottom: deckOrderPreviewState.bottom.map((card) => card.cardId),
          topCards: deckOrderPreviewState.top.map(deckOrderPreviewExportCard),
          bottomCards: deckOrderPreviewState.bottom.map(deckOrderPreviewExportCard),
          peekCount: deckOrderPreviewState.peekCount,
          at: deckOrderPreviewState.at
        }
      : undefined
  return buildCollectorExportPayload({
    reason,
    pageInstanceId: PAGE_INSTANCE_ID,
    sequence: collectorSequence,
    pageUrl: location.href,
    trackingPhase,
    hasInGameSignal,
    ...(gameModeId ? { gameModeId } : {}),
    gameModeSource,
    deckProfile,
    deckProfileSource,
    ...(drawPileRemaining !== undefined ? { drawPileRemaining } : {}),
    drawPileRemainingSource,
    drawPileCalibrated,
    midGameBaseline,
    seatRegistry: Array.from(seatRegistry.values()),
    ...(selfSeatId !== undefined ? { selfSeatId } : {}),
    ...(selfFigure !== undefined ? { selfFigure } : {}),
    allyPlayerKeys: Array.from(allyPlayerKeys),
    playerAnchors: Array.from(playerAnchorsByKey.values()),
    status,
    trackerState,
    seenExactCards: seenExactCards.slice(),
    ...(deckOrderPreview ? { deckOrderPreview } : {}),
    recentEvents: displayEvents.slice(-100),
    diagnostics: buildDiagnostics()
  })
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

// -----------------------------
// HookRecord 分流：文本、协议、生命周期
// -----------------------------

function updateDrawPileRemainingFromText(text: string, at: number, kind: string): boolean {
  void kind
  let changed = false
  if (!gameModeId && !manualModeLocked) {
    changed = maybeSwitchDeckProfileFromText(text) || changed
  }
  if (changed) {
    drawPileRemainingSource = `页面文本只用于模式识别，牌堆数等待协议 · ${formatClock(at)}`
  }
  return changed
}

// Laya 文本 hook 会在 setText、changeText、stage 扫描里多次看到同一行。
// 这里用短时间窗口去重，避免同一条日志重复进 parser。
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

// 文本入口：先做模式/局末/审查处理，再交给 parser 和精确牌兜底逻辑。
// 协议负责牌堆数；文本主要负责“哪些牌对玩家可见”。
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

  changed = moveActiveJudgeCardToPublic(record.text, at) || changed
  changed = ingestDeckOrderPreviewPlacementText(record.text, at) || changed
  // shared parser 负责把自然语言日志转成 GameEvent/ParsedLogEvent。
  // activeRuleLibrary 允许用户补充特殊技能规则，例如“发动集智额外摸牌”。
  const gameEvents = parseGameEvents([{ text: record.text, score: 1 }], "hook", deckProfile)
  let ruleChanged = false
  const parsedEvents = gameEventsToParsedLogEvents(gameEvents, deckProfile, activeRuleLibrary, {
    decrementDrawPile: (params) => {
      ruleChanged = applyRuleDrawPileDecrement(params, at) || ruleChanged
    }
  })
  changed = ruleChanged || changed
  const event = parsedEvents[0]
  if (!event) {
    return ingestSkillPileExactText(record.text, at) || ingestVisibleExactText(record.text, at) || changed
  }
  return ingestParsedTextEvent(event, record, at) || changed
}

// 已解析文本事件的落库入口。只有 strict + autoAcceptable + 带精确花色点数的事件
// 会自动写入 TrackerState；低置信或不支持事件只展示，不强行扣牌。
function ingestParsedTextEvent(event: ParsedLogEvent, record: HookRecord, at: number): boolean {
  let changed = false
  const text = record.text ?? ""
  rememberPlayerLabel(event.playerName)
  rememberPlayerLabel(event.targetName)
  rememberPlayerLabel(event.sourcePlayerName)
  changed = bindSeatsFromParsedTextEvent(event, at) || changed

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
  return ingestSkillPileExactText(text, at) || ingestVisibleExactText(text, at) || changed
}

// summary 级协议事件只用于模式/生命周期识别；真正改变牌状态的是 raw-protocol-event。
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

// 所有 pageHook 消息最终都进入这里。
// 分流顺序很重要：
// 1. lifecycle/anchor 是辅助信号，单独处理；
// 2. protocol-event/raw-protocol-event 优先，因为它们通常比文本更可信；
// 3. raw-ws-frame 只进诊断，不直接参与记牌；
// 4. 剩下才按页面文本解析。
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

// content script 不能直接访问页面 JS 对象（隔离世界），所以要把 pageHook.js
// 作为普通 script 标签注入到页面上下文，再通过 postMessage 建桥。
function injectPageHook(): void {
  if (document.getElementById(HOOK_SCRIPT_ID)) {
    return
  }

  const hookUrl = runtimeUrls.runtimeUrl("pageHook.js")
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

// 页面可能 bfcache 恢复、切前台、扩展重载或网络恢复。
// 这些时机重新注入 hook，确保长期挂着页面时采集链路能自愈。
function reconnectPageHook(reason: string): void {
  if (!runtimeUrls.isContextValid()) {
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

  // 主 frame 才挂 UI；iframe 只负责把自己采到的 hook 消息转发到 top。
  // 这样 all_frames=true 时不会出现多个面板，但 iframe 里的游戏文本/协议仍不会丢。
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
    bindTrackerActions()
    ensureRoot()
    renderPanel()
    queueCollectorSnapshot("content-ready", true)
    startCollectorHeartbeat()
  }
}

bootstrap()
