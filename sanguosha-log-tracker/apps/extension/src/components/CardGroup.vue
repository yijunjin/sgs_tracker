<script setup lang="ts">
import { ChevronDown, ChevronRight } from "lucide-vue-next"
import type { CardGroupView } from "../trackerStore"

// 一组牌（基本牌/锦囊牌/装备牌）的展示组件。
// 业务层已经把“每张牌剩余多少、哪些实体牌已见、是否闪烁”算进 group.rows，
// 这里只负责稳定地渲染行、格子和展开/收起交互。
defineProps<{
  group: CardGroupView
}>()

const emit = defineEmits<{
  toggle: [group: string]
}>()
</script>

<template>
  <section class="sgs-deck-section" :data-group="group.type">
    <button class="sgs-section-head" type="button" @click="emit('toggle', group.type)">
      <span class="sgs-chevron">
        <ChevronDown v-if="group.open" class="sgs-icon" aria-hidden="true" />
        <ChevronRight v-else class="sgs-icon" aria-hidden="true" />
      </span>
      <span>{{ group.label }}（{{ group.cardCount }}）</span>
      <strong>{{ group.remaining }}</strong>
    </button>
    <div class="sgs-section-body" :class="{ 'is-closed': !group.open }">
      <div
        v-for="row in group.rows"
        :key="row.name"
        class="sgs-card-row"
        :class="{ 'is-empty': row.exhausted }"
        :data-card-name="row.name"
      >
        <div class="sgs-card-name">
          <span>{{ row.name }}</span><b>× {{ row.left }}</b>
        </div>
        <div class="sgs-card-cells">
          <span
            v-for="chip in row.chips"
            :key="chip.key"
            class="sgs-card-chip"
            :class="{
              'is-seen': chip.state !== 'remaining',
              'is-player-visible': chip.state === 'player-visible',
              'is-field': chip.state === 'equip' || chip.state === 'judge-area' || chip.state === 'skill-pile',
              'is-judge-area': chip.state === 'judge-area',
              'is-skill-pile': chip.state === 'skill-pile',
              'is-red': chip.isRed,
              'is-pulsing': chip.pulsing && chip.state !== 'remaining'
            }"
            :title="chip.title"
          >
            <img v-if="chip.suitIconUrl" class="sgs-suit-icon" :src="chip.suitIconUrl" :alt="chip.suitSymbol" />
            <span v-else-if="chip.suitSymbol" class="sgs-suit-symbol">{{ chip.suitSymbol }}</span>
            <span>{{ chip.label }}</span>
          </span>
          <span v-if="row.overflowCount > 0" class="sgs-card-overflow">+{{ row.overflowCount }}</span>
        </div>
        <div class="sgs-card-seen">已见 {{ row.seen }}</div>
      </div>
    </div>
  </section>
</template>
