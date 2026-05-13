<script setup lang="ts">
import { computed, ref } from "vue"
import { getDeckTotalCount, type CardName, type DeckProfile, type TrackerState } from "@slt/shared"

const props = defineProps<{
  deckProfile: DeckProfile
  deckProfiles: DeckProfile[]
  trackerState: TrackerState
}>()

const emit = defineEmits<{
  (event: "change-deck", profileId: string): void
  (event: "confirm-reshuffle"): void
  (event: "dismiss-reshuffle"): void
  (event: "manual-reshuffle"): void
  (event: "correct-deck-remaining", value: number): void
}>()

const filter = ref("all")
const manualRemaining = ref<number | null>(null)
const filterOptions = [
  { value: "all", label: "全部" },
  { value: "seen", label: "只看本轮已见" },
  { value: "empty", label: "只看本轮剩余为 0" },
  { value: "over", label: "只看本轮超出" },
  { value: "basic", label: "基础牌" },
  { value: "trick", label: "锦囊牌" },
  { value: "equip", label: "装备牌" }
]

const totalCards = computed(() => getDeckTotalCount(props.deckProfile))
const cardNameCount = computed(() => props.deckProfile.cards.length)

const order = [
  "杀",
  "闪",
  "桃",
  "无懈可击",
  "过河拆桥",
  "顺手牵羊",
  "决斗",
  "南蛮入侵",
  "万箭齐发",
  "无中生有",
  "乐不思蜀",
  "兵粮寸断",
  "水淹七军"
]

const visibleCards = computed(() => {
  return [...props.deckProfile.cards]
    .sort((left, right) => {
      const leftIndex = order.indexOf(left.name)
      const rightIndex = order.indexOf(right.name)
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex)
      }
      return left.name.localeCompare(right.name, "zh-Hans-CN")
    })
    .filter((card) => {
      const cycleSeen = props.trackerState.cycleSeenCounts[card.name] ?? 0
      const remaining = props.trackerState.cycleRemainingCounts[card.name] ?? 0
      const over = cycleSeen > card.count
      if (filter.value === "seen") {
        return cycleSeen > 0
      }
      if (filter.value === "empty") {
        return remaining === 0
      }
      if (filter.value === "over") {
        return over
      }
      if (filter.value === "basic" || filter.value === "trick" || filter.value === "equip") {
        return card.type === filter.value
      }
      return true
    })
})

function ratio(cardName: CardName, total: number): number {
  if (total === 0) {
    return 0
  }

  return Math.min(100, ((props.trackerState.cycleSeenCounts[cardName] ?? 0) / total) * 100)
}

function formatTime(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "暂无"
}

function submitManualRemaining(): void {
  if (manualRemaining.value === null || Number.isNaN(manualRemaining.value)) {
    return
  }
  emit("correct-deck-remaining", manualRemaining.value)
}
</script>

