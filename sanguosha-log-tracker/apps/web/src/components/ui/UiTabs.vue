<script setup lang="ts">
import type { Component } from "vue"

defineProps<{
  modelValue: string
  items: Array<{
    value: string
    label: string
    icon?: Component | string
  }>
}>()

function isStringIcon(icon: Component | string | undefined): icon is string {
  return typeof icon === "string"
}

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void
}>()
</script>

<template>
  <nav class="ui-tabs">
    <button
      v-for="item in items"
      :key="item.value"
      class="ui-tab"
      type="button"
      :class="{ active: modelValue === item.value }"
      @click="emit('update:modelValue', item.value)"
    >
      <span v-if="isStringIcon(item.icon)">{{ item.icon }}</span>
      <component :is="item.icon" v-else-if="item.icon" class="ui-tab-icon" />
      {{ item.label }}
    </button>
  </nav>
</template>
