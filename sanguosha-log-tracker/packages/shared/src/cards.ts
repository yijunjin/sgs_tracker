import type { CardName, DeckCardEntry, DeckProfile } from "./types"

type CardType = NonNullable<DeckCardEntry["type"]>
type ExactCardTuple = readonly [suit: string, rank: string, name: CardName, type?: CardType]

const cardDescriptions: Record<CardName, string> = {
  杀: "出牌阶段，对攻击范围内一名角色使用。目标需使用一张闪，否则受到1点伤害。",
  雷杀: "属性杀。结算同杀，造成雷电伤害。",
  火杀: "属性杀。结算同杀，造成火焰伤害。",
  闪: "当成为杀的目标时可以使用或打出，抵消该杀。",
  桃: "出牌阶段对自己使用回复1点体力，或在角色濒死时对其使用回复1点体力。",
  酒: "出牌阶段对自己使用，本回合下一张杀伤害+1；濒死时可对自己使用回复1点体力。",
  诸葛连弩: "武器，攻击范围1。你使用杀无次数限制。",
  雌雄双股剑: "武器，攻击范围2。使用杀指定异性角色为目标后，可令其弃一张手牌或令你摸一张牌。",
  青釭剑: "武器，攻击范围2。锁定技，你使用杀无视目标防具。",
  青龙偃月刀: "武器，攻击范围3。你的杀被闪抵消后，可继续对其使用一张杀。",
  丈八蛇矛: "武器，攻击范围3。可将两张手牌当杀使用或打出。",
  贯石斧: "武器，攻击范围3。你的杀被闪抵消后，可弃两张牌令此杀依然造成伤害。",
  麒麟弓: "武器，攻击范围5。使用杀对目标造成伤害时，可弃置其装备区一张坐骑牌。",
  古锭刀: "武器，攻击范围2。锁定技，你的杀对没有手牌的目标造成伤害时伤害+1。",
  朱雀羽扇: "武器，攻击范围4。你可以将普通杀当火杀使用。",
  方天画戟: "武器，攻击范围4。你使用最后一张手牌杀时，可额外指定至多两个目标。",
  寒冰剑: "武器，攻击范围2。使用杀对目标造成伤害时，可防止此伤害并依次弃置其两张牌。",
  八卦阵: "防具。需要使用或打出闪时可判定，若结果为红色，视为使用或打出一张闪。",
  仁王盾: "防具。锁定技，黑色杀对你无效。",
  藤甲: "防具。锁定技，南蛮入侵、万箭齐发和普通杀对你无效；你受到火焰伤害+1。",
  白银狮子: "防具。锁定技，你受到的伤害最多为1；失去装备区里的此牌后回复1点体力。",
  赤兔: "进攻坐骑。你计算与其他角色距离-1。",
  紫骍: "进攻坐骑。你计算与其他角色距离-1。",
  大宛: "进攻坐骑。你计算与其他角色距离-1。",
  绝影: "防御坐骑。其他角色计算与你距离+1。",
  的卢: "防御坐骑。其他角色计算与你距离+1。",
  爪黄飞电: "防御坐骑。其他角色计算与你距离+1。",
  骅骝: "防御坐骑。其他角色计算与你距离+1。",
  木牛流马: "宝物牌。出牌阶段限一次，可将一张手牌置于此牌下；此牌下的牌可如手牌般使用或打出。",
  顺手牵羊: "出牌阶段，对距离为1的一名角色使用，获得其区域里一张牌。",
  过河拆桥: "出牌阶段，对一名角色使用，弃置其区域里一张牌。",
  五谷丰登: "出牌阶段，对所有角色使用。亮出等同于角色数的牌，按行动顺序每名目标获得其中一张。",
  决斗: "出牌阶段，对一名其他角色使用。双方轮流打出杀，未打出的一方受到1点伤害。",
  南蛮入侵: "出牌阶段，对所有其他角色使用。每名目标需打出一张杀，否则受到1点伤害。",
  万箭齐发: "出牌阶段，对所有其他角色使用。每名目标需打出一张闪，否则受到1点伤害。",
  闪电: "延时锦囊。判定阶段判定，若为黑桃2-9，目标受到3点雷电伤害，否则移给下家。",
  桃园结义: "出牌阶段，对所有角色使用。每名目标回复1点体力。",
  无懈可击: "抵消一张锦囊牌对一个目标的效果，或抵消另一张无懈可击。",
  乐不思蜀: "延时锦囊。判定阶段判定，若不为红桃，跳过出牌阶段。",
  铁索连环: "出牌阶段，横置或重置一至两名角色；也可以重铸摸一张牌。",
  兵粮寸断: "延时锦囊。对距离1的一名角色使用，判定阶段判定，若不为梅花，跳过摸牌阶段。",
  借刀杀人: "出牌阶段，对装备武器的一名角色使用，令其对你指定的另一名角色使用杀，否则你获得其武器。",
  火攻: "出牌阶段，对一名有手牌的角色使用。其展示一张手牌，你弃置同花色手牌后对其造成1点火焰伤害。",
  无中生有: "出牌阶段，对自己使用，摸两张牌。",
  水淹七军: "出牌阶段，对对手使用。目标选择一项：弃置装备区里的所有牌，或受到1点伤害。"
}

