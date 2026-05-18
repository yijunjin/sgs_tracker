<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AlertTriangle, Boxes, CheckCircle2, ChevronLeft, ChevronRight, Eye, Flag, RotateCcw } from "lucide-vue-next"
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

type CategoryFilter = "all" | "basic" | "trick" | "equip"
type QuickFilter = "all" | "seen" | "remaining"

const categoryFilter = ref<CategoryFilter>("all")
const quickFilter = ref<QuickFilter>("all")
const currentPage = ref(1)
const manualRemaining = ref<number | null>(null)
const pageSize = 8
const categoryOptions: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "basic", label: "基础牌" },
  { value: "trick", label: "锦囊牌" },
  { value: "equip", label: "装备牌" }
]
const quickOptions: Array<{ value: QuickFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "seen", label: "只看已见" },
  { value: "remaining", label: "只看剩余>0" }
]

const totalCards = computed(() => getDeckTotalCount(props.deckProfile))
const cardNameCount = computed(() => props.deckProfile.cards.length)
const cycleSeenTotal = computed(() =>
  props.deckProfile.cards.reduce((total, card) => total + (props.trackerState.cycleSeenCounts[card.name] ?? 0), 0)
)
const cycleRemainingTotal = computed(() =>
  props.deckProfile.cards.reduce((total, card) => total + Math.max(0, props.trackerState.cycleRemainingCounts[card.name] ?? 0), 0)
)
const reshuffleDetected = computed(() => (props.trackerState.pendingReshuffleAlert?.status === "pending" ? "是" : "否"))
const hasOverLimitCards = computed(() =>
  props.deckProfile.cards.some((card) => (props.trackerState.cycleSeenCounts[card.name] ?? 0) > card.count)
)

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
      if (categoryFilter.value !== "all" && card.type !== categoryFilter.value) {
        return false
      }
      if (quickFilter.value === "seen") {
        return cycleSeen > 0
      }
      if (quickFilter.value === "remaining") {
        return remaining > 0
      }
      return true
    })
})

const totalPages = computed(() => Math.max(1, Math.ceil(visibleCards.value.length / pageSize)))
const pagedCards = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return visibleCards.value.slice(start, start + pageSize)
})

watch([categoryFilter, quickFilter], () => {
  currentPage.value = 1
})

