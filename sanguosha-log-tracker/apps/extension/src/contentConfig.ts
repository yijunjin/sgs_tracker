import type { DeckOrderPreviewSource } from "./contentTypes"

/**
 * content script 的常量配置。
 *
 * 这里放“不会读写运行时状态”的固定值：DOM id、localStorage key、collector 地址、协议区号等。
 * 把它们从 content.ts 拿出来后，主文件可以更专注于事件编排；后续如果要支持多个顺序预览
 * 技能，也可以先从这里扩展配置，而不是把区号硬编码回业务流程里。
 */

export const ROOT_ID = "sgs-card-tracker-root"
export const HAND_OVERLAY_ROOT_ID = "sgs-known-hand-overlay-root"
export const HOOK_SCRIPT_ID = "sgs-card-tracker-page-hook"
export const CONTENT_VERSION = "extension-content-v34-reshuffle-keep-enemy"
export const CONTENT_BOOT_KEY = "__SGS_TRACKER_CONTENT_VERSION__"

export const PANEL_WIDTH_STORAGE_KEY = "sgs-tracker-panel-width"
export const LOG_COLLAPSED_STORAGE_KEY = "sgs-tracker-log-collapsed"
export const CUSTOM_RULES_STORAGE_KEY = "sgs-tracker-custom-rules"

export const COLLECTOR_URL = "http://127.0.0.1:18765/snapshot"
export const MIN_PANEL_WIDTH = 340
export const MAX_PANEL_WIDTH = 760

export const HAND_ZONE = 5
export const TEMP_HAND_ZONE = 10
export const DIMENG_SPELL_ID = 121

// 当前观星只是一个配置来源：FromZone 1 → previewZone 表示查看牌堆顶 N 张；
// previewZone → 1 表示摆回牌堆，topPosition=顶部，其余=底部。
// 真机抓包验证：观星摆到顶部组的 cardId 数组靠后者更接近下一张摸牌，因此 topOrder=reverse。
export const DECK_ORDER_PREVIEW_SOURCE: DeckOrderPreviewSource = {
  id: "guanxing",
  label: "观星",
  heading: "观星控底",
  titlePrefix: "观星控底",
  topTipLabel: "你观星控到牌堆顶、尚未被摸走的牌",
  bottomTipLabel: "你观星垫到牌堆底的牌",
  config: {
    drawPileZone: 1,
    previewZone: 8,
    topPosition: 65280,
    topOrder: "reverse",
    bottomOrder: "as-is"
  }
}
