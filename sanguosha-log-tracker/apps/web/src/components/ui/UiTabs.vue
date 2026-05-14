<script setup lang="ts">
defineProps<{
  modelValue: string
  items: Array<{
    value: string
    label: string
    icon?: string
  }>
}>()

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
      <span v-if="item.icon">{{ item.icon }}</span>
      {{ item.label }}
    </button>
  </nav>
</template>
