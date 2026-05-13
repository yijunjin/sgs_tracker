<script setup lang="ts">
defineProps<{
  originalSrc: string
  croppedSrc: string
  processedSrc: string
}>()

const previewCards = [
  { key: "originalSrc", title: "原始画面" },
  { key: "croppedSrc", title: "裁剪后日志区域" },
  { key: "processedSrc", title: "预处理后画面" }
] as const
</script>

<template>
  <section class="glass-panel rounded-3xl p-5">
    <div class="flex items-center justify-between gap-3">
      <h2 class="section-title">裁剪与预处理预览</h2>
      <span class="text-xs muted">灰度 + 对比度增强 + 简单二值化</span>
    </div>

    <div class="mt-4 grid gap-4">
      <article
        v-for="card in previewCards"
        :key="card.key"
        class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70"
      >
        <div class="border-b border-slate-800 px-4 py-3 text-sm text-slate-300">
          {{ card.title }}
        </div>
        <div class="flex min-h-44 items-center justify-center p-4">
          <img
            v-if="$props[card.key]"
            :src="$props[card.key]"
            :alt="card.title"
            class="max-h-56 w-full rounded-xl object-contain"
          />
          <p v-else class="text-sm muted">等待画面输入</p>
        </div>
      </article>
    </div>
  </section>
</template>
