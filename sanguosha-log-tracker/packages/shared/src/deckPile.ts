// 牌堆剩余数推算核心（协议驱动）。
//
// 背景：三国杀网页版协议不在 move 消息里单列“牌堆剩余张数”，摸牌进手牌时卡牌 ID 被服务端
// 隐藏为 0（暗牌）。但服务器会在每个出牌循环通过 `PubGsCMoveCard` 的弃牌堆同步事件
// (fromZone 2 -> toZone 9, moveType 255) 下发一个权威的牌堆张数快照（其 cardCount 字段）。
// 因此本模块的策略是：**以弃牌堆同步事件的 cardCount 作为牌堆剩余的权威校准点**，两次同步
// 之间的摸牌(1->其它)再按张数递减。本模块把该推算抽成纯函数以便单测与复用。
//
// Zone 语义（经真机抓包确认，1v1）：
//   1 = 摸牌堆(draw pile)   2 = 处理/弃牌过程区   3 = 出牌/明置区
//   5 = 手牌区             6 = 装备区            9 = 弃牌堆
//
// 关键语义（经真机 542 条 move 回放验证，全程牌堆 0..52 无负数）：
//   - 弃牌堆同步 (2->9 mt255) 的 cardCount = 该事件后牌堆的**权威剩余张数**，直接校准。
//   - 洗牌 = 本次同步的 cardCount 比上次牌堆剩余**变大**（弃牌被洗回牌堆，牌堆涨了）。
//     仅此时才重置“已见牌”。普通同步只是牌堆缩小的常规快照，不重置已见牌。
//   - 摸牌 (1->其它) 在两次同步之间按 deckCardCount 递减，夹到 0。

export type DeckPileState = {
  /** 牌堆剩余张数；undefined 表示尚无任何信号 */
  remaining: number | undefined
  /** 是否已校准：收到开局牌表或经历一次洗牌锚点后为 true，否则数字仅供参考 */
  calibrated: boolean
  /** 洗牌次数 */
  reshuffleCount: number
}

export type DeckMoveInput = {
  fromZone: number | undefined
  toZone: number | undefined
  /** 协议 CardCount */
  cardCount: number | undefined
  /**
   * 本次移动实际影响牌堆的张数。调用方应已处理暗牌：摸牌为 [0,0] 时按 cardCount 计，
   * 而非按可识别的实体牌号数量（否则暗牌摸牌会被整段漏减）。
   */
  deckCardCount: number
  moveType: number | undefined
}

export type DeckPileOutcome = {
  state: DeckPileState
  /** 牌堆数值或校准状态是否发生变化 */
  changed: boolean
  /** 本次是否判定为一次洗牌（牌堆涨大）；调用方应在此时重置“已见牌” */
  didReshuffle: boolean
  /** 本次是否为弃牌堆同步事件（牌堆数已按 cardCount 权威校准） */
  discardSync: boolean
}

export function createDeckPileState(): DeckPileState {
  return { remaining: undefined, calibrated: false, reshuffleCount: 0 }
}

/** 收到完整开局牌表：权威起点，牌堆 = 总数且标记已校准。 */
export function seedDeckPile(total: number): DeckPileState {
  return { remaining: total, calibrated: true, reshuffleCount: 0 }
}

function isDiscardSync(ev: DeckMoveInput): boolean {
  return ev.fromZone === 2 && ev.toZone === 9 && ev.moveType === 255
}

/**
 * 应用一条协议移动事件，返回新的牌堆状态。纯函数，无副作用。
 * 调用方负责在 discardSync 时重置“已见牌”等 UI 状态。
 */
export function applyDeckPileMove(state: DeckPileState, ev: DeckMoveInput, total: number): DeckPileOutcome {
  // 弃牌堆同步事件：cardCount 是该事件后牌堆的**权威剩余张数**，直接校准（消除累加漂移，
  // 中途接入时第一次同步即完成校准）。
  // 洗牌判定：本次 cardCount 比上次牌堆剩余变大 = 弃牌被洗回牌堆（牌堆涨了）。仅此时
  // 重置“已见牌”；普通同步只是牌堆缩小的常规快照。真机 542 条 move 回放验证：该判据
  // 识别出 5 次洗牌、全程牌堆 0..52 无负数。
  if (isDiscardSync(ev)) {
    if (ev.cardCount === undefined || ev.cardCount < 0) {
      return { state, changed: false, didReshuffle: false, discardSync: true }
    }
    const next = Math.min(ev.cardCount, total)
    // 洗牌 = 已校准状态下牌堆涨大。首次同步只是校准点（未校准→校准），不算洗牌：
    // 中途接入时本地起点是猜测值，第一次权威同步看似“涨了”其实只是对齐，须排除。
    const isReshuffle = state.calibrated && state.remaining !== undefined && next > state.remaining
    return {
      state: {
        remaining: next,
        calibrated: true,
        reshuffleCount: isReshuffle ? state.reshuffleCount + 1 : state.reshuffleCount
      },
      changed: true,
      didReshuffle: isReshuffle,
      discardSync: true
    }
  }

  const { fromZone, toZone, cardCount, deckCardCount } = ev
  if (!cardCount || cardCount <= 0 || fromZone === undefined || toZone === undefined || fromZone === toZone) {
    return { state, changed: false, didReshuffle: false, discardSync: false }
  }
  if (deckCardCount <= 0) {
    return { state, changed: false, didReshuffle: false, discardSync: false }
  }

  // 牌堆流出（摸牌、明置摸等）
  if (fromZone === 1 && toZone !== 1) {
    const base = state.remaining === undefined ? total : state.remaining
    // 摸牌越过牌堆底只夹到 0，等待洗牌锚点重置；不再臆测“隐式洗牌”清空已见牌。
    const next = Math.max(0, base - deckCardCount)
    if (state.remaining !== undefined && next === state.remaining) {
      return { state, changed: false, didReshuffle: false, discardSync: false }
    }
    return { state: { ...state, remaining: next }, changed: true, didReshuffle: false, discardSync: false }
  }

  // 牌堆流入（少见：放回牌堆顶/底）
  if (toZone === 1 && fromZone !== 1) {
    const base = state.remaining === undefined ? 0 : state.remaining
    const next = Math.min(total, base + deckCardCount)
    if (state.remaining !== undefined && next === state.remaining) {
      return { state, changed: false, didReshuffle: false, discardSync: false }
    }
    return { state: { ...state, remaining: next }, changed: true, didReshuffle: false, discardSync: false }
  }

  return { state, changed: false, didReshuffle: false, discardSync: false }
}

/**
 * 计算一次移动实际影响牌堆的张数，正确处理暗牌(cardId=0)。
 * @param cardIds 协议 CardIDs；摸进手牌时为 [0,0,...]
 * @param cardCount 协议 CardCount
 * @param isKnownCardId 判断某 cardId 是否能反查到实体牌（牌表已知）
 */
export function deckMoveCount(
  cardIds: number[],
  cardCount: number,
  isKnownCardId: (cardId: number) => boolean
): number {
  if (!cardIds.length) {
    return cardCount
  }
  const hiddenCount = cardIds.filter((cardId) => cardId === 0).length
  if (hiddenCount > 0) {
    return Math.max(cardCount, cardIds.length)
  }
  const knownCount = cardIds.filter((cardId) => isKnownCardId(cardId)).length
  return knownCount > 0 ? knownCount : cardIds.length
}
