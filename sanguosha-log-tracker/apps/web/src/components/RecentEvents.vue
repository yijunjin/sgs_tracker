<script setup lang="ts">
import type { ParsedLogEvent } from "@slt/shared"

defineProps<{
  recentEvents: ParsedLogEvent[]
}>()

const emit = defineEmits<{
  (event: "undo"): void
  (event: "undo-event", eventId: string): void
  (event: "mark-misrecognized", eventId: string): void
  (event: "reset"): void
}>()

const actionLabelMap: Record<ParsedLogEvent["action"], string> = {
  use: "使用",
  play: "打出",
  discard: "弃置",
  equip: "装备",
  judge: "判定",
  gainKnown: "获得具名牌",
  convert: "转化",
  "convert-use": "转化使用",
  ignore: "忽略",
  unknown: "未知"
}
</script>

<template>
  <section class="glass-panel rounded-3xl p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="section-title">最近事件</h2>
        <p class="mt-1 text-sm muted">显示最近 20 条已接受事件，可直接撤销上一条。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="action-button secondary-button" type="button" @click="emit('undo')">
          撤销上一条
        </button>
        <button class="action-button danger-button" type="button" @click="emit('reset')">
          重置本局
        </button>
      </div>
    </div>

    <div class="mt-4 space-y-3 min-h-[200px] overflow-y-auto">
      <article
        v-for="event in recentEvents"
        :key="`${event.id}-${event.createdAt}`"
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-slate-100">
              第 {{ event.cycleId ?? "-" }} 轮 · {{ event.playerName || "未知玩家" }} · {{ actionLabelMap[event.action] }} · {{ event.cardName || "未识别牌名" }}
            </h3>
            <p class="mt-1 text-xs text-slate-400">impact {{ event.impactCount ?? "-" }} · {{ event.note || event.rawText }}</p>
          </div>
          <div class="flex flex-wrap justify-end gap-2">
            <button class="action-button secondary-button" type="button" @click="emit('undo-event', event.id)">撤销此事件</button>
            <button class="action-button danger-button" type="button" @click="emit('mark-misrecognized', event.id)">标记为误识别</button>
          </div>
        </div>
      </article>

      <div
        v-if="recentEvents.length === 0"
        class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-8 text-center text-sm muted"
      >
        暂无已接受事件。
      </div>
    </div>
  </section>
</template>
