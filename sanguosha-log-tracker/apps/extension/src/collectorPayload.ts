import type { DeckProfile, TrackerState } from "@slt/shared"
import type { StatusState } from "./trackerStore"
import type {
  CollectorDiagnostics,
  DeckOrderPreviewExportCard,
  DiagnosticHookRecord,
  DisplayEvent,
  ExactSeenCard,
  ExportPayload,
  PlayerAnchor,
  SeatInfo,
  SupportedGameModeId,
  TrackingPhase
} from "./contentTypes"
import { supportedModeLabel } from "./gameModeSignals"

/**
 * collector / 手动导出 payload 构造。
 *
 * Vue snapshot 面向面板渲染，而 collector payload 面向离线复盘：它需要更多内部状态、
 * 最近 hook 证据和诊断窗口。这里只负责把调用方传入的数据组装成稳定 JSON 结构，
 * 不发网络、不读写剪贴板，也不修改任何运行时状态。
 */

export function buildCollectorDiagnostics(input: {
  href: string
  title: string
  pageInstanceId: string
  contentVersion: string
  isTopFrame: boolean
  visibilityState: DocumentVisibilityState
  hasFocus: boolean
  lastRecordAt: number
  collectorLastPostAt: number
  collectorSequence: number
  recentHookRecords: DiagnosticHookRecord[]
  recentRawHookRecords: DiagnosticHookRecord[]
  recentRawTextCount: number
  seenStageTextCount: number
  recentTextKeyCount: number
  exactSourceKeyCount: number
  now?: number | undefined
}): CollectorDiagnostics {
  const now = input.now ?? Date.now()
  return {
    href: input.href,
    title: input.title,
    pageInstanceId: input.pageInstanceId,
    contentVersion: input.contentVersion,
    isTopFrame: input.isTopFrame,
    visibilityState: input.visibilityState,
    hasFocus: input.hasFocus,
    lastRecordAgeMs: input.lastRecordAt ? now - input.lastRecordAt : null,
    collectorLastPostAt: input.collectorLastPostAt ? new Date(input.collectorLastPostAt).toISOString() : null,
    collectorPostAgeMs: input.collectorLastPostAt ? now - input.collectorLastPostAt : null,
    collectorSequence: input.collectorSequence,
    recentHookRecords: input.recentHookRecords.slice(-120),
    recentRawHookRecords: input.recentRawHookRecords.slice(-120),
    recentRawTextCount: input.recentRawTextCount,
    seenStageTextCount: input.seenStageTextCount,
    recentTextKeyCount: input.recentTextKeyCount,
    exactSourceKeyCount: input.exactSourceKeyCount
  }
}

export function buildCollectorExportPayload(input: {
  reason: string
  pageInstanceId: string
  sequence: number
  pageUrl: string
  trackingPhase: TrackingPhase
  hasInGameSignal: boolean
  gameModeId?: SupportedGameModeId | undefined
  gameModeSource: string
  deckProfile: DeckProfile
  deckProfileSource: string
  drawPileRemaining?: number | undefined
  drawPileRemainingSource: string
  drawPileCalibrated: boolean
  midGameBaseline: boolean
  seatRegistry: SeatInfo[]
  selfSeatId?: number | undefined
  selfFigure?: number | undefined
  allyPlayerKeys: string[]
  playerAnchors: PlayerAnchor[]
  status: StatusState
  trackerState: TrackerState
  seenExactCards: ExactSeenCard[]
  deckOrderPreview?: {
    top: number[]
    bottom: number[]
    topCards?: DeckOrderPreviewExportCard[]
    bottomCards?: DeckOrderPreviewExportCard[]
    peekCount: number
    at: number
  } | undefined
  recentEvents: DisplayEvent[]
  diagnostics: CollectorDiagnostics
  exportedAt?: string | undefined
}): ExportPayload {
  return {
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    source: "sgs-extension-hook",
    pageInstanceId: input.pageInstanceId,
    sequence: input.sequence,
    reason: input.reason,
    pageUrl: input.pageUrl,
    trackingPhase: input.trackingPhase,
    hasInGameSignal: input.hasInGameSignal,
    ...(input.gameModeId ? { gameModeId: input.gameModeId } : {}),
    gameModeLabel: supportedModeLabel(input.gameModeId),
    gameModeSource: input.gameModeSource,
    deckProfile: input.deckProfile,
    deckProfileSource: input.deckProfileSource,
    drawPileRemainingSource: input.drawPileRemainingSource,
    drawPileCalibrated: input.drawPileCalibrated,
    midGameBaseline: input.midGameBaseline,
    seatRegistry: input.seatRegistry,
    allyPlayerKeys: input.allyPlayerKeys,
    playerAnchors: input.playerAnchors,
    status: { ...input.status },
    trackerState: input.trackerState,
    seenExactCards: input.seenExactCards.slice(),
    exactCardStates: input.seenExactCards.slice(),
    ...(input.deckOrderPreview ? { guanxing: input.deckOrderPreview } : {}),
    recentEvents: input.recentEvents.slice(-100),
    diagnostics: input.diagnostics,
    ...(input.selfSeatId !== undefined ? { selfSeatId: input.selfSeatId } : {}),
    ...(input.selfFigure !== undefined ? { selfFigure: input.selfFigure } : {}),
    ...(input.drawPileRemaining !== undefined ? { drawPileRemaining: input.drawPileRemaining } : {})
  }
}