watch(totalPages, (nextValue) => {
  if (currentPage.value > nextValue) {
    currentPage.value = nextValue
  }
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

function goToPage(nextPage: number): void {
  currentPage.value = Math.min(Math.max(1, nextPage), totalPages.value)
}

function cardGlyph(cardName: CardName): string {
  const glyphs: Record<string, string> = {
    杀: "杀",
    闪: "闪",
    桃: "桃",
    无懈可击: "无",
    过河拆桥: "拆",
    顺手牵羊: "顺",
    决斗: "决",
    南蛮入侵: "蛮",
    万箭齐发: "箭",
    无中生有: "中",
    乐不思蜀: "乐",
    兵粮寸断: "粮",
    水淹七军: "淹"
  }

  return glyphs[cardName] ?? cardName.slice(0, 1)
}

function distributionWidth(value: number, total: number): string {
  if (total <= 0) {
    return "0%"
  }
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`
}

function rowState(cardName: CardName, total: number): string | null {
  const seen = props.trackerState.cycleSeenCounts[cardName] ?? 0
  const remaining = props.trackerState.cycleRemainingCounts[cardName] ?? 0

  if (seen > total) {
    return "超限"
  }
  if (remaining <= 0 && total > 0) {
    return "已见满"
  }
  return null
}

function rowStateClass(cardName: CardName, total: number): string {
  return (props.trackerState.cycleSeenCounts[cardName] ?? 0) > total ? "is-danger" : "is-warning"
}
</script>

<template>
  <section class="glass-panel deck-stats-shell">
    <div class="deck-stats-head">
      <div>
        <h2 class="section-title section-title-row"><Boxes class="section-title-icon" />牌库统计</h2>
        <p class="deck-stats-subtitle">一眼看清每种牌的已见数量与剩余数量</p>
      </div>
      <div class="deck-stats-mark" aria-hidden="true">三国杀</div>
    </div>

    <div class="deck-summary-grid">
      <article class="deck-summary-card is-wide">
        <div class="deck-summary-icon"><Boxes /></div>
        <div>
          <p class="deck-summary-label">当前牌堆</p>
          <p class="deck-summary-value is-gold">{{ deckProfile.name }}</p>
        </div>
      </article>

      <article class="deck-summary-card">
        <div class="deck-summary-icon"><Boxes /></div>
        <div>
          <p class="deck-summary-label">总牌数</p>
          <p class="deck-summary-value">{{ totalCards }}</p>
        </div>
      </article>

      <article class="deck-summary-card">
        <div class="deck-summary-icon"><Eye /></div>
        <div>
          <p class="deck-summary-label">本轮已见</p>
          <p class="deck-summary-value is-gold">{{ cycleSeenTotal }}</p>
        </div>
      </article>

      <article class="deck-summary-card">
        <div class="deck-summary-icon"><Boxes /></div>
        <div>
          <p class="deck-summary-label">本轮剩余</p>
          <p class="deck-summary-value is-blue">{{ cycleRemainingTotal }}</p>
        </div>
      </article>

      <article class="deck-summary-card">
        <div class="deck-summary-icon"><RotateCcw /></div>
        <div>
          <p class="deck-summary-label">已检测洗牌</p>
          <p class="deck-summary-value">{{ reshuffleDetected }}</p>
        </div>
      </article>

      <article class="deck-summary-card">
        <div class="deck-summary-icon"><Flag /></div>
        <div>
          <p class="deck-summary-label">当前轮次</p>
          <p class="deck-summary-value">第 {{ trackerState.cycleId }} 轮</p>
        </div>
      </article>
    </div>

    <div v-if="trackerState.pendingReshuffleAlert?.status === 'pending'" class="deck-alert-strip">
      <div class="deck-alert-copy">
        <AlertTriangle class="button-icon" />
        <div>
          <strong>疑似洗牌：{{ trackerState.pendingReshuffleAlert.previousRemaining }} → {{ trackerState.pendingReshuffleAlert.currentRemaining }}</strong>
          <p>{{ trackerState.pendingReshuffleAlert.reason }}</p>
        </div>
      </div>
      <div class="deck-alert-actions">
        <button class="action-button compact-action" type="button" @click="emit('confirm-reshuffle')">
          <CheckCircle2 class="button-icon" />确认已洗牌
        </button>
        <button class="action-button secondary-button compact-action" type="button" @click="emit('dismiss-reshuffle')">
          忽略提示
        </button>
      </div>
    </div>

    <div class="deck-filter-bar">
      <div class="deck-filter-group">
        <button
          v-for="item in categoryOptions"
          :key="item.value"
          class="deck-filter-chip"
          :class="{ 'is-active': categoryFilter === item.value }"
          type="button"
          @click="categoryFilter = item.value"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="deck-filter-divider" />

      <div class="deck-filter-group is-secondary">
        <button
          v-for="item in quickOptions"
          :key="item.value"
          class="deck-filter-chip is-secondary"
          :class="{ 'is-active': quickFilter === item.value }"
          type="button"
          @click="quickFilter = item.value"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="deck-bar-legend">
        <span><i class="is-seen"></i>已见</span>
        <span><i class="is-remaining"></i>剩余</span>
      </div>
    </div>

    <div class="deck-table-shell">
      <table class="deck-table">
        <thead>
          <tr>
            <th>牌名</th>
            <th>总数</th>
            <th>已见</th>
            <th>剩余</th>
            <th>分布（已见 / 剩余）</th>
            <th>已见率</th>
          </tr>
        </thead>
        <tbody v-if="pagedCards.length">
          <tr v-for="card in pagedCards" :key="card.name">
            <td>
              <div class="deck-card-name-cell">
                <span class="deck-card-glyph" :class="`is-${card.type ?? 'trick'}`">{{ cardGlyph(card.name) }}</span>
                <span class="deck-card-title">{{ card.name }}</span>
              </div>
            </td>
            <td>{{ card.count }}</td>
            <td class="is-seen-text">{{ trackerState.cycleSeenCounts[card.name] ?? 0 }}</td>
            <td class="is-remaining-text">{{ Math.max(0, trackerState.cycleRemainingCounts[card.name] ?? 0) }}</td>
            <td>
              <div class="deck-distribution-wrap">
                <div class="deck-distribution-bar">
                  <span
                    class="deck-distribution-seen"
                    :style="{ width: distributionWidth(Math.min(trackerState.cycleSeenCounts[card.name] ?? 0, card.count), card.count) }"
                  >
                    {{ trackerState.cycleSeenCounts[card.name] ?? 0 }}
                  </span>
                  <span
                    class="deck-distribution-remaining"
                    :style="{ width: distributionWidth(Math.max(0, trackerState.cycleRemainingCounts[card.name] ?? 0), card.count) }"
                  >
                    {{ Math.max(0, trackerState.cycleRemainingCounts[card.name] ?? 0) }}
                  </span>
                </div>
                <span
                  v-if="rowState(card.name, card.count)"
                  class="deck-row-state"
                  :class="rowStateClass(card.name, card.count)"
                >
                  {{ rowState(card.name, card.count) }}
                </span>
              </div>
            </td>
            <td>{{ Math.round(ratio(card.name, card.count)) }}%</td>
          </tr>
        </tbody>
      </table>

      <div v-if="!pagedCards.length" class="deck-empty-state">
        当前筛选下暂无牌项。
      </div>
    </div>

    <div class="deck-pager-row">
      <div class="deck-pager-meta">
        <span>共 {{ visibleCards.length }} 项</span>
        <span v-if="hasOverLimitCards" class="deck-over-limit-note">存在超限识别</span>
      </div>
      <div class="deck-pager">
        <button class="deck-pager-button" type="button" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
          <ChevronLeft />
        </button>
        <span class="deck-pager-current">{{ currentPage }}</span>
        <span class="deck-pager-total">/ {{ totalPages }}</span>
        <button class="deck-pager-button" type="button" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">
          <ChevronRight />
        </button>
      </div>
    </div>

    <details class="compact-details deck-ops-panel">
      <summary>牌库操作与校验</summary>
      <div class="deck-ops-grid">
        <div class="metric-card">
          <p class="metric-label">官方剩余牌 OCR</p>
          <p class="metric-value two-line-value">{{ trackerState.lastDeckRemainingRawText || "暂无" }}</p>
        </div>
        <div class="metric-card">
          <p class="metric-label">稳定剩余牌数</p>
          <p class="metric-value">{{ trackerState.lastStableDeckRemaining ?? "暂无" }}</p>
        </div>
        <div class="metric-card">
          <p class="metric-label">洗牌次数</p>
          <p class="metric-value">{{ trackerState.reshuffleCount }} 次</p>
        </div>
        <div class="metric-card">
          <p class="metric-label">上次更新</p>
          <p class="metric-value">{{ formatTime(trackerState.lastDeckRemainingUpdatedAt) }}</p>
        </div>
      </div>

      <div class="deck-ops-actions">
        <button class="action-button secondary-button" type="button" @click="emit('manual-reshuffle')">
          <RotateCcw class="button-icon" />手动标记洗牌
        </button>
        <input v-model.number="manualRemaining" class="input-shell deck-remaining-input" type="number" min="0" :max="totalCards" placeholder="剩余" />
        <button class="action-button secondary-button" type="button" @click="submitManualRemaining">手动修正剩余牌数</button>
      </div>

      <label class="deck-profile-switcher">
        <span>牌库模式选择</span>
        <select
          class="input-shell"
          :value="deckProfile.id"
          @change="emit('change-deck', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="profile in deckProfiles" :key="profile.id" :value="profile.id">
            {{ profile.name }}
          </option>
        </select>
      </label>
    </details>

    <p class="deck-footnote">{{ deckProfile.description }} · 共 {{ cardNameCount }} 类牌</p>
  </section>
</template>

<style scoped>
.deck-stats-shell {
  position: relative;
  overflow: hidden;
  border-color: rgba(215, 164, 82, 0.24);
  padding: 1rem;
}

.deck-stats-shell::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: "";
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(244, 199, 111, 0.12);
}

.deck-stats-head {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.deck-stats-subtitle {
  margin: 0.35rem 0 0;
  color: #a8b4c3;
  font-size: 0.88rem;
}

.deck-stats-mark {
  color: rgba(215, 164, 82, 0.12);
  font-family: KaiTi, STKaiti, serif;
  font-size: clamp(2.4rem, 4vw, 4rem);
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.08em;
  user-select: none;
}

.deck-summary-grid {
  display: grid;
  grid-template-columns: 1.7fr repeat(5, minmax(0, 1fr));
  gap: 0.28rem;
  margin-top: 1rem;
}

.deck-summary-card {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-height: 5.55rem;
  border: 1px solid rgba(215, 164, 82, 0.18);
  border-radius: 0.9rem;
  background: linear-gradient(180deg, rgba(21, 34, 54, 0.92), rgba(10, 18, 30, 0.9));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  padding: 0 1rem;
}

.deck-summary-card.is-wide {
  min-width: 0;
}

.deck-summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid rgba(215, 164, 82, 0.24);
  border-radius: 0.7rem;
  background: linear-gradient(180deg, rgba(28, 45, 68, 0.84), rgba(11, 18, 29, 0.9));
  color: #f4c76f;
}

.deck-summary-icon :deep(svg) {
  width: 1.2rem;
  height: 1.2rem;
}

.deck-summary-label {
  margin: 0;
  color: #b3becc;
  font-size: 0.85rem;
  font-weight: 700;
}

.deck-summary-value {
  margin: 0.28rem 0 0;
  color: #f8fafc;
  font-size: clamp(1.15rem, 1.35vw, 1.55rem);
  font-weight: 900;
  line-height: 1.15;
}

.deck-summary-value.is-gold {
  color: #f4c76f;
}

.deck-summary-value.is-blue {
  color: #9ab4ff;
}

.deck-alert-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.9rem;
  border: 1px solid rgba(244, 199, 111, 0.22);
  border-radius: 0.9rem;
  background: linear-gradient(180deg, rgba(89, 62, 20, 0.18), rgba(34, 23, 10, 0.24));
  padding: 0.85rem 1rem;
}

.deck-alert-copy {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  color: #f7ddb0;
}

.deck-alert-copy strong,
.deck-alert-copy p {
  margin: 0;
}

.deck-alert-copy p {
  margin-top: 0.2rem;
  color: #d5c3a1;
  font-size: 0.8rem;
}

.deck-alert-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.deck-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
  margin-top: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 0.9rem;
  background: linear-gradient(180deg, rgba(17, 29, 47, 0.86), rgba(9, 16, 28, 0.94));
  padding: 0.75rem 0.9rem;
}

.deck-filter-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.deck-filter-group.is-secondary {
  margin-left: auto;
}

.deck-filter-divider {
  width: 1px;
  height: 1.8rem;
  background: rgba(148, 163, 184, 0.18);
}

.deck-filter-chip {
  border: 1px solid rgba(215, 164, 82, 0.22);
  border-radius: 0.72rem;
  background: rgba(20, 31, 50, 0.62);
  color: #dbe4f0;
  padding: 0.52rem 0.95rem;
  font-size: 0.82rem;
  font-weight: 800;
  cursor: pointer;
}

.deck-filter-chip.is-secondary {
  border-color: rgba(148, 163, 184, 0.16);
  color: #b6c0cf;
}

.deck-filter-chip.is-active {
  border-color: rgba(244, 199, 111, 0.52);
  background: linear-gradient(180deg, rgba(246, 192, 98, 0.94), rgba(199, 129, 28, 0.82));
  color: #1e1609;
  box-shadow: 0 6px 18px rgba(215, 164, 82, 0.22);
}

.deck-bar-legend {
  display: inline-flex;
  align-items: center;
  gap: 1.4rem;
  color: #c4cede;
  font-size: 0.82rem;
  font-weight: 700;
}

.deck-bar-legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.deck-bar-legend i {
  width: 1.6rem;
  height: 0.55rem;
  border-radius: 999px;
  display: inline-block;
}

.deck-bar-legend i.is-seen {
  background: linear-gradient(90deg, #f6c062, #d99224);
}

.deck-bar-legend i.is-remaining {
  background: linear-gradient(90deg, #718dc7, #94aef0);
}

.deck-table-shell {
  margin-top: 0.85rem;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 0.95rem;
  background: rgba(6, 12, 22, 0.52);
}

.deck-table {
  width: 100%;
  border-collapse: collapse;
  color: #e6edf7;
  table-layout: fixed;
}

.deck-table thead {
  background: rgba(31, 44, 67, 0.72);
}

.deck-table th,
.deck-table td {
  padding: 0.92rem 0.82rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-table th {
  color: #b3becc;
  font-size: 0.82rem;
  font-weight: 800;
}

.deck-table tbody tr {
  background: rgba(8, 16, 28, 0.42);
}

.deck-table tbody tr:hover {
  background: rgba(215, 164, 82, 0.05);
}

.deck-card-name-cell {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.deck-card-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  flex: 0 0 auto;
  border: 1px solid rgba(215, 164, 82, 0.2);
  border-radius: 999px;
  background: rgba(27, 40, 60, 0.84);
  color: #f4c76f;
  font-size: 0.74rem;
  font-weight: 900;
}

.deck-card-glyph.is-basic {
  border-color: rgba(215, 164, 82, 0.28);
  color: #f4c76f;
}

.deck-card-glyph.is-trick {
  border-color: rgba(122, 163, 245, 0.28);
  color: #a5befc;
}

.deck-card-glyph.is-equip {
  border-color: rgba(88, 212, 121, 0.28);
  color: #7ce79d;
}

.deck-card-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #f2f6fb;
  font-weight: 800;
}

.is-seen-text {
  color: #f6c062;
  font-weight: 800;
}

.is-remaining-text {
  color: #a5befc;
  font-weight: 800;
}

.deck-distribution-wrap {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.deck-distribution-bar {
  display: flex;
  width: 100%;
  max-width: 20.5rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(20, 27, 40, 0.92);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.1);
}

.deck-distribution-seen,
.deck-distribution-remaining {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.6rem;
  font-size: 0.78rem;
  font-weight: 800;
}

.deck-distribution-seen {
  background: linear-gradient(90deg, #f6c062, #dc9727);
  color: #fff6e7;
}

.deck-distribution-remaining {
  background: linear-gradient(90deg, #627eaf, #8fa8e6);
  color: #eef3ff;
}

.deck-row-state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 0.42rem;
  padding: 0.22rem 0.48rem;
  font-size: 0.72rem;
  font-weight: 900;
}

.deck-row-state.is-warning {
  background: rgba(134, 45, 45, 0.86);
  color: #fff1f1;
}

.deck-row-state.is-danger {
  background: rgba(164, 34, 34, 0.94);
  color: #fff2f2;
}

.deck-empty-state {
  padding: 1.4rem 1rem;
  color: #9dabbc;
  text-align: center;
}

.deck-pager-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.75rem;
}

.deck-pager-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.85rem;
  color: #aab5c5;
  font-size: 0.8rem;
}

.deck-over-limit-note {
  color: #f2b2a8;
  font-weight: 800;
}

.deck-pager {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.deck-pager-button,
.deck-pager-current {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.52rem;
  background: rgba(19, 31, 50, 0.82);
  color: #deebf7;
}

.deck-pager-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.deck-pager-button :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.deck-pager-current {
  border-color: rgba(244, 199, 111, 0.42);
  color: #f4c76f;
  font-weight: 900;
}

.deck-pager-total {
  color: #b6c0cf;
  font-weight: 700;
}

.deck-ops-panel {
  margin-top: 0.9rem;
}

.deck-ops-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.8rem;
}

.deck-ops-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.85rem;
}

.deck-remaining-input {
  width: 7rem;
}

.deck-profile-switcher {
  display: grid;
  gap: 0.45rem;
  margin-top: 0.85rem;
  color: #dce5f2;
  font-size: 0.86rem;
  font-weight: 700;
}

.deck-footnote {
  margin: 0.85rem 0 0;
  color: #8d9bad;
  font-size: 0.76rem;
}

@media (max-width: 1280px) {
  .deck-summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .deck-summary-card.is-wide {
    grid-column: span 3;
  }

  .deck-ops-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .deck-stats-head,
  .deck-alert-strip,
  .deck-pager-row {
    flex-direction: column;
    align-items: stretch;
  }

  .deck-filter-group.is-secondary {
    margin-left: 0;
  }

  .deck-filter-divider {
    display: none;
  }

  .deck-bar-legend {
    width: 100%;
    justify-content: flex-end;
  }

  .deck-table-shell {
    overflow-x: auto;
  }

  .deck-table {
    min-width: 52rem;
  }
}

@media (max-width: 640px) {
  .deck-stats-shell {
    padding: 0.85rem;
  }

  .deck-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .deck-summary-card.is-wide {
    grid-column: span 2;
  }

  .deck-ops-grid {
    grid-template-columns: 1fr;
  }
}
</style>
