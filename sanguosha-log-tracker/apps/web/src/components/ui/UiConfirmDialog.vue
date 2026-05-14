<script setup lang="ts">
import { computed } from "vue"

import UiModal from "./UiModal.vue"

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    message: string
    description?: string
    confirmText?: string
    cancelText?: string
    confirmVariant?: "primary" | "secondary" | "danger"
    pending?: boolean
  }>(),
  {
    description: "",
    confirmText: "确认",
    cancelText: "取消",
    confirmVariant: "danger",
    pending: false
  }
)

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void
  (event: "confirm"): void
}>()

const confirmButtonClass = computed(() => {
  if (props.confirmVariant === "secondary") {
    return "secondary-button"
  }
  if (props.confirmVariant === "primary") {
    return ""
  }
  return "danger-button"
})

function close(): void {
  if (!props.pending) {
    emit("update:modelValue", false)
  }
}

function confirm(): void {
  if (!props.pending) {
    emit("confirm")
  }
}
</script>

<template>
  <UiModal
    :model-value="modelValue"
    :title="title"
    :description="description ?? ''"
    width-class="max-w-lg"
    @update:model-value="close"
  >
    <p class="ui-confirm-message">{{ message }}</p>

    <template #footer>
      <button class="action-button secondary-button" type="button" :disabled="pending" @click="close">
        {{ cancelText }}
      </button>
      <button :class="['action-button', confirmButtonClass]" type="button" :disabled="pending" @click="confirm">
        {{ pending ? '处理中...' : confirmText }}
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.ui-confirm-message {
  margin: 0;
  color: #d6deea;
  line-height: 1.75;
}
</style>