const cardTypeByName: Record<CardName, CardType> = {
  杀: "basic",
  雷杀: "basic",
  火杀: "basic",
  闪: "basic",
  桃: "basic",
  酒: "basic",
  诸葛连弩: "equip",
  雌雄双股剑: "equip",
  青釭剑: "equip",
  青龙偃月刀: "equip",
  丈八蛇矛: "equip",
  贯石斧: "equip",
  麒麟弓: "equip",
  古锭刀: "equip",
  朱雀羽扇: "equip",
  方天画戟: "equip",
  寒冰剑: "equip",
  八卦阵: "equip",
  仁王盾: "equip",
  藤甲: "equip",
  白银狮子: "equip",
  赤兔: "equip",
  紫骍: "equip",
  大宛: "equip",
  绝影: "equip",
  的卢: "equip",
  爪黄飞电: "equip",
  骅骝: "equip",
  木牛流马: "equip"
}

function inferCardType(name: CardName): CardType {
  return cardTypeByName[name] ?? "trick"
}

function exactCards(entries: readonly ExactCardTuple[]): DeckCardEntry[] {
  return entries.map(([suit, rank, name, type]) => ({
    name,
    count: 1,
    type: type ?? inferCardType(name),
    suit,
    rank,
    ...(cardDescriptions[name] ? { description: cardDescriptions[name] } : {})
  }))
}

