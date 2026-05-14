<script setup lang="ts">
import type { Component } from "vue"

withDefaults(
  defineProps<{
    active?: boolean
    dot?: boolean
    icon?: Component
    interactive?: boolean
    variant?: "default" | "gold" | "success" | "warning" | "danger" | "muted"
  }>(),
  {
    active: false,
    dot: false,
    interactive: false,
    variant: "default"
  }
)

const emit = defineEmits<{
  (event: "click"): void
}>()
</script>

<template>
  <button
    v-if="interactive"
    class="ui-tag"
    type="button"
    :class="[`is-${variant}`, { active }]"
    @click="emit('click')"
  >
    <span v-if="dot" class="ui-tag-dot" />
    <component :is="icon" v-if="icon" class="ui-tag-icon" />
    <slot />
  </button>
  <span v-else class="ui-tag" :class="[`is-${variant}`, { active }]">
    <span v-if="dot" class="ui-tag-dot" />
    <component :is="icon" v-if="icon" class="ui-tag-icon" />
    <slot />
  </span>
</template>
