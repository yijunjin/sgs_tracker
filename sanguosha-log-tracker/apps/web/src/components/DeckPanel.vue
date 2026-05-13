<script setup lang="ts">
import { computed } from "vue"
import { getDeckTotalCount, type CardName, type DeckProfile } from "@slt/shared"

const props = defineProps<{
  deckProfile: DeckProfile
  deckProfiles: DeckProfile[]
  seenCounts: Record<CardName, number>
  remainingCounts: Record<CardName, number>
  overSeenWarnings: Record<CardName, number>
}>()

const emit = defineEmits<{
  (event: "change-deck", profileId: string): void
}>()

const totalCards = computed(() => getDeckTotalCount(props.deckProfile))
const cardNameCount = computed(() => props.deckProfile.cards.length)

function ratio(cardName: CardName, total: number): number {
  if (total === 0) {
    return 0
  }

  return Math.min(100, ((props.seenCounts[cardName] ?? 0) / total) * 100)
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
      <div class="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p class="text-xs text-slate-500">当前牌库</p>
          <p class="mt-1 font-semibold text-slate-100">{{ deckProfile.name }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-500">总牌数</p>
          <p class="mt-1 font-semibold text-slate-100">{{ totalCards }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-500">牌名数量</p>
          <p class="mt-1 font-semibold text-slate-100">{{ cardNameCount }}</p>
        </div>
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

    <div class="mt-4 space-y-3 max-h-[400px] overflow-y-auto">
      <article
        v-for="card in deckProfile.cards"
        :key="card.name"
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
        :class="overSeenWarnings[card.name] ? 'ring-1 ring-red-400/45' : remainingCounts[card.name] === 0 ? 'ring-1 ring-amber-400/30' : ''"
      >
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-slate-100">{{ card.name }}</h3>
            <p class="mt-1 text-xs text-slate-400">
              总数 {{ card.count }} / 已见 {{ seenCounts[card.name] ?? 0 }} / 剩余 {{ remainingCounts[card.name] ?? 0 }}
            </p>
            <p v-if="overSeenWarnings[card.name]" class="mt-1 text-xs text-red-200">
              已见超过牌库 {{ overSeenWarnings[card.name] }} 张，请检查重复接受或牌库模式。
            </p>
          </div>
          <span
            class="rounded-full px-3 py-1 text-xs font-medium"
            :class="overSeenWarnings[card.name] ? 'bg-red-500/15 text-red-200' : remainingCounts[card.name] === 0 ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-slate-200'"
          >
            {{ overSeenWarnings[card.name] ? "超出" : remainingCounts[card.name] === 0 ? "已归零" : "可追踪" }}
          </span>
        </div>

        <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-900">
          <div
            class="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-500 transition-all"
            :style="{ width: `${ratio(card.name, card.count)}%` }"
          />
        </div>
      </article>
    </div>
  </section>
</template>
