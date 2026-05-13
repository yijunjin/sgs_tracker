<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { createVisibleLogDeduper, mergeBrokenOcrLines, parseLogInput, type OcrLine } from "@slt/shared"

import CapturePanel from "./components/CapturePanel.vue"
import CropPreview from "./components/CropPreview.vue"
import DeckPanel from "./components/DeckPanel.vue"
import OcrPanel from "./components/OcrPanel.vue"
import ParsedEventsPanel from "./components/ParsedEventsPanel.vue"
import RecentEvents from "./components/RecentEvents.vue"
import { useOcr } from "./composables/useOcr"
import { useScreenCapture } from "./composables/useScreenCapture"
import { useTrackerSession } from "./composables/useTrackerSession"

const screen = useScreenCapture()
const ocr = useOcr()
const session = useTrackerSession()
const capturePanelRef = ref<{ getVideoElement: () => HTMLVideoElement | null } | null>(null)

const captureIntervalMs = 300
const minOcrIntervalMs = 1200
const stableDelayMs = 400
const diffThreshold = 6
const visibleLogDeduper = createVisibleLogDeduper()
const autoListening = ref(false)
const autoStatus = ref("未启动")
const autoError = ref("")
const lastOcrAt = ref("")
let autoTimer: number | undefined
let lastOcrAtMs = 0
let dirtyAtMs = 0
let previousFingerprint: Uint8ClampedArray | undefined

const apiStatusLabel = computed(() => {
  switch (session.apiStatus.value) {
    case "online":
      return `在线（${session.runtimeMode.value === "remote" ? "API 会话" : "本地模式"}）`
    case "offline":
      return "离线（前端本地模式）"
    default:
      return "检查中"
  }
})

async function parseCurrentText(source: "ocr" | "manual" | "mock"): Promise<void> {
  if (!ocr.text.value.trim()) {
    ocr.setError("当前没有可解析文本。请先运行 OCR 或粘贴日志文本。")
    return
  }

  ocr.setError("")
  const events = parseLogInput(ocr.text.value, source, session.deckProfile.value)
  await session.ingestParsedEvents(events)
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

function createImageFingerprint(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const size = 32
  const sampleCanvas = document.createElement("canvas")
  sampleCanvas.width = size
  sampleCanvas.height = size
  const context = sampleCanvas.getContext("2d", { willReadFrequently: true })
  if (!context) {
    return new Uint8ClampedArray(size * size)
  }

  context.drawImage(canvas, 0, 0, size, size)
  const imageData = context.getImageData(0, 0, size, size)
  const fingerprint = new Uint8ClampedArray(size * size)

  for (let index = 0, pixel = 0; index < imageData.data.length; index += 4, pixel += 1) {
    const red = imageData.data[index] ?? 0
    const green = imageData.data[index + 1] ?? 0
    const blue = imageData.data[index + 2] ?? 0
    fingerprint[pixel] = Math.round(0.299 * red + 0.587 * green + 0.114 * blue)
  }

  return fingerprint
}

function meanAbsoluteDifference(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
  const length = Math.min(left.length, right.length)
  if (length === 0) {
    return 0
  }

  let total = 0
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
  }

  return total / length
}

async function ingestOcrLines(
  rawLines: OcrLine[],
  source: "ocr" | "mock",
  onlyNewVisibleLines: boolean
): Promise<void> {
  const mergedLines = mergeBrokenOcrLines(rawLines, session.deckProfile.value)
  ocr.setRecognitionResult(rawLines, mergedLines)
  const linesForParse = onlyNewVisibleLines ? visibleLogDeduper.getNewLines(mergedLines) : mergedLines
  const events = parseLogInput(linesForParse, source, session.deckProfile.value)
  await session.ingestParsedEvents(events)
}

