import type { HookRecord, SupportedGameModeId } from "./contentTypes"

/**
 * 对局模式和生命周期信号识别。
 *
 * 这里故意只返回“识别结果”，不修改任何运行时状态。模式锁、TrackerState 重建、
 * gameModeSource 文案这些副作用仍由 content.ts 编排，避免纯识别工具反向依赖主状态。
 */

export function supportedModeLabel(id: SupportedGameModeId | undefined): string {
  if (id === "sgs-1v1") {
    return "1v1"
  }
  if (id === "sgs-happy-2v2") {
    return "欢乐 2v2"
  }
  return "未识别"
}

// 文本模式识别是弱信号：页面标题/模式文字可能短暂出现或重复出现。
// 是否接受这个结果由 content.ts 根据手动锁/协议锁决定。
export function detectGameModeIdFromText(text: string): SupportedGameModeId | undefined {
  const normalized = text.replace(/\s+/g, "").toLowerCase()
  if (/1v1|新1v1|一对一|一战到底/.test(normalized)) {
    return "sgs-1v1"
  }
  if (/2v2|二对二|欢乐成双|欢乐军争|欢乐2v2|欢乐/.test(normalized)) {
    return "sgs-happy-2v2"
  }
  return undefined
}

// 协议模式识别是强信号，优先从 Mode/Room/GameType 等字段里找。
// pageHook.js 只做轻量 summary，content.ts 才决定是否切换具体 deckProfile。
export function detectGameModeIdFromRecord(record: HookRecord): SupportedGameModeId | undefined {
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

export function looksLikeInGameStart(record: HookRecord): boolean {
  if (record.kind === "protocol-event") {
    return Boolean(record.eventType && /MsgGameTurnNtf|GsCGamephaseNtf|MsgActionStateNtf/.test(record.eventType))
  }
  return Boolean(record.text && /剩余牌|牌堆|牌库|第\s*\d+\s*轮|出牌阶段|摸牌阶段|判定阶段/.test(record.text))
}

export function looksLikeGameOverText(text: string | undefined): boolean {
  if (!text) {
    return false
  }
  const normalized = text.replace(/\s+/g, "")
  return (
    /牌局结束|游戏结束|战斗结束|最后结算|点击空白处关闭|熟练度|银两/.test(normalized) ||
    (normalized.length <= 4 && /^(胜利|失败|平局)$/.test(normalized))
  )
}
