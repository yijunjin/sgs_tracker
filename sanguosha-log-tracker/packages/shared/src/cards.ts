import type { CardName, DeckCardEntry, DeckProfile } from "./types"

export const oneVOneDeckProfile: DeckProfile = {
  id: "sgs-1v1",
  name: "1v1 牌库",
  description: "根据当前 1v1 卡牌图鉴整理的调试牌库，按牌名聚合统计。",
  aggregateBy: "name",
  cards: [
    { name: "杀", count: 16, type: "basic" },
    { name: "闪", count: 8, type: "basic" },
    { name: "桃", count: 4, type: "basic" },

    { name: "诸葛连弩", count: 1, type: "equip" },
    { name: "青釭剑", count: 1, type: "equip" },
    { name: "丈八蛇矛", count: 1, type: "equip" },
    { name: "贯石斧", count: 1, type: "equip" },
    { name: "寒冰剑", count: 1, type: "equip" },
    { name: "八卦阵", count: 1, type: "equip" },
    { name: "仁王盾", count: 1, type: "equip" },

    { name: "顺手牵羊", count: 3, type: "trick" },
    { name: "过河拆桥", count: 3, type: "trick" },
    { name: "决斗", count: 2, type: "trick" },
    { name: "南蛮入侵", count: 1, type: "trick" },
    { name: "万箭齐发", count: 1, type: "trick" },
    { name: "无懈可击", count: 2, type: "trick" },
    { name: "乐不思蜀", count: 1, type: "trick" },
    { name: "兵粮寸断", count: 1, type: "trick" },
    { name: "无中生有", count: 2, type: "trick" },
    { name: "水淹七军", count: 1, type: "trick" }
  ]
}

export const happyTwoVTwoDeckProfile: DeckProfile = {
  id: "sgs-happy-2v2",
  name: "欢乐 2v2 牌库",
  description: "根据欢乐模式 2v2 卡牌图鉴整理，按牌名聚合统计。",
  aggregateBy: "name",
  cards: [
    { name: "杀", count: 30, type: "basic" },
    { name: "雷杀", count: 9, type: "basic" },
    { name: "火杀", count: 5, type: "basic" },
    { name: "闪", count: 24, type: "basic" },
    { name: "桃", count: 12, type: "basic" },
    { name: "酒", count: 5, type: "basic" },

    { name: "诸葛连弩", count: 2, type: "equip" },
    { name: "雌雄双股剑", count: 1, type: "equip" },
    { name: "青釭剑", count: 1, type: "equip" },
    { name: "青龙偃月刀", count: 1, type: "equip" },
    { name: "丈八蛇矛", count: 1, type: "equip" },
    { name: "贯石斧", count: 1, type: "equip" },
    { name: "麒麟弓", count: 1, type: "equip" },
    { name: "古锭刀", count: 1, type: "equip" },
    { name: "朱雀羽扇", count: 1, type: "equip" },
    { name: "方天画戟", count: 1, type: "equip" },
    { name: "寒冰剑", count: 1, type: "equip" },
    { name: "八卦阵", count: 2, type: "equip" },
    { name: "仁王盾", count: 1, type: "equip" },
    { name: "藤甲", count: 2, type: "equip" },
    { name: "白银狮子", count: 1, type: "equip" },
    { name: "赤兔", count: 1, type: "equip" },
    { name: "紫骍", count: 1, type: "equip" },
    { name: "大宛", count: 1, type: "equip" },
    { name: "绝影", count: 1, type: "equip" },
    { name: "的卢", count: 1, type: "equip" },
    { name: "爪黄飞电", count: 1, type: "equip" },
    { name: "骅骝", count: 1, type: "equip" },

    { name: "顺手牵羊", count: 5, type: "trick" },
    { name: "过河拆桥", count: 6, type: "trick" },
    { name: "五谷丰登", count: 2, type: "trick" },
    { name: "决斗", count: 3, type: "trick" },
    { name: "南蛮入侵", count: 3, type: "trick" },
    { name: "万箭齐发", count: 1, type: "trick" },
    { name: "闪电", count: 2, type: "trick" },
    { name: "桃园结义", count: 1, type: "trick" },
    { name: "无懈可击", count: 7, type: "trick" },
    { name: "乐不思蜀", count: 3, type: "trick" },
    { name: "铁索连环", count: 6, type: "trick" },
    { name: "兵粮寸断", count: 2, type: "trick" },
    { name: "借刀杀人", count: 2, type: "trick" },
    { name: "火攻", count: 3, type: "trick" },
    { name: "无中生有", count: 4, type: "trick" }
  ]
}

export const deckProfiles: DeckProfile[] = [happyTwoVTwoDeckProfile, oneVOneDeckProfile]

export const defaultDeckProfile = happyTwoVTwoDeckProfile

export const demoDeckProfile = happyTwoVTwoDeckProfile

export const KNOWN_CARD_NAMES = [
  ...new Set<CardName>([
    ...deckProfiles.flatMap((profile) => profile.cards.map((card) => card.name))
  ])
]

export const cardNames = [...new Set(deckProfiles.flatMap((profile) => profile.cards.map((card) => card.name)))]

export function getDeckCardNames(deckProfile: DeckProfile): CardName[] {
  return deckProfile.cards.map((card) => card.name)
}

export function getDeckTotalCount(deckProfile: DeckProfile): number {
  return deckProfile.cards.reduce((sum, card) => sum + card.count, 0)
}

export function getDeckTotalCounts(deckProfile: DeckProfile): Record<CardName, number> {
  return Object.fromEntries(deckProfile.cards.map((card) => [card.name, card.count]))
}

export function findDeckCardEntry(
  deckProfile: DeckProfile,
  cardName: CardName
): DeckCardEntry | undefined {
  return deckProfile.cards.find((card) => card.name === cardName)
}

export function isCardInDeck(deckProfile: DeckProfile, cardName: CardName | undefined): cardName is CardName {
  return Boolean(cardName && findDeckCardEntry(deckProfile, cardName))
}

export function isKnownCardName(value: string): boolean {
  return KNOWN_CARD_NAMES.includes(value)
}