<template>
  <section class="glass-panel rounded-3xl p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="section-title">牌库统计</h2>
        <p class="mt-1 text-sm muted">{{ deckProfile.description }}</p>
      </div>
      <span class="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
        共 {{ cardNameCount }} 类牌
      </span>
    </div>

    <div class="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div class="grid gap-3 text-sm sm:grid-cols-2">
        <div><p class="text-xs text-slate-500">当前牌库</p><p class="mt-1 font-semibold text-slate-100">{{ deckProfile.name }}</p></div>
        <div><p class="text-xs text-slate-500">总牌数 / 牌名数量</p><p class="mt-1 font-semibold text-slate-100">{{ totalCards }} / {{ cardNameCount }}</p></div>
        <div><p class="text-xs text-slate-500">官方剩余牌 OCR</p><p class="mt-1 font-semibold text-slate-100">{{ trackerState.lastDeckRemainingRawText || "暂无" }}</p></div>
        <div><p class="text-xs text-slate-500">稳定剩余牌数</p><p class="mt-1 font-semibold text-slate-100">{{ trackerState.lastStableDeckRemaining ?? "暂无" }}</p></div>
        <div><p class="text-xs text-slate-500">当前牌堆周期</p><p class="mt-1 font-semibold text-slate-100">第 {{ trackerState.cycleId }} 轮</p></div>
        <div><p class="text-xs text-slate-500">已检测洗牌</p><p class="mt-1 font-semibold text-slate-100">{{ trackerState.reshuffleCount }} 次</p></div>
        <div><p class="text-xs text-slate-500">上次剩余牌识别时间</p><p class="mt-1 font-semibold text-slate-100">{{ formatTime(trackerState.lastDeckRemainingUpdatedAt) }}</p></div>
      </div>

      <div v-if="trackerState.pendingReshuffleAlert?.status === 'pending'" class="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
        <p class="font-semibold">疑似洗牌：{{ trackerState.pendingReshuffleAlert.previousRemaining }} → {{ trackerState.pendingReshuffleAlert.currentRemaining }}</p>
        <p class="mt-1 text-xs">{{ trackerState.pendingReshuffleAlert.reason }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="action-button" type="button" @click="emit('confirm-reshuffle')">确认已洗牌</button>
          <button class="action-button secondary-button" type="button" @click="emit('dismiss-reshuffle')">忽略本次提示</button>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button class="action-button secondary-button" type="button" @click="emit('manual-reshuffle')">手动标记洗牌</button>
        <input v-model.number="manualRemaining" class="input-shell w-28" type="number" min="0" :max="totalCards" placeholder="剩余" />
        <button class="action-button secondary-button" type="button" @click="submitManualRemaining">手动修正剩余牌数</button>
      </div>

      <label class="mt-4 block text-sm">
        <span class="mb-2 block text-slate-300">牌库模式选择</span>
        <select
          class="input-shell w-full"
          :value="deckProfile.id"
          @change="emit('change-deck', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="profile in deckProfiles" :key="profile.id" :value="profile.id">
            {{ profile.name }}
          </option>
        </select>
      </label>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <button
        v-for="item in filterOptions"
        :key="item.value"
        class="action-button secondary-button"
        type="button"
        :class="filter === item.value ? 'ring-1 ring-amber-300/50' : ''"
        @click="filter = item.value"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="mt-4 space-y-3 max-h-[520px] overflow-y-auto">
      <article
        v-for="card in visibleCards"
        :key="card.name"
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
        :class="(trackerState.cycleSeenCounts[card.name] ?? 0) > card.count ? 'ring-1 ring-red-400/45' : (trackerState.cycleRemainingCounts[card.name] ?? 0) === 0 ? 'ring-1 ring-amber-400/30' : ''"
      >
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-slate-100">{{ card.name }}</h3>
            <p class="mt-1 text-xs text-slate-400">
              总数 {{ card.count }} / 本轮已见 {{ trackerState.cycleSeenCounts[card.name] ?? 0 }} / 本轮剩余 {{ trackerState.cycleRemainingCounts[card.name] ?? 0 }} / 历史已见 {{ trackerState.historySeenCounts[card.name] ?? 0 }}
            </p>
            <p v-if="(trackerState.cycleSeenCounts[card.name] ?? 0) > card.count" class="mt-1 text-xs text-red-200">
              本轮已见超过牌库数量，疑似重复识别、误解析或牌库模式错误。
            </p>
          </div>
          <span
            class="rounded-full px-3 py-1 text-xs font-medium"
            :class="(trackerState.cycleSeenCounts[card.name] ?? 0) > card.count ? 'bg-red-500/15 text-red-200' : (trackerState.cycleRemainingCounts[card.name] ?? 0) === 0 ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-slate-200'"
          >
            {{ (trackerState.cycleSeenCounts[card.name] ?? 0) > card.count ? "本轮超出" : (trackerState.cycleRemainingCounts[card.name] ?? 0) === 0 ? "本轮归零" : "可追踪" }}
          </span>
        </div>

        <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-900">
          <div
            class="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 transition-all"
            :style="{ width: `${ratio(card.name, card.count)}%` }"
          />
        </div>
      </article>
    </div>
  </section>
</template>