async function runRealOcr(): Promise<void> {
  const canvas = screen.activeCanvas.value
  if (!canvas) {
    ocr.setError("请先生成示例日志截图、上传图片，或截取当前屏幕画面。")
    return
  }

  try {
    const lines = await ocr.runRealOcr(canvas)
    await ingestOcrLines(lines, "ocr", true)
    lastOcrAtMs = Date.now()
    lastOcrAt.value = formatTime(lastOcrAtMs)
  } catch {
    return
  }
}

async function runMockOcr(): Promise<void> {
  const lines = await ocr.runMockOcr()
  await ingestOcrLines(lines, "mock", false)
}

async function runAutoOcr(canvas: HTMLCanvasElement): Promise<void> {
  if (ocr.isRecognizing.value) {
    return
  }

  try {
    autoStatus.value = "OCR 中"
    autoError.value = ""
    const lines = await ocr.runRealOcr(canvas)
    await ingestOcrLines(lines, "ocr", true)
    lastOcrAtMs = Date.now()
    lastOcrAt.value = formatTime(lastOcrAtMs)
    dirtyAtMs = 0
    autoStatus.value = "监听中"
  } catch (error) {
    autoError.value = error instanceof Error ? error.message : "自动 OCR 失败。"
    stopAutoListening()
  }
}

function tickAutoListening(): void {
  const videoElement = capturePanelRef.value?.getVideoElement() ?? null
  const canvas = screen.captureCurrentRoiFrame(videoElement)
  if (!canvas) {
    autoStatus.value = "等待可用画面"
    return
  }

  const fingerprint = createImageFingerprint(canvas)
  const now = Date.now()

  if (previousFingerprint) {
    const diff = meanAbsoluteDifference(previousFingerprint, fingerprint)
    if (diff > diffThreshold) {
      dirtyAtMs = now
      autoStatus.value = `检测到日志区变化（diff ${diff.toFixed(1)}）`
    }
  } else {
    dirtyAtMs = now
  }

  previousFingerprint = fingerprint

  const isStable = dirtyAtMs > 0 && now - dirtyAtMs >= stableDelayMs
  const isOcrIntervalReady = now - lastOcrAtMs >= minOcrIntervalMs
  if (isStable && isOcrIntervalReady && !ocr.isRecognizing.value) {
    void runAutoOcr(canvas)
  }
}

function startAutoListening(): void {
  if (autoListening.value) {
    return
  }

  autoError.value = ""
  previousFingerprint = undefined
  dirtyAtMs = 0
  autoListening.value = true
  autoStatus.value = "监听中"
  autoTimer = window.setInterval(tickAutoListening, captureIntervalMs)
  tickAutoListening()
}

function stopAutoListening(): void {
  if (autoTimer) {
    window.clearInterval(autoTimer)
    autoTimer = undefined
  }

  autoListening.value = false
  autoStatus.value = autoError.value ? "已停止（OCR 错误）" : "已停止"
}

async function reprocessCurrentScreenshot(): Promise<void> {
  visibleLogDeduper.reset()
  const lines = ocr.mergedLines.value.length > 0 ? ocr.mergedLines.value : ocr.lines.value
  const linesForParse = visibleLogDeduper.getNewLines(lines)
  const events = parseLogInput(linesForParse, "ocr", session.deckProfile.value)
  await session.ingestParsedEvents(events)
  autoStatus.value = "已重新处理当前截图"
}

function clearDedupeCache(): void {
  visibleLogDeduper.clear()
  autoStatus.value = "已清空去重缓存"
}

onMounted(() => {
  void session.init()
})

onBeforeUnmount(() => {
  stopAutoListening()
})
</script>

