<script setup lang="ts">
import type { ParsedLogEvent } from "@slt/shared"

defineProps<{
  events: ParsedLogEvent[]
}>()

const emit = defineEmits<{
  (event: "accept", eventId: string): void
  (event: "reject", eventId: string): void
  (event: "accept-high-confidence"): void
}>()

const actionLabelMap: Record<ParsedLogEvent["action"], string> = {
  use: "使用",
  play: "打出",
  discard: "弃置",
  equip: "装备",
  judge: "判定",
  gainKnown: "获得具名牌",
  convert: "转化使用",
  "convert-use": "转化使用",
  ignore: "忽略",
  unknown: "未知"
}

const statusClasses: Record<ParsedLogEvent["status"], string> = {
  pending: "border-amber-400/20 bg-amber-500/10 text-amber-200",
  accepted: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  rejected: "border-rose-400/20 bg-rose-500/10 text-rose-200",
  ignored: "border-slate-600/30 bg-slate-700/10 text-slate-300"
}

function cardLabel(event: ParsedLogEvent): string {
  if (event.action === "ignore") {
    return "已忽略"
  }
  if (event.supportStatus === "unsupported") {
    return event.cardName ? `${event.cardName}（当前牌库不包含此牌）` : "当前牌库不包含此牌"
  }
  if (event.action === "unknown") {
    return "未匹配到支持的公开日志格式"
  }

  return event.cardName || "未识别牌名"
}

function canAccept(event: ParsedLogEvent): boolean {
  return (
    event.status !== "accepted" &&
    event.action !== "ignore" &&
    event.action !== "unknown" &&
    event.supportStatus !== "unsupported" &&
    Boolean(event.cardName)
  )
}
</script>

<template>
  <section class="glass-panel rounded-3xl p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">解析出的事件</h2>
        <p class="mt-1 text-sm muted">解析结果先进入 pending，确认后才会更新牌库。</p>
      </div>
      <button class="action-button" type="button" @click="emit('accept-high-confidence')">
        全部接受严格有效事件
      </button>
    </div>

    <div class="mt-4 space-y-3 max-h-[400px] overflow-y-auto">
      <article
        v-for="event in events"
        :key="event.id"
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
        :class="event.quality === 'ignored' ? 'opacity-50' : event.quality === 'ambiguous' ? 'border-amber-300/40' : event.supportStatus === 'unsupported' ? 'border-rose-300/30' : ''"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-slate-100">{{ event.playerName || "未知玩家" }}</span>
              <span class="text-xs text-slate-400">{{ actionLabelMap[event.action] }}</span>
              <span class="text-sm text-amber-200">{{ cardLabel(event) }}</span>
            </div>
            <p class="mt-2 text-sm text-slate-300">{{ event.rawText }}</p>
            <p class="mt-1 text-xs text-slate-400">
              规范：{{ event.normalizedText }} | 来源：{{ event.source }} | OCR score：{{ event.confidence.toFixed(2) }}
              <span v-if="event.suit || event.rank"> | 细节：{{ event.suit || "?" }}{{ event.rank || "" }}</span>
            </p>
            <p class="mt-1 text-xs text-slate-400">
              action：{{ event.action }} | player：{{ event.playerName || "-" }} | target：{{ event.targetName || "-" }}
              | quality：{{ event.quality }} | auto：{{ event.autoAcceptable ? "yes" : "no" }}
              | impact：{{ event.impactCount ?? "-" }} | cycle：{{ event.cycleId ?? "-" }}
            </p>
            <p v-if="event.quality === 'ambiguous'" class="mt-2 text-xs text-amber-200">需要人工确认，不能批量自动接受。</p>
            <p v-if="event.supportStatus === 'unsupported'" class="mt-2 text-xs text-rose-200">当前牌库不包含此牌，不会更新统计。</p>
            <p v-if="event.duplicate" class="mt-2 text-xs text-slate-300">本轮可见日志重复，未入库。</p>
            <p v-if="event.note" class="mt-2 text-xs text-amber-100">{{ event.note }}</p>
          </div>
          <span class="rounded-full border px-3 py-1 text-xs" :class="statusClasses[event.status]">
            {{ event.status }}
          </span>
        </div>

        <div class="mt-4 flex flex-wrap gap-3">
          <button
            class="action-button"
            type="button"
            :disabled="!canAccept(event)"
            @click="emit('accept', event.id)"
          >
            接受
          </button>
          <button
            class="action-button danger-button"
            type="button"
            :disabled="event.status === 'rejected'"
            @click="emit('reject', event.id)"
          >
            拒绝
          </button>
        </div>
      </article>

      <div
        v-if="events.length === 0"
        class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-8 text-center text-sm muted"
      >
        运行 OCR 或粘贴文本后，这里会显示解析出的公开日志事件。
      </div>
    </div>
  </section>
</template>
