<script setup lang="ts">
defineProps<{
  engineStatus: "idle" | "loading" | "ready" | "failed"
  engineError: string
  manualText: string
  recognizedPreview: string
  rawPreview: string
  mergedPreview: string
  hasCanvas: boolean
  hasAutoSource: boolean
  autoListening: boolean
  autoStatus: string
  isOcrRunning: boolean
  lastOcrAt: string
  autoError: string
}>()

const emit = defineEmits<{
  (event: "run-real"): void
  (event: "run-mock"): void
  (event: "parse-text"): void
  (event: "start-auto"): void
  (event: "stop-auto"): void
  (event: "reprocess-current"): void
  (event: "clear-dedupe"): void
  (event: "update:manualText", value: string): void
}>()

const statusLabelMap = {
  idle: "idle",
  loading: "loading",
  ready: "ready",
  failed: "failed"
} as const
</script>

<template>
  <section class="glass-panel rounded-3xl p-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="section-title">OCR 识别结果</h2>
        <p class="mt-1 text-sm muted">自动监听先做日志区图片差异检测，稳定后才触发 OCR。</p>
      </div>
      <span class="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
        引擎状态：{{ statusLabelMap[engineStatus] }}
      </span>
    </div>

    <div class="mt-4 flex flex-wrap gap-3">
      <button class="action-button" type="button" :disabled="!hasCanvas || engineStatus === 'loading' || isOcrRunning" @click="emit('run-real')">
        运行真实 OCR
      </button>
      <button class="action-button secondary-button" type="button" @click="emit('run-mock')">
        使用 Mock OCR 识别示例日志
      </button>
      <button class="action-button secondary-button" type="button" @click="emit('parse-text')">
        解析文本
      </button>
      <button
        class="action-button"
        type="button"
        :disabled="autoListening || !hasAutoSource"
        @click="emit('start-auto')"
      >
        开始自动监听
      </button>
      <button
        class="action-button secondary-button"
        type="button"
        :disabled="!autoListening"
        @click="emit('stop-auto')"
      >
        停止自动监听
      </button>
    </div>

    <div class="mt-4 grid gap-3 text-sm md:grid-cols-3">
      <div class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <p class="text-xs text-slate-500">识别状态</p>
        <p class="mt-1 font-semibold text-slate-100">{{ autoStatus }}</p>
      </div>
      <div class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <p class="text-xs text-slate-500">当前是否 OCR 中</p>
        <p class="mt-1 font-semibold text-slate-100">{{ isOcrRunning ? "是" : "否" }}</p>
      </div>
      <div class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <p class="text-xs text-slate-500">最近一次 OCR 时间</p>
        <p class="mt-1 font-semibold text-slate-100">{{ lastOcrAt || "暂无" }}</p>
      </div>
    </div>

    <p v-if="engineError || autoError" class="mt-4 rounded-2xl border border-red-400/20 bg-red-950/30 px-4 py-3 text-sm text-red-200">
      {{ autoError || engineError }}
    </p>

    <div class="mt-4 flex flex-wrap gap-3">
      <button class="action-button secondary-button" type="button" :disabled="!mergedPreview" @click="emit('reprocess-current')">
        重新处理当前截图
      </button>
      <button class="action-button secondary-button" type="button" @click="emit('clear-dedupe')">
        清空去重缓存
      </button>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200">识别文本预览</h3>
          <span class="text-xs muted">可直接编辑</span>
        </div>
        <textarea
          :value="manualText"
          class="input-shell min-h-60 w-full resize-y font-mono text-sm"
          placeholder="可以粘贴 OCR 文本，也可以先运行 Mock OCR。"
          @input="emit('update:manualText', ($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200">最近识别输出</h3>
          <span class="text-xs muted">用于排查 OCR 质量</span>
        </div>
        <pre class="min-h-60 overflow-auto rounded-xl bg-slate-950 p-4 text-sm leading-7 text-slate-200">{{ recognizedPreview || "暂无 OCR 输出" }}</pre>
      </div>

      <div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200">合并断行前 OCR 行</h3>
          <span class="text-xs muted">raw</span>
        </div>
        <pre class="min-h-48 overflow-auto rounded-xl bg-slate-950 p-4 text-sm leading-7 text-slate-200">{{ rawPreview || "暂无 OCR 输出" }}</pre>
      </div>

      <div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-200">合并断行后日志行</h3>
          <span class="text-xs muted">parser input</span>
        </div>
        <pre class="min-h-48 overflow-auto rounded-xl bg-slate-950 p-4 text-sm leading-7 text-slate-200">{{ mergedPreview || "暂无合并结果" }}</pre>
      </div>
    </div>
  </section>
</template>
