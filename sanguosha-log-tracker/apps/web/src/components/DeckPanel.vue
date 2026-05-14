<script setup lang="ts">
import { computed, ref } from "vue"
import { Boxes, CheckCircle2, RotateCcw } from "lucide-vue-next"
import { getDeckTotalCount, type CardName, type DeckProfile, type TrackerState } from "@slt/shared"
import UiTag from "./ui/UiTag.vue"

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
  <section class="glass-panel p-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="section-title section-title-row"><Boxes class="section-title-icon" />牌库统计</h2>
        <p class="mt-1 text-xs muted">{{ deckProfile.description }}</p>
      </div>
      <UiTag variant="gold">共 {{ cardNameCount }} 类牌</UiTag>
    </div>

    <div class="mt-3 rounded-lg border border-slate-800/80 bg-slate-950/45 p-3">
      <div class="grid gap-3 text-sm md:grid-cols-4">
        <div><p class="metric-label">当前牌堆</p><p class="metric-value gold-text">{{ deckProfile.name }}</p></div>
        <div><p class="metric-label">官方剩余牌 OCR</p><p class="metric-value">{{ trackerState.lastDeckRemainingRawText || "暂无" }}</p></div>
        <div><p class="metric-label">稳定剩余牌数</p><p class="metric-value">{{ trackerState.lastStableDeckRemaining ?? "暂无" }}</p></div>
        <div><p class="metric-label">当前轮次</p><p class="metric-value">第 {{ trackerState.cycleId }} 轮</p></div>
        <div><p class="metric-label">洗牌次数</p><p class="metric-value">{{ trackerState.reshuffleCount }} 次</p></div>
        <div><p class="metric-label">已检测洗牌</p><p class="metric-value">{{ trackerState.pendingReshuffleAlert?.status === "pending" ? "是" : "否" }}</p></div>
        <div><p class="metric-label">上次洗牌时间</p><p class="metric-value">{{ formatTime(trackerState.lastDeckRemainingUpdatedAt) }}</p></div>
        <div><p class="metric-label">总牌数</p><p class="metric-value">{{ totalCards }}</p></div>
      </div>

      <div v-if="trackerState.pendingReshuffleAlert?.status === 'pending'" class="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
        <p class="font-semibold">疑似洗牌：{{ trackerState.pendingReshuffleAlert.previousRemaining }} → {{ trackerState.pendingReshuffleAlert.currentRemaining }}</p>
        <p class="mt-1 text-xs">{{ trackerState.pendingReshuffleAlert.reason }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="action-button" type="button" @click="emit('confirm-reshuffle')"><CheckCircle2 class="button-icon" />确认已洗牌</button>
          <button class="action-button secondary-button" type="button" @click="emit('dismiss-reshuffle')">忽略本次提示</button>
        </div>
      </div>

      <details class="compact-details mt-3">
        <summary>牌库操作</summary>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="action-button secondary-button" type="button" @click="emit('manual-reshuffle')"><RotateCcw class="button-icon" />手动标记洗牌</button>
          <input v-model.number="manualRemaining" class="input-shell w-28" type="number" min="0" :max="totalCards" placeholder="剩余" />
          <button class="action-button secondary-button" type="button" @click="submitManualRemaining">手动修正剩余牌数</button>
        </div>

        <label class="mt-3 block text-sm">
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
      </details>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <UiTag
        v-for="item in filterOptions"
        :key="item.value"
        interactive
        variant="gold"
        :active="filter === item.value"
        @click="filter = item.value"
      >
        {{ item.label }}
      </UiTag>
    </div>

    <div class="mt-3 max-h-[280px] overflow-auto rounded-lg border border-slate-800/70">
      <table class="data-table">
        <thead>
          <tr>
            <th>牌名</th>
            <th>总数</th>
            <th>本轮已见</th>
            <th>本轮剩余</th>
            <th>历史已见</th>
            <th>剩余占比</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="card in visibleCards" :key="card.name">
            <td class="font-semibold text-slate-100">{{ card.name }}</td>
            <td>{{ card.count }}</td>
            <td>{{ trackerState.cycleSeenCounts[card.name] ?? 0 }}</td>
            <td>{{ trackerState.cycleRemainingCounts[card.name] ?? 0 }}</td>
            <td>{{ trackerState.historySeenCounts[card.name] ?? 0 }}</td>
            <td>
              <div class="flex items-center gap-2">
                <div class="h-2 w-28 overflow-hidden rounded-full bg-slate-900">
                  <div class="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500" :style="{ width: `${ratio(card.name, card.count)}%` }" />
                </div>
                <span>{{ Math.round(ratio(card.name, card.count)) }}%</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
