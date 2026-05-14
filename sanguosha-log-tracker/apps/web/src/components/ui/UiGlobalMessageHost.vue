<script setup lang="ts">
import { X } from "lucide-vue-next"

import { useGlobalMessage } from "../../composables/useGlobalMessage"

const { dismissGlobalMessage, messages } = useGlobalMessage()
</script>

<template>
  <Teleport to="body">
    <div class="ui-global-message-host" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="ui-global-message-list">
        <article
          v-for="message in messages"
          :key="message.id"
          :class="['ui-global-message', `is-${message.variant}`]"
        >
          <p>{{ message.text }}</p>
          <button class="ui-global-message-close" type="button" @click="dismissGlobalMessage(message.id)">
            <X class="button-icon" />
          </button>
        </article>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.ui-global-message-host {
  position: fixed;
  top: 1.15rem;
  right: 1.15rem;
  z-index: 95;
  display: grid;
  gap: 0.7rem;
  width: min(24rem, calc(100vw - 2rem));
}

.ui-global-message {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.9rem;
  background: linear-gradient(180deg, rgba(12, 22, 36, 0.96), rgba(6, 13, 24, 0.96));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3);
  padding: 0.9rem 1rem;
}

.ui-global-message.is-success {
  border-color: rgba(88, 212, 121, 0.28);
}

.ui-global-message.is-error {
  border-color: rgba(248, 113, 113, 0.26);
}

.ui-global-message.is-info {
  border-color: rgba(244, 199, 111, 0.28);
}

.ui-global-message p {
  margin: 0;
  color: #e2e8f0;
  font-size: 0.88rem;
  line-height: 1.55;
}

.ui-global-message-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.7rem;
  background: rgba(18, 31, 50, 0.74);
  color: #cbd5e1;
}

.ui-global-message-list-enter-active,
.ui-global-message-list-leave-active {
  transition: all 0.18s ease;
}

.ui-global-message-list-enter-from,
.ui-global-message-list-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