<template>
  <div class="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-[1680px]">
      <header class="glass-panel rounded-[2rem] px-6 py-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-amber-300/80">sanguosha-log-tracker</p>
            <h1 class="mt-2 text-2xl font-black text-white sm:text-3xl">三国杀日志 OCR 记牌器 MVP</h1>
            <p class="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              本工具仅基于公开日志区域进行 OCR 统计，不读取隐藏信息，不抓包，不改包。
            </p>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.16em] text-slate-500">API 状态</p>
              <p class="mt-2 text-sm font-semibold text-slate-100">{{ apiStatusLabel }}</p>
              <p class="mt-1 text-xs text-slate-400">{{ session.statusMessage }}</p>
            </div>
            <div class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.16em] text-slate-500">OCR 状态</p>
              <p class="mt-2 text-sm font-semibold text-slate-100">{{ ocr.engineStatus.value }}</p>
              <p class="mt-1 text-xs text-slate-400">
                {{ ocr.engineStatus.value === "ready" ? "真实 OCR 已就绪，可继续识别截图。" : "未就绪时也可以使用 Mock OCR 或手动文本体验完整流程。" }}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main class="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1.2fr_0.9fr]">
        <div class="space-y-6">
          <CapturePanel
            ref="capturePanelRef"
            :stream="screen.stream.value"
            :crop-rect="screen.cropRect.value"
            :preprocess-enabled="screen.preprocessEnabled.value"
            :capture-error="screen.captureError.value"
            :source-label="screen.sourceLabel.value"
            :has-source="screen.hasSource.value"
            @start-capture="screen.startDisplayCapture"
            @stop-capture="screen.stopDisplayCapture"
            @capture-frame="screen.captureCurrentFrame($event)"
            @upload-file="screen.loadImageFile"
            @generate-sample="screen.generateSampleImage"
            @update-crop="screen.updateCropRect"
            @apply-crop="screen.refreshDerivedCanvases"
            @update:preprocess-enabled="screen.preprocessEnabled.value = $event"
          />

          <CropPreview
            :original-src="screen.originalPreviewUrl.value"
            :cropped-src="screen.croppedPreviewUrl.value"
            :processed-src="screen.processedPreviewUrl.value"
          />
        </div>

        <div class="space-y-6">
          <OcrPanel
            :engine-status="ocr.engineStatus.value"
            :engine-error="ocr.errorMessage.value"
            :manual-text="ocr.text.value"
            :recognized-preview="ocr.recognizedPreview.value"
            :raw-preview="ocr.rawPreview.value"
            :merged-preview="ocr.mergedPreview.value"
            :has-canvas="Boolean(screen.activeCanvas.value)"
            :has-auto-source="Boolean(screen.stream.value)"
            :auto-listening="autoListening"
            :auto-status="autoStatus"
            :is-ocr-running="ocr.isRecognizing.value"
            :last-ocr-at="lastOcrAt"
            :auto-error="autoError"
            @run-real="runRealOcr"
            @run-mock="runMockOcr"
            @parse-text="parseCurrentText('manual')"
            @start-auto="startAutoListening"
            @stop-auto="stopAutoListening"
            @reprocess-current="reprocessCurrentScreenshot"
            @clear-dedupe="clearDedupeCache"
            @update:manual-text="ocr.setText"
          />

          <ParsedEventsPanel
            :events="session.parsedEvents.value"
            @accept="session.updateEventStatus($event, 'accepted')"
            @reject="session.updateEventStatus($event, 'rejected')"
            @accept-high-confidence="session.acceptAllHighConfidence()"
          />
        </div>

        <div class="space-y-6">
          <DeckPanel
            :deck-profile="session.deckProfile.value"
            :deck-profiles="session.deckProfiles"
            :seen-counts="session.trackerState.value.seenCounts"
            :remaining-counts="session.trackerState.value.remainingCounts"
            :over-seen-warnings="session.trackerState.value.overSeenWarnings"
            @change-deck="session.switchDeckProfile"
          />

          <RecentEvents
            :recent-events="session.trackerState.value.recentEvents"
            @undo="session.undo"
            @reset="session.reset"
          />
        </div>
      </main>
    </div>
  </div>
</template>
