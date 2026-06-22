<script setup lang="ts">
import type { EnemyHandView } from "../trackerStore"

// 敌方已知手牌面板。
// hands 已经在 content.ts 里过滤掉自己和队友，只保留仍处于 player-visible 的敌方牌。
// 当敌人打出/弃置/装备这些牌时，业务层会把 zone 改成 public/equip，本组件自然不再显示。
defineProps<{
  hands: EnemyHandView[]
}>()
</script>

<template>
  <section v-if="hands.length" class="sgs-known-zone">
    <div class="sgs-known-zone-head">
      <span>敌方已知手牌</span>
      <strong>{{ hands.length }}</strong>
    </div>
    <div class="sgs-known-zone-body">
      <div v-for="hand in hands" :key="hand.key" class="sgs-enemy-hand">
        <div class="sgs-enemy-hand-name">
          {{ hand.label }}<b>{{ hand.count }}</b>
        </div>
        <div class="sgs-enemy-hand-cards">
          <span
            v-for="card in hand.cards"
            :key="card.key"
            class="sgs-hand-card"
            :class="{ 'is-red': card.isRed }"
            :title="card.title"
          >
            <span class="sgs-hand-card-name">{{ card.nameLabel }}</span>
            <span class="sgs-hand-card-meta" :class="{ 'is-empty': !card.hasMeta }">
              <img v-if="card.suitIconUrl" class="sgs-suit-icon" :src="card.suitIconUrl" :alt="card.suitSymbol" />
              <span v-else-if="card.suitSymbol" class="sgs-suit-symbol">{{ card.suitSymbol }}</span>
              {{ card.rankLabel }}
            </span>
          </span>
          <span v-if="hand.moreCount > 0" class="sgs-hand-more">+{{ hand.moreCount }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
