import type { CardName, DeckCardEntry } from "@slt/shared"

/**
 * 卡牌展示与花色归一化工具。
 *
 * 这个模块只处理“怎么显示一张牌”：短标签、手牌标签、花色符号、红黑判断、
 * tooltip 文案和静态排序。它不读取牌局状态、不访问 DOM、不调用 chrome.runtime。
 * 这样 snapshot、已见牌、文本解析等模块后续都可以复用同一套展示规则，而不会互相依赖。
 */

// 牌名展示顺序不是按字典序，而是按玩家读牌时的常用优先级：
// 基本牌 -> 常见锦囊 -> 装备/坐骑。这样 UI 扫描成本最低。
export const cardDisplayOrder = new Map<string, number>(
  [
    "杀",
    "雷杀",
    "火杀",
    "闪",
    "桃",
    "酒",
    "无懈可击",
    "过河拆桥",
    "顺手牵羊",
    "无中生有",
    "乐不思蜀",
    "南蛮入侵",
    "万箭齐发",
    "借刀杀人",
    "五谷丰登",
    "桃园结义",
    "闪电",
    "铁索连环",
    "兵粮寸断",
    "决斗",
    "火攻",
    "诸葛连弩",
    "雌雄双股剑",
    "青釭剑",
    "青龙偃月刀",
    "丈八蛇矛",
    "贯石斧",
    "麒麟弓",
    "古锭刀",
    "朱雀羽扇",
    "方天画戟",
    "寒冰剑",
    "八卦阵",
    "仁王盾",
    "藤甲",
    "白银狮子",
    "赤兔",
    "紫骍",
    "大宛",
    "绝影",
    "的卢",
    "爪黄飞电",
    "骅骝"
  ].map((name, index) => [name, index])
)

// 文本日志里常出现卡牌简称；解析“精确牌面”时先把这些简称映射回牌名。
export const exactCardAliases: Record<string, string> = {
  借刀: "借刀杀人",
  无懈: "无懈可击",
  过河: "过河拆桥",
  顺手: "顺手牵羊",
  五谷: "五谷丰登",
  桃园: "桃园结义",
  铁索: "铁索连环",
  兵粮: "兵粮寸断",
  南蛮: "南蛮入侵",
  万箭: "万箭齐发",
  无中: "无中生有",
  连弩: "诸葛连弩"
}

// 延时锦囊进入判定区后仍会占用场上牌位；洗牌时不能当作弃牌回到未见牌池。
export const delayedTrickNames = new Set<CardName>(["乐不思蜀", "兵粮寸断", "闪电"])

export function cardShortName(name: string): string {
  const map: Record<string, string> = {
    杀: "杀",
    雷杀: "雷",
    火杀: "火",
    闪: "闪",
    桃: "桃",
    酒: "酒",
    无懈可击: "无",
    过河拆桥: "拆",
    顺手牵羊: "顺",
    无中生有: "中",
    乐不思蜀: "乐",
    兵粮寸断: "粮",
    南蛮入侵: "蛮",
    万箭齐发: "箭",
    桃园结义: "园",
    铁索连环: "索",
    借刀杀人: "借",
    五谷丰登: "谷",
    闪电: "电"
  }
  return map[name] ?? name.slice(0, 2)
}

export function handCardNameLabel(name: string): string {
  const map: Record<string, string> = {
    无懈可击: "无懈",
    过河拆桥: "过拆",
    顺手牵羊: "顺手",
    无中生有: "无中",
    乐不思蜀: "乐不",
    兵粮寸断: "兵粮",
    南蛮入侵: "南蛮",
    万箭齐发: "万箭",
    桃园结义: "桃园",
    铁索连环: "铁索",
    借刀杀人: "借刀",
    五谷丰登: "五谷",
    木牛流马: "木牛",
    闪电: "闪电"
  }
  return map[name] ?? (name.length <= 2 ? name : name.slice(0, 2))
}

export function suitSymbol(suit: string | undefined): string {
  const map: Record<string, string> = {
    heart: "♥",
    diamond: "♦",
    club: "♣",
    spade: "♠",
    红桃: "♥",
    方片: "♦",
    方块: "♦",
    梅花: "♣",
    黑桃: "♠"
  }
  return suit ? map[suit] ?? suit : ""
}

export function normalizeSuitSymbol(value: string | undefined): string | undefined {
  const map: Record<string, string> = {
    "♥": "红桃",
    "♦": "方片",
    "♣": "梅花",
    "♠": "黑桃"
  }
  return value ? map[value] ?? value : undefined
}

export function suitAssetFileName(suit: string | undefined): string | undefined {
  const map: Record<string, string> = {
    heart: "hongxin.png",
    diamond: "fangpian.png",
    club: "meihua.png",
    spade: "kuihua.png",
    红桃: "hongxin.png",
    方片: "fangpian.png",
    方块: "fangpian.png",
    梅花: "meihua.png",
    黑桃: "kuihua.png"
  }
  return suit ? map[suit] : undefined
}

export function isRedSuit(suit: string | undefined): boolean {
  return Boolean(suit && /heart|diamond|红桃|方片|方块/.test(suit))
}

export function cardChipLabel(card: DeckCardEntry): string {
  if (card.rank || card.suit) {
    return `${card.rank ?? ""}${suitSymbol(card.suit)}`
  }
  return cardShortName(card.name)
}

export function cardFullLabel(card: Pick<DeckCardEntry, "name" | "rank" | "suit">): string {
  const suit = suitSymbol(card.suit)
  const rank = card.rank ?? ""
  return `${card.name}${suit || rank ? ` ${suit}${rank}` : ""}`
}

export function cardTooltip(
  card: Pick<DeckCardEntry, "name" | "rank" | "suit" | "description">,
  state: "公开区" | "玩家已见" | "未见"
): string {
  return [cardFullLabel(card), state, card.description].filter(Boolean).join("\n")
}
