// 座位↔阵营↔可见牌的纯逻辑（从 content.ts 抽出以便单测）。
//
// 关键依据（经真机 2v2 抓包验证）：
//   - GAME_OVER/MsgGameOver 的 Players[] 含 SeatID / generalNames / Figure；SelfResult.SeatID 标识“您”。
//   - Figure 即阵营编号：同 Figure = 同队。
//   - 2v2 日志里凡“带花色（♠♥♣♦）的摸牌”，其玩家必是我方（自己或队友）——敌方摸牌不下发牌面
//     （服务端反作弊）。据此可在无座位映射时也稳健识别队友并解禁其可见牌。

export type SeatRosterEntry = {
  seatId: number
  generalName?: string
  nickName?: string
  figure?: number
}

/** 是否为“队友/我方带花色摸牌”文本（用于解禁被误审查的队友摸牌记录）。 */
export function isAllyDrawText(text: string | undefined): boolean {
  if (!text) {
    return false
  }
  if (!/从摸牌堆获得/.test(text)) {
    return false
  }
  return /[♠♥♣♦]/.test(text)
}

/** 提取“X从摸牌堆获得…”里的摸牌者 X。 */
export function allyDrawActor(text: string | undefined): string | undefined {
  if (!text) {
    return undefined
  }
  return text.match(/^(.+?)从摸牌堆获得/u)?.[1]?.trim() || undefined
}

/** 给定花名册与自己的座位号，返回“我方阵营”的 Figure（找不到则 undefined）。 */
export function pickSelfFigure(roster: SeatRosterEntry[], selfSeatId: number | undefined): number | undefined {
  if (selfSeatId === undefined) {
    return undefined
  }
  const self = roster.find((entry) => entry.seatId === selfSeatId)
  return self?.figure
}

/**
 * 计算与自己同阵营的座位（含自己）。无 Figure 信息时只含自己。
 * 返回座位号集合，调用方再映射到武将名/玩家 key。
 */
export function allySeatIds(roster: SeatRosterEntry[], selfSeatId: number | undefined): number[] {
  if (selfSeatId === undefined) {
    return []
  }
  const selfFigure = pickSelfFigure(roster, selfSeatId)
  if (selfFigure === undefined) {
    return [selfSeatId]
  }
  return roster.filter((entry) => entry.figure === selfFigure).map((entry) => entry.seatId)
}

/** 与自己同阵营（含自己）的武将名列表。 */
export function allyGeneralNames(roster: SeatRosterEntry[], selfSeatId: number | undefined): string[] {
  const seats = new Set(allySeatIds(roster, selfSeatId))
  return roster
    .filter((entry) => seats.has(entry.seatId) && entry.generalName)
    .map((entry) => entry.generalName as string)
}
