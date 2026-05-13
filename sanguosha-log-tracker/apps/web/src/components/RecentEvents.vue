<script setup lang="ts">
import type { ParsedLogEvent } from "@slt/shared"

defineProps<{
  recentEvents: ParsedLogEvent[]
}>()

const emit = defineEmits<{
  (event: "undo"): void
  (event: "reset"): void
}>()
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

    <div class="mt-4 space-y-3">
      <article
        v-for="event in recentEvents"
        :key="`${event.id}-${event.createdAt}`"
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-slate-100">{{ event.playerName || "未知玩家" }} · {{ event.cardName || "未识别牌名" }}</h3>
            <p class="mt-1 text-xs text-slate-400">{{ event.rawText }}</p>
          </div>
          <span class="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200">
            accepted
          </span>
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
