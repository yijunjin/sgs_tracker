<script setup lang="ts">
import { computed, ref } from "vue"
import { Activity, FileText, Play, RefreshCw, RotateCcw, Shield, Square, WandSparkles } from "lucide-vue-next"
import UiTag from "./ui/UiTag.vue"

const props = defineProps<{
  engineStatus: "idle" | "loading" | "ready" | "failed"
  engineError: string
  manualText: string
  recognizedPreview: string
  rawPreview: string
  mergedPreview: string
  hasCanvas: boolean
  hasAutoSource: boolean
  autoListening: boolean
  autoModeLabel: string
  autoStatus: string
  autoModeNote: string
  isOcrRunning: boolean
  lastOcrAt: string
  autoError: string
  onlyNewVisibleLines: boolean
  logProcessingOrder: "oldest -> newest" | "newest -> oldest"
  deckRemainingRawText: string
  stableDeckRemaining?: number | undefined
  autoStartOnChooseGeneral: boolean
  autoResetOnNewGame: boolean
  autoAcceptStrictEvents: boolean
  requireConfirmReshuffle: boolean
  chooseLineCount: number
  lastStartSignal: string
  currentGameStartSignature: string
  hasEnteredInGame: boolean
  pendingEventCount: number
  metrics: {
    rawLineCount: number
    mergedLineCount: number
    newLineCount: number
    ignoredLineCount: number
    strictEventCount: number
    ambiguousEventCount: number
    unsupportedEventCount: number
    duplicateSkippedCount: number
    lastOcrDurationMs: number
  }
}>()

const emit = defineEmits<{
  (event: "run-real"): void
  (event: "run-mock"): void
  (event: "parse-text"): void
  (event: "start-auto"): void
  (event: "stop-auto"): void
  (event: "force-new-game"): void
  (event: "enter-mid-game"): void
  (event: "reprocess-current"): void
  (event: "clear-dedupe"): void
  (event: "update:manualText", value: string): void
  (event: "update:onlyNewVisibleLines", value: boolean): void
  (event: "update:logProcessingOrder", value: "oldest-first" | "newest-first"): void
  (event: "update:autoStartOnChooseGeneral", value: boolean): void
  (event: "update:autoResetOnNewGame", value: boolean): void
  (event: "update:autoAcceptStrictEvents", value: boolean): void
  (event: "update:requireConfirmReshuffle", value: boolean): void
  (event: "show-pending-events"): void
}>()

const activeRunPanel = ref<"logs" | "metrics">("logs")

const statusLabelMap = {
  idle: "idle",
  loading: "loading",
  ready: "ready",
  failed: "failed"
} as const

const recognizedRows = computed(() =>
  props.recognizedPreview
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-6)
    .reverse()
    .map((text, index) => {
      const match = text.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$/)
      return {
        id: `${index}-${text}`,
        time: match?.[1] ?? "--:--",
        content: match?.[2] || text
      }
    })
)
</script>

