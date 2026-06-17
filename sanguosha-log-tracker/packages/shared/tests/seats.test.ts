import { describe, expect, it } from "vitest"

import {
  allyDrawActor,
  allyGeneralNames,
  allySeatIds,
  isAllyDrawText,
  pickSelfFigure,
  type SeatRosterEntry
} from "../src/seats"

// 真机 2v2 花名册：Seat0 邓忠(F2)、Seat1 魏延=您(F2)、Seat2 黄忠(F3)、Seat3 袁绍(F3)。
const roster: SeatRosterEntry[] = [
  { seatId: 0, generalName: "邓忠", figure: 2 },
  { seatId: 1, generalName: "魏延", figure: 2 },
  { seatId: 2, generalName: "黄忠", figure: 3 },
  { seatId: 3, generalName: "袁绍", figure: 3 }
]

describe("seats: ally / team logic", () => {
  it("isAllyDrawText: 带花色摸牌为队友，纯计数/无关文本不是", () => {
    expect(isAllyDrawText("邓忠从摸牌堆获得兵粮寸断♣4,雷杀♠7,杀♣10")).toBe(true)
    expect(isAllyDrawText("魏延(您)从摸牌堆获得桃♦3")).toBe(true)
    // 敌方摸牌不带牌面 → 不是队友信号
    expect(isAllyDrawText("某人从摸牌堆获得2张牌")).toBe(false)
    // 非摸牌文本
    expect(isAllyDrawText("袁绍使用杀♠8")).toBe(false)
    expect(isAllyDrawText(undefined)).toBe(false)
  })

  it("allyDrawActor: 提取摸牌者", () => {
    expect(allyDrawActor("邓忠从摸牌堆获得兵粮寸断♣4,雷杀♠7")).toBe("邓忠")
    expect(allyDrawActor("魏延(您)从摸牌堆获得桃♦3")).toBe("魏延(您)")
    expect(allyDrawActor("没有摸牌")).toBeUndefined()
  })

  it("pickSelfFigure: 取自己的阵营编号", () => {
    expect(pickSelfFigure(roster, 1)).toBe(2)
    expect(pickSelfFigure(roster, 2)).toBe(3)
    expect(pickSelfFigure(roster, undefined)).toBeUndefined()
  })

  it("allySeatIds: 同 Figure 即同队（含自己）", () => {
    // 您=Seat1(F2) → 队友含 Seat0(邓忠) 与自己 Seat1
    expect(allySeatIds(roster, 1).sort()).toEqual([0, 1])
    // 站在敌方视角 Seat2(F3) → [2,3]
    expect(allySeatIds(roster, 2).sort()).toEqual([2, 3])
  })

  it("allyGeneralNames: 我方武将名（含自己+队友，排除敌方）", () => {
    expect(allyGeneralNames(roster, 1).sort()).toEqual(["邓忠", "魏延"])
    // 敌方（黄忠/袁绍）不在我方名单
    expect(allyGeneralNames(roster, 1)).not.toContain("黄忠")
    expect(allyGeneralNames(roster, 1)).not.toContain("袁绍")
  })

  it("无 Figure 信息时只认自己（降级）", () => {
    const noFigure: SeatRosterEntry[] = [
      { seatId: 0, generalName: "邓忠" },
      { seatId: 1, generalName: "魏延" }
    ]
    expect(allySeatIds(noFigure, 1)).toEqual([1])
    expect(allyGeneralNames(noFigure, 1)).toEqual(["魏延"])
  })
})
