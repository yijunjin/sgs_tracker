import type {
  CardGroupView,
  DeckOrderPreviewView,
  EnemyHandView,
  EventLogRowView,
  StatusState,
  TrackerSnapshot
} from "./trackerStore"
import type { SupportedGameModeId, TrackingPhase } from "./contentTypes"
import { supportedModeLabel } from "./gameModeSignals"
import {
  drawPileRemainingLabel,
  phaseLabel,
  waitingDetail,
  waitingTitle
} from "./snapshotText"

/**
 * Vue 面板 snapshot 构造器。
 *
 * content.ts 里的运行时状态很多、来源也不同；Vue 组件不应该理解这些细节。
 * 这个模块只接收“已经算好的业务值/视图分组”，统一拼成 TrackerSnapshot。
 * 它不读取全局状态、不调用 DOM，也不修改 trackerStore，因此后续可以继续把更多 ViewModel
 * 构造逻辑迁到这里，逐步让 content.ts 只负责事件编排。
 */

export type BuildTrackerSnapshotInput = {
  contentVersion: string
  hookVersion: string
  trackingPhase: TrackingPhase
  hasInGameSignal: boolean
  gameModeId?: SupportedGameModeId | undefined
  gameModeSource: string
  deckProfileSource: string
  drawPileRemaining?: number | undefined
  drawPileRemainingSource: string
  drawPileCalibrated: boolean
  midGameBaseline: boolean
  status: StatusState
  deckActive: boolean
  totalCards: number
  cycleRemainingTotal: number
  cycleSeenTotal: number
  groups: CardGroupView[]
  enemyHands: EnemyHandView[]
  deckOrderPreview: DeckOrderPreviewView
  events: EventLogRowView[]
}

export function buildTrackerSnapshotView(input: BuildTrackerSnapshotInput): TrackerSnapshot {
  const modeLabel = supportedModeLabel(input.gameModeId)
  const phaseText = phaseLabel(input.trackingPhase)
  const currentDrawPileLabel = drawPileRemainingLabel(input.drawPileRemaining, input.drawPileCalibrated)
  const connectionLabel = `${input.trackingPhase === "ended" ? "已结束" : input.status.listening ? "监听中" : "已暂停"} · ${phaseText}`
  const connectionClass = input.status.listening && input.trackingPhase !== "waiting" ? "is-live" : "is-paused"
  const baselineText = input.midGameBaseline ? "中途接入" : "从开局统计"
  const versionLabel = `${input.contentVersion.replace("extension-content-", "")}${
    input.hookVersion ? ` · ${input.hookVersion.replace("extension-public-hook-", "")}` : ""
  }`
  const displayedRemainingSource =
    `协议牌堆剩余 ${currentDrawPileLabel}；未见实体牌 ${input.cycleRemainingTotal}；${input.drawPileRemainingSource || "等待协议牌堆信号"}`
  const countWaiting = !input.deckActive || input.drawPileRemaining === undefined

  return {
    contentVersion: input.contentVersion,
    hookVersion: input.hookVersion,
    trackingPhase: input.trackingPhase,
    hasInGameSignal: input.hasInGameSignal,
    ...(input.gameModeId ? { gameModeId: input.gameModeId } : {}),
    gameModeLabel: modeLabel,
    gameModeSource: input.gameModeSource,
    deckProfileSource: input.deckProfileSource,
    connectionLabel,
    connectionClass,
    phaseLabel: phaseText,
    baselineText,
    versionLabel,
    countTitle: input.deckActive ? displayedRemainingSource : input.gameModeSource,
    countText: input.deckActive && input.drawPileRemaining !== undefined
      ? `${input.drawPileCalibrated ? "" : "~"}${input.drawPileRemaining}`
      : "--",
    ...(input.deckActive && input.drawPileRemaining !== undefined ? { countTotal: input.totalCards } : {}),
    countWaiting,
    isDeckActive: input.deckActive,
    totalCards: input.totalCards,
    cycleRemainingTotal: input.cycleRemainingTotal,
    cycleSeenTotal: input.cycleSeenTotal,
    drawPileRemainingLabel: currentDrawPileLabel,
    ...(input.drawPileRemaining !== undefined ? { drawPileRemaining: input.drawPileRemaining } : {}),
    drawPileCalibrated: input.drawPileCalibrated,
    midGameBaseline: input.midGameBaseline,
    status: { ...input.status },
    groups: input.groups,
    enemyHands: input.enemyHands,
    deckOrderPreview: input.deckOrderPreview,
    events: input.events,
    waitingTitle: waitingTitle(input.trackingPhase),
    waitingDetail: waitingDetail(input.trackingPhase, input.gameModeId, input.gameModeSource)
  }
}