<template>
  <section class="glass-panel p-4">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="section-title section-title-row"><Activity class="section-title-icon" />OCR 运行台</h2>
        <p class="mt-1 text-xs muted">自动监听先做日志区图片差异检测，稳定后才触发 OCR。</p>
      </div>
      <UiTag :variant="engineStatus === 'ready' ? 'success' : engineStatus === 'failed' ? 'danger' : 'muted'" dot>
        引擎状态：{{ statusLabelMap[engineStatus] }}
      </UiTag>
    </div>

    <div class="mt-4 grid gap-3 lg:grid-cols-3">
      <button
        class="action-button success-button"
        type="button"
        :disabled="autoListening || !hasAutoSource"
        @click="emit('start-auto')"
      >
        <Play class="button-icon" />
        启动守护监听
      </button>
      <button class="action-button secondary-button blue-button" type="button" :disabled="!hasAutoSource" @click="emit('force-new-game')">
        <RotateCcw class="button-icon" />
        手动开始新局
      </button>
      <button class="action-button secondary-button" type="button" :disabled="!hasCanvas || engineStatus === 'loading' || isOcrRunning" @click="emit('run-real')">
        <WandSparkles class="button-icon" />
        单次 OCR
      </button>
      <button
        class="action-button secondary-button"
        type="button"
        :disabled="!autoListening"
        @click="emit('stop-auto')"
      >
        <Square class="button-icon" />
        停止自动监听
      </button>
      <button class="action-button secondary-button" type="button" :disabled="!hasAutoSource" @click="emit('enter-mid-game')">
        <Shield class="button-icon" />
        中途接入
      </button>
      <button class="action-button secondary-button" type="button" @click="emit('run-mock')">
        <FileText class="button-icon" />
        示例 OCR
      </button>
    </div>

    <div class="mt-4 grid gap-3 text-sm md:grid-cols-3">
      <div class="metric-card">
        <p class="metric-label">当前模式</p>
        <p class="metric-value gold-text">{{ autoModeLabel }}</p>
        <p v-if="autoModeNote" class="mt-2 text-xs text-amber-100">{{ autoModeNote }}</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">运行状态</p>
        <p class="metric-value two-line-value">{{ autoStatus }}</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">最近 OCR 时间</p>
        <p class="metric-value">{{ lastOcrAt || "暂无" }}</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">剩余牌堆 OCR</p>
        <p class="metric-value">{{ deckRemainingRawText || "已开启" }}</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">稳定剩余牌数</p>
        <p class="metric-value gold-text">{{ stableDeckRemaining ?? "暂无" }}</p>
      </div>
      <div class="metric-card">
        <p class="metric-label">游戏开始检测</p>
        <p class="metric-value">{{ hasEnteredInGame ? "已检测" : "等待中" }}</p>
      </div>
    </div>

    <div class="run-tabs mt-4" role="tablist" aria-label="OCR 运行面板">
      <button
        class="run-tab-button"
        :class="{ active: activeRunPanel === 'logs' }"
        type="button"
        role="tab"
        :aria-selected="activeRunPanel === 'logs'"
        @click="activeRunPanel = 'logs'"
      >
        最近日志
      </button>
      <button class="run-tab-button" type="button" @click="emit('show-pending-events')">
        待确认事件（{{ pendingEventCount }}）
      </button>
      <button
        class="run-tab-button"
        :class="{ active: activeRunPanel === 'metrics' }"
        type="button"
        role="tab"
        :aria-selected="activeRunPanel === 'metrics'"
        @click="activeRunPanel = 'metrics'"
      >
        调试指标
      </button>
    </div>

    <div v-if="activeRunPanel === 'logs'" class="mt-3 overflow-hidden rounded-lg border border-slate-800/70">
      <table class="data-table compact-log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>事件内容</th>
            <th>来源</th>
            <th>置信度</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in recognizedRows" :key="row.id">
            <td>{{ row.time }}</td>
            <td>{{ row.content }}</td>
            <td>日志</td>
            <td><span class="confidence-pill">--</span></td>
          </tr>
          <tr v-if="recognizedRows.length === 0">
            <td colspan="4" class="text-center text-slate-500">暂无 OCR 输出</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="status-metrics">
      <div><span>已处理行</span><strong>{{ metrics.rawLineCount }}</strong></div>
      <div><span>合并行</span><strong>{{ metrics.mergedLineCount }}</strong></div>
      <div><span>丢弃行</span><strong>{{ metrics.duplicateSkippedCount }}</strong></div>
      <div><span>本轮耗时</span><strong>{{ metrics.lastOcrDurationMs }}ms</strong></div>
    </div>

    <p v-if="engineError || autoError" class="mt-4 rounded-2xl border border-red-400/20 bg-red-950/30 px-4 py-3 text-sm text-red-200">
      {{ autoError || engineError }}
    </p>

    <details class="compact-details mt-4">
      <summary>手动文本、监听选项与调试输出</summary>
      <div class="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <label class="metric-card">
          <span class="metric-label">自动识别开局并开始监听</span>
          <span class="mt-2 flex items-center gap-2 text-slate-200">
            <input
              :checked="autoStartOnChooseGeneral"
              class="h-4 w-4 rounded border-slate-600 bg-slate-900"
              type="checkbox"
              @change="emit('update:autoStartOnChooseGeneral', ($event.target as HTMLInputElement).checked)"
            />
            开启
          </span>
        </label>
        <label class="metric-card">
          <span class="metric-label">检测到新局后自动重置</span>
          <span class="mt-2 flex items-center gap-2 text-slate-200">
            <input
              :checked="autoResetOnNewGame"
              class="h-4 w-4 rounded border-slate-600 bg-slate-900"
              type="checkbox"
              @change="emit('update:autoResetOnNewGame', ($event.target as HTMLInputElement).checked)"
            />
            开启
          </span>
        </label>
        <label class="metric-card">
          <span class="metric-label">自动接受严格有效事件</span>
          <span class="mt-2 flex items-center gap-2 text-slate-200">
            <input
              :checked="autoAcceptStrictEvents"
              class="h-4 w-4 rounded border-slate-600 bg-slate-900"
              type="checkbox"
              @change="emit('update:autoAcceptStrictEvents', ($event.target as HTMLInputElement).checked)"
            />
            开启
          </span>
        </label>
        <label class="metric-card">
          <span class="metric-label">洗牌提示需要人工确认</span>
          <span class="mt-2 flex items-center gap-2 text-slate-200">
            <input
              :checked="requireConfirmReshuffle"
              class="h-4 w-4 rounded border-slate-600 bg-slate-900"
              type="checkbox"
              @change="emit('update:requireConfirmReshuffle', ($event.target as HTMLInputElement).checked)"
            />
            开启
          </span>
        </label>
        <label class="metric-card">
          <span class="metric-label">去重模式</span>
          <span class="mt-2 flex items-center gap-2 text-slate-200">
            <input
              :checked="onlyNewVisibleLines"
              class="h-4 w-4 rounded border-slate-600 bg-slate-900"
              type="checkbox"
              @change="emit('update:onlyNewVisibleLines', ($event.target as HTMLInputElement).checked)"
            />
            仅处理新增日志行
          </span>
        </label>
        <div class="metric-card">
          <p class="metric-label">日志处理顺序</p>
          <p class="metric-value">{{ logProcessingOrder }}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="action-button secondary-button compact-action" type="button" @click="emit('update:logProcessingOrder', 'oldest-first')">
              oldest -> newest
            </button>
            <button class="action-button secondary-button compact-action" type="button" @click="emit('update:logProcessingOrder', 'newest-first')">
              newest -> oldest
            </button>
          </div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-3">
        <button class="action-button secondary-button" type="button" :disabled="!mergedPreview" @click="emit('reprocess-current')">
          <RefreshCw class="button-icon" />
          重新处理当前截图
        </button>
        <button class="action-button secondary-button" type="button" @click="emit('clear-dedupe')">
          清空去重缓存
        </button>
        <button class="action-button secondary-button" type="button" @click="emit('parse-text')">
          <FileText class="button-icon" />
          解析文本
        </button>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <div class="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-200">识别文本预览</h3>
            <span class="text-xs muted">可直接编辑</span>
          </div>
          <textarea
            :value="manualText"
            class="input-shell min-h-44 w-full resize-y font-mono text-sm"
            placeholder="可以粘贴 OCR 文本，也可以先运行 Mock OCR。"
            @input="emit('update:manualText', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <div class="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-200">最近识别输出</h3>
            <span class="text-xs muted">用于排查 OCR 质量</span>
          </div>
          <pre class="min-h-44 overflow-auto rounded-xl bg-slate-950 p-4 text-sm leading-7 text-slate-200">{{ recognizedPreview || "暂无 OCR 输出" }}</pre>
        </div>

        <div class="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-200">合并断行前 OCR 行</h3>
            <span class="text-xs muted">raw</span>
          </div>
          <pre class="min-h-36 overflow-auto rounded-xl bg-slate-950 p-4 text-sm leading-7 text-slate-200">{{ rawPreview || "暂无 OCR 输出" }}</pre>
        </div>

        <div class="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-200">合并断行后日志行</h3>
            <span class="text-xs muted">parser input</span>
          </div>
          <pre class="min-h-36 overflow-auto rounded-xl bg-slate-950 p-4 text-sm leading-7 text-slate-200">{{ mergedPreview || "暂无合并结果" }}</pre>
        </div>
      </div>
    </details>
  </section>
</template>
