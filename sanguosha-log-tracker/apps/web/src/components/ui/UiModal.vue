<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue"
import { X } from "lucide-vue-next"

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    description?: string
    widthClass?: string
    closeOnBackdrop?: boolean
  }>(),
  {
    description: "",
    widthClass: "max-w-5xl",
    closeOnBackdrop: true
  }
)

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void
}>()

function close(): void {
  emit("update:modelValue", false)
}

function handleBackdropClick(): void {
  if (props.closeOnBackdrop) {
    close()
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && props.modelValue) {
    close()
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown)
  document.body.style.overflow = ""
})

watch(
  () => props.modelValue,
  (open) => {
    document.body.style.overflow = open ? "hidden" : ""
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ui-modal-fade">
      <div v-if="modelValue" class="ui-modal-backdrop" @click="handleBackdropClick">
        <section :class="['ui-modal-panel', widthClass]" @click.stop>
          <header class="ui-modal-header">
            <div>
              <h3>{{ title }}</h3>
              <p v-if="description">{{ description }}</p>
            </div>
            <button class="ui-modal-close" type="button" @click="close">
              <X class="button-icon" />
            </button>
          </header>

          <div class="ui-modal-body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="ui-modal-footer">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ui-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  background: rgba(2, 6, 14, 0.74);
  backdrop-filter: blur(10px);
}

.ui-modal-panel {
  width: min(100%, 72rem);
  max-height: min(88vh, 60rem);
  overflow: hidden;
  border: 1px solid rgba(244, 199, 111, 0.2);
  border-radius: 1rem;
  background: linear-gradient(180deg, rgba(13, 24, 40, 0.98), rgba(6, 13, 24, 0.98));
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.42);
}

.ui-modal-header,
.ui-modal-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.2rem;
}

.ui-modal-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.ui-modal-header h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.05rem;
  font-weight: 800;
}

.ui-modal-header p {
  margin: 0.35rem 0 0;
  color: #94a3b8;
  font-size: 0.85rem;
}

.ui-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.7rem;
  background: rgba(18, 31, 50, 0.74);
  color: #cbd5e1;
}

.ui-modal-body {
  max-height: calc(88vh - 9rem);
  overflow: auto;
  padding: 1rem 1.2rem 1.2rem;
}

.ui-modal-footer {
  justify-content: flex-end;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.ui-modal-fade-enter-active,
.ui-modal-fade-leave-active {
  transition: opacity 0.18s ease;
}

.ui-modal-fade-enter-from,
.ui-modal-fade-leave-to {
  opacity: 0;
}
</style>