const happyTwoVTwoExactCards = exactCards([
  ["heart", "A", "桃园结义"],
  ["heart", "A", "万箭齐发"],
  ["heart", "2", "闪"],
  ["heart", "2", "闪"],
  ["heart", "3", "桃"],
  ["heart", "3", "五谷丰登"],
  ["heart", "4", "桃"],
  ["heart", "4", "五谷丰登"],
  ["heart", "5", "麒麟弓"],
  ["heart", "5", "赤兔"],
  ["heart", "6", "桃"],
  ["heart", "6", "乐不思蜀"],
  ["heart", "7", "桃"],
  ["heart", "7", "无中生有"],
  ["heart", "8", "桃"],
  ["heart", "8", "无中生有"],
  ["heart", "9", "桃"],
  ["heart", "9", "无中生有"],
  ["heart", "10", "杀"],
  ["heart", "10", "杀"],
  ["heart", "J", "杀"],
  ["heart", "J", "无中生有"],
  ["heart", "Q", "桃"],
  ["heart", "Q", "过河拆桥"],
  ["heart", "Q", "闪电"],
  ["heart", "K", "闪"],
  ["heart", "K", "爪黄飞电"],

  ["diamond", "A", "决斗"],
  ["diamond", "A", "诸葛连弩"],
  ["diamond", "2", "闪"],
  ["diamond", "2", "闪"],
  ["diamond", "3", "闪"],
  ["diamond", "3", "顺手牵羊"],
  ["diamond", "4", "闪"],
  ["diamond", "4", "顺手牵羊"],
  ["diamond", "5", "闪"],
  ["diamond", "5", "贯石斧"],
  ["diamond", "6", "杀"],
  ["diamond", "6", "闪"],
  ["diamond", "7", "杀"],
  ["diamond", "7", "闪"],
  ["diamond", "8", "杀"],
  ["diamond", "8", "闪"],
  ["diamond", "9", "杀"],
  ["diamond", "9", "闪"],
  ["diamond", "10", "杀"],
  ["diamond", "10", "闪"],
  ["diamond", "J", "闪"],
  ["diamond", "J", "闪"],
  ["diamond", "Q", "桃"],
  ["diamond", "Q", "方天画戟"],
  ["diamond", "Q", "无懈可击"],
  ["diamond", "K", "杀"],
  ["diamond", "K", "紫骍"],

  ["club", "A", "决斗"],
  ["club", "A", "诸葛连弩"],
  ["club", "2", "杀"],
  ["club", "2", "八卦阵"],
  ["club", "2", "仁王盾"],
  ["club", "3", "杀"],
  ["club", "3", "过河拆桥"],
  ["club", "4", "杀"],
  ["club", "4", "过河拆桥"],
  ["club", "5", "杀"],
  ["club", "5", "的卢"],
  ["club", "6", "杀"],
  ["club", "6", "乐不思蜀"],
  ["club", "7", "杀"],
  ["club", "7", "南蛮入侵"],
  ["club", "8", "杀"],
  ["club", "8", "杀"],
  ["club", "9", "杀"],
  ["club", "9", "杀"],
  ["club", "10", "杀"],
  ["club", "10", "杀"],
  ["club", "J", "杀"],
  ["club", "J", "杀"],
  ["club", "Q", "借刀杀人"],
  ["club", "Q", "无懈可击"],
  ["club", "K", "借刀杀人"],
  ["club", "K", "无懈可击"],

  ["spade", "A", "决斗"],
  ["spade", "A", "闪电"],
  ["spade", "2", "雌雄双股剑"],
  ["spade", "2", "八卦阵"],
  ["spade", "2", "寒冰剑"],
  ["spade", "3", "过河拆桥"],
  ["spade", "3", "顺手牵羊"],
  ["spade", "4", "过河拆桥"],
  ["spade", "4", "顺手牵羊"],
  ["spade", "5", "青龙偃月刀"],
  ["spade", "5", "绝影"],
  ["spade", "6", "乐不思蜀"],
  ["spade", "6", "青釭剑"],
  ["spade", "7", "杀"],
  ["spade", "7", "南蛮入侵"],
  ["spade", "8", "杀"],
  ["spade", "8", "杀"],
  ["spade", "9", "杀"],
  ["spade", "9", "杀"],
  ["spade", "10", "杀"],
  ["spade", "10", "杀"],
  ["spade", "J", "顺手牵羊"],
  ["spade", "J", "无懈可击"],
  ["spade", "Q", "过河拆桥"],
  ["spade", "Q", "丈八蛇矛"],
  ["spade", "K", "南蛮入侵"],
  ["spade", "K", "大宛"],

  ["heart", "2", "火攻"],
  ["heart", "3", "火攻"],
  ["heart", "4", "火杀"],
  ["heart", "5", "桃"],
  ["heart", "6", "桃"],
  ["heart", "7", "火杀"],
  ["heart", "8", "闪"],
  ["heart", "9", "闪"],
  ["heart", "10", "火杀"],
  ["heart", "J", "闪"],
  ["heart", "Q", "闪"],
  ["heart", "K", "无懈可击"],
  ["heart", "A", "无懈可击"],

  ["diamond", "A", "朱雀羽扇"],
  ["diamond", "2", "桃"],
  ["diamond", "3", "桃"],
  ["diamond", "4", "火杀"],
  ["diamond", "5", "火杀"],
  ["diamond", "6", "闪"],
  ["diamond", "7", "闪"],
  ["diamond", "8", "闪"],
  ["diamond", "9", "酒"],
  ["diamond", "10", "闪"],
  ["diamond", "J", "闪"],
  ["diamond", "Q", "火攻"],
  ["diamond", "K", "骅骝"],

  ["club", "A", "白银狮子"],
  ["club", "2", "藤甲"],
  ["club", "3", "酒"],
  ["club", "4", "兵粮寸断"],
  ["club", "5", "雷杀"],
  ["club", "6", "雷杀"],
  ["club", "7", "雷杀"],
  ["club", "8", "雷杀"],
  ["club", "9", "酒"],
  ["club", "10", "铁索连环"],
  ["club", "J", "铁索连环"],
  ["club", "Q", "铁索连环"],
  ["club", "K", "铁索连环"],

  ["spade", "A", "古锭刀"],
  ["spade", "2", "藤甲"],
  ["spade", "3", "酒"],
  ["spade", "4", "雷杀"],
  ["spade", "5", "雷杀"],
  ["spade", "6", "雷杀"],
  ["spade", "7", "雷杀"],
  ["spade", "8", "雷杀"],
  ["spade", "9", "酒"],
  ["spade", "10", "兵粮寸断"],
  ["spade", "J", "铁索连环"],
  ["spade", "Q", "铁索连环"],
  ["spade", "K", "无懈可击"],

  ["diamond", "5", "木牛流马"]
])

