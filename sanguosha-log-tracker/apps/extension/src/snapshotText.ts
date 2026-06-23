import type { EventLogRowView } from "./trackerStore"
import type { DisplayEvent, SupportedGameModeId, TrackingPhase } from "./contentTypes"
import { supportedModeLabel } from "./gameModeSignals"

/**
 * 面板 snapshot 使用的纯文案/格式化工具。
 *
 * 这里不读取 content.ts 的模块级状态，只根据传入参数生成 UI 字符串或轻量行模型。
 * 这样后续真正抽 buildTrackerSnapshot() 时，先有一层稳定的文本工具可复用，避免 snapshot
 * 模块同时承担状态读取、业务判断和文案拼接三件事。
 */

export function formatClock(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--"
}

export function phaseLabel(trackingPhase: TrackingPhase): string {
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

export function drawPileRemainingLabel(remaining: number | undefined, calibrated: boolean): string {
  if (remaining === undefined) {
    return "待协议"
  }
  // 中途接入未校准时，数字仅供参考，加 ~ 前缀提示不可信。
  return calibrated ? String(remaining) : `~${remaining}`
}

export function waitingTitle(trackingPhase: TrackingPhase): string {
  return trackingPhase === "detecting-mode" ? "检测到开局" : "等待开局"
}

export function waitingDetail(
  trackingPhase: TrackingPhase,
  gameModeId: SupportedGameModeId | undefined,
  gameModeSource: string
): string {
  return trackingPhase === "detecting-mode"
    ? gameModeSource
    : gameModeId
      ? `${supportedModeLabel(gameModeId)} · 等待开局信号`
      : "监听页面中，识别到 2v2 或 1v1 后开始记牌"
}

export function eventLogRows(events: DisplayEvent[], limit = 80): EventLogRowView[] {
  return events.slice(-limit).map((item) => ({
    id: item.id,
    type: item.type,
    time: formatClock(item.at),
    text: item.text
  }))
}
