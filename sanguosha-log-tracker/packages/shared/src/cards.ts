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

export const deckProfiles: DeckProfile[] = [oneVOneDeckProfile]

export const defaultDeckProfile = oneVOneDeckProfile

export const demoDeckProfile = oneVOneDeckProfile

export const KNOWN_CARD_NAMES = [
  ...new Set<CardName>([
    ...oneVOneDeckProfile.cards.map((card) => card.name),
    "酒",
    "桃园结义",
    "五谷丰登",
    "闪电",
    "麒麟弓",
    "赤兔",
    "的卢",
    "绝影"
  ])
]

export const cardNames = oneVOneDeckProfile.cards.map((card) => card.name)

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