const oneVOneExactCards = exactCards([
  ["spade", "A", "决斗"],
  ["spade", "2", "八卦阵"],
  ["spade", "3", "过河拆桥"],
  ["spade", "4", "顺手牵羊"],
  ["spade", "5", "杀"],
  ["spade", "6", "青釭剑"],
  ["spade", "7", "杀"],
  ["spade", "8", "杀"],
  ["spade", "9", "寒冰剑"],
  ["spade", "10", "杀"],
  ["spade", "J", "顺手牵羊"],
  ["spade", "Q", "丈八蛇矛"],
  ["spade", "K", "南蛮入侵"],

  ["heart", "A", "万箭齐发"],
  ["heart", "2", "闪"],
  ["heart", "3", "桃"],
  ["heart", "4", "桃"],
  ["heart", "5", "闪"],
  ["heart", "6", "乐不思蜀"],
  ["heart", "7", "无中生有"],
  ["heart", "8", "无中生有"],
  ["heart", "9", "桃"],
  ["heart", "10", "杀"],
  ["heart", "J", "杀"],
  ["heart", "Q", "过河拆桥"],
  ["heart", "K", "无懈可击"],

  ["club", "A", "决斗"],
  ["club", "2", "仁王盾"],
  ["club", "3", "过河拆桥"],
  ["club", "4", "杀"],
  ["club", "5", "杀"],
  ["club", "6", "杀"],
  ["club", "7", "水淹七军"],
  ["club", "8", "杀"],
  ["club", "9", "杀"],
  ["club", "10", "杀"],
  ["club", "J", "杀"],
  ["club", "Q", "兵粮寸断"],
  ["club", "K", "无懈可击"],

  ["diamond", "A", "诸葛连弩"],
  ["diamond", "2", "闪"],
  ["diamond", "3", "闪"],
  ["diamond", "4", "顺手牵羊"],
  ["diamond", "5", "贯石斧"],
  ["diamond", "6", "杀"],
  ["diamond", "7", "闪"],
  ["diamond", "8", "闪"],
  ["diamond", "9", "杀"],
  ["diamond", "10", "闪"],
  ["diamond", "J", "闪"],
  ["diamond", "Q", "桃"],
  ["diamond", "K", "杀"]
])

export const oneVOneDeckProfile: DeckProfile = {
  id: "sgs-1v1",
  name: "1v1 牌库",
  description: "根据 1v1/一战到底卡牌表整理的 52 张实体牌表，包含花色、点数和卡牌描述。",
  aggregateBy: "exact-card",
  cards: oneVOneExactCards
}

export const happyTwoVTwoDeckProfile: DeckProfile = {
  id: "sgs-happy-2v2",
  name: "欢乐 2v2 牌库",
  description: "根据欢乐模式 2v2 卡牌图鉴和军争牌表整理的 161 张实体牌表，包含花色、点数和卡牌描述。",
  aggregateBy: "exact-card",
  cards: happyTwoVTwoExactCards
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
  return [...new Set(deckProfile.cards.map((card) => card.name))]
}

export function getDeckTotalCount(deckProfile: DeckProfile): number {
  return deckProfile.cards.reduce((sum, card) => sum + card.count, 0)
}

export function getDeckTotalCounts(deckProfile: DeckProfile): Record<CardName, number> {
  return deckProfile.cards.reduce<Record<CardName, number>>((counts, card) => {
    counts[card.name] = (counts[card.name] ?? 0) + card.count
    return counts
  }, {})
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
