<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import {
  applySemanticEventDedupe,
  CYCLE_TOTAL_EXCEED_NOTE,
  createAutoGameSessionState,
  createDeckRemainingSamplerState,
  createSemanticEventDeduper,
  createVisibleLogDeduper,
  defaultAutoListenConfig,
  enterErrorMode,
  enterGuardMode,
  enterIdleMode,
  enterMidGameMode,
  enterPausedMode,
  getDeckTotalCount,
  mergeBrokenOcrLines,
  parseDeckRemainingFromText,
  parseLogInput,
  processAutoListenBatch,
  updateDeckRemainingSample,
  type AutoGameSessionState,
  type AutoListenConfig,
  type AutoListenEventOrder,
  type OcrLine,
  type ParsedLogEvent
} from "@slt/shared"

import CapturePanel from "./components/CapturePanel.vue"
import AliasLearningCenter from "./components/AliasLearningCenter.vue"
import CropPreview from "./components/CropPreview.vue"
import DeckPanel from "./components/DeckPanel.vue"
import OcrPanel from "./components/OcrPanel.vue"
import ParsedEventsPanel from "./components/ParsedEventsPanel.vue"
import RecentEvents from "./components/RecentEvents.vue"
import { useOcr } from "./composables/useOcr"
import { cropDeckCountCanvas, prepareDeckCountOcrCanvas, useScreenCapture } from "./composables/useScreenCapture"
import { useTrackerSession } from "./composables/useTrackerSession"

const screen = useScreenCapture()
const ocr = useOcr()
const session = useTrackerSession()
const capturePanelRef = ref<{ getVideoElement: () => HTMLVideoElement | null } | null>(null)

const diffThreshold = 6
const visibleLogDeduper = createVisibleLogDeduper()
const semanticEventDeduper = createSemanticEventDeduper()
const deckRemainingSampler = createDeckRemainingSamplerState()
const autoListenConfig = ref<AutoListenConfig>({ ...defaultAutoListenConfig })
const autoSessionState = ref<AutoGameSessionState>(createAutoGameSessionState())
const autoListening = ref(false)
const autoStatus = ref("未启动")
const autoError = ref("")
const showAliasLearningCenter = ref(false)
const lastOcrAt = ref("")
const onlyNewVisibleLines = ref(true)
const logProcessingOrder = ref<AutoListenEventOrder>("oldest-first")
const deckRemainingRawText = ref("")
const ocrMetrics = ref({
  rawLineCount: 0,
  mergedLineCount: 0,
  newLineCount: 0,
  ignoredLineCount: 0,
  strictEventCount: 0,
  ambiguousEventCount: 0,
  unsupportedEventCount: 0,
  duplicateSkippedCount: 0,
  lastOcrDurationMs: 0
})
let autoTimer: number | undefined
let lastOcrAtMs = 0
let dirtyAtMs = 0
let previousFingerprint: Uint8ClampedArray | undefined

const GAME_END_KEYWORDS = ["游戏结束", "本局结束", "胜利", "失败", "获得胜利", "对局结束", "返回房间", "进入结算"]

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

const autoModeLabel = computed(() => {
  switch (autoSessionState.value.mode) {
    case "armed":
      return "守护中，等待开局"
    case "gameStarting":
      return "检测到开局"
    case "inGame":
      return "正式监听中"
    case "paused":
      return "已暂停"
    case "error":
      return "错误"
    default:
      return "未启动"
  }
})

const autoModeNote = computed(() => {
  if (autoSessionState.value.mode === "inGame" && autoSessionState.value.startMode === "midGame") {
    return "中途接入：仅统计开启后的公开日志。"
  }

  return ""
})

const latestStartSignal = computed(() => autoSessionState.value.lastStartSignal?.chooseLines.join(" | ") ?? "")
const currentGameStartSignature = computed(() => autoSessionState.value.currentGameStartSignature ?? "")
const logProcessingOrderLabel = computed(() =>
  logProcessingOrder.value === "oldest-first" ? "oldest -> newest" : "newest -> oldest"
)

function orderLinesForProcessing<T>(lines: T[]): T[] {
  return logProcessingOrder.value === "newest-first" ? [...lines].reverse() : lines
}

function hasGameEndSignal(lines: OcrLine[]): boolean {
  const text = lines.map((line) => line.text).join("")
  return GAME_END_KEYWORDS.some((keyword) => text.includes(keyword))
}

function primeSemanticWindow(lines: OcrLine[], source: "ocr" | "mock" = "ocr"): void {
  const visibleEvents = parseLogInput(orderLinesForProcessing(lines), source, session.deckProfile.value)
  semanticEventDeduper.prime(visibleEvents)
}

async function acceptEventWithGuard(eventId: string): Promise<void> {
  const event = session.trackerState.value.events.find((item) => item.id === eventId)
  if (!event) {
    return
  }

  if (event.note?.includes(CYCLE_TOTAL_EXCEED_NOTE)) {
    const confirmed = window.confirm("该事件会导致本轮已见超过牌库总数。仍然要强制接受吗？")
    if (!confirmed) {
      return
    }
  }

  await session.updateEventStatus(eventId, "accepted")
}

async function markEventMisrecognized(eventId: string): Promise<void> {
  const event = session.trackerState.value.events.find((item) => item.id === eventId)
  if (!event) {
    return
  }

  const reasonInput = window.prompt("误识别原因：牌名识别错 / 动作识别错 / 重复事件 / 玩家识别错 / 其他", "重复事件")
  const reasonMap: Record<string, "misrecognized" | "wrongCard" | "wrongAction" | "duplicate" | "unsupported"> = {
    牌名识别错: "wrongCard",
    动作识别错: "wrongAction",
    重复事件: "duplicate",
    玩家识别错: "misrecognized",
    其他: "misrecognized"
  }
  const reason = reasonMap[reasonInput ?? ""] ?? "misrecognized"
  const correctedCardName = reason === "wrongCard" ? window.prompt("请输入正确牌名，用于对局结束后的别名挖掘", event.cardName ?? "") ?? undefined : undefined
  await session.recordCorrection({
    eventId,
    reason,
    ...(correctedCardName?.trim() ? { correctedCardName: correctedCardName.trim() } : {})
  })
}

async function parseCurrentText(source: "ocr" | "manual" | "mock"): Promise<void> {
  if (!ocr.text.value.trim()) {
    ocr.setError("当前没有可解析文本。请先运行 OCR 或粘贴日志文本。")
    return
  }

  ocr.setError("")
  const events = applySemanticEventDedupe(
    parseLogInput(ocr.text.value, source, session.deckProfile.value),
    semanticEventDeduper
  )
  await session.recordOcrBatch({
    rawLines: ocr.text.value.split(/\r?\n/).filter(Boolean),
    mergedLines: ocr.text.value.split(/\r?\n/).filter(Boolean),
    source,
    ocrEngine: source === "manual" ? "manual" : source
  })
  await session.ingestParsedEvents(events)
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

function updateOcrMetrics(
  rawLines: OcrLine[],
  mergedLines: OcrLine[],
  parsedLineCount: number,
  events: ParsedLogEvent[],
  duplicateSkippedCount: number,
  durationMs: number
): void {
  ocrMetrics.value = {
    ...ocrMetrics.value,
    rawLineCount: rawLines.length,
    mergedLineCount: mergedLines.length,
    newLineCount: parsedLineCount,
    ignoredLineCount: events.filter((event) => event.quality === "ignored").length,
    strictEventCount: events.filter((event) => event.quality === "strict").length,
    ambiguousEventCount: events.filter((event) => event.quality === "ambiguous").length,
    unsupportedEventCount: events.filter((event) => event.quality === "unsupported").length,
    duplicateSkippedCount,
    lastOcrDurationMs: durationMs
  }
}

function primeVisibleLogBaseline(lines: OcrLine[]): void {
  visibleLogDeduper.reset()
  visibleLogDeduper.getNewLines(lines)
  primeSemanticWindow(lines, "ocr")
}

function stopAutoTimerOnly(): void {
  if (autoTimer) {
    window.clearInterval(autoTimer)
    autoTimer = undefined
  }

  autoListening.value = false
}

function startAutoTimerIfNeeded(): void {
  if (autoListening.value) {
    return
  }

  autoError.value = ""
  previousFingerprint = undefined
  dirtyAtMs = 0
  autoListening.value = true
  autoTimer = window.setInterval(tickAutoListening, autoListenConfig.value.captureIntervalMs)
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
  await session.recordOcrBatch({
    rawLines,
    mergedLines,
    source,
    ocrEngine: source
  })
  ocr.setRecognitionResult(rawLines, mergedLines)
  const linesForParse = onlyNewVisibleLines ? visibleLogDeduper.getNewLines(mergedLines) : mergedLines
  const dedupeStats = visibleLogDeduper.getLastStats()
  const events = applySemanticEventDedupe(
    parseLogInput(orderLinesForProcessing(linesForParse), source, session.deckProfile.value),
    semanticEventDeduper
  )
  ocrMetrics.value = {
    ...ocrMetrics.value,
    rawLineCount: rawLines.length,
    mergedLineCount: mergedLines.length,
    newLineCount: linesForParse.length,
    ignoredLineCount: events.filter((event) => event.quality === "ignored").length,
    strictEventCount: events.filter((event) => event.quality === "strict").length,
    ambiguousEventCount: events.filter((event) => event.quality === "ambiguous").length,
    unsupportedEventCount: events.filter((event) => event.quality === "unsupported").length,
    duplicateSkippedCount: onlyNewVisibleLines ? dedupeStats.duplicateSkippedCount : 0
  }
  await session.ingestParsedEvents(events)
  primeSemanticWindow(mergedLines, source)
}

async function runDeckRemainingOcr(sourceCanvas: HTMLCanvasElement | null, allowAutoConfirm = false): Promise<void> {
  if (!sourceCanvas) {
    return
  }

  const deckTotal = getDeckTotalCount(session.deckProfile.value)
  const cropped = cropDeckCountCanvas(sourceCanvas, screen.deckCountCropRect.value)
  const prepared = prepareDeckCountOcrCanvas(cropped)
  screen.refreshDeckCountPreview(sourceCanvas)
  const lines = await ocr.recognizeOnly(prepared)
  const rawText = lines.map((line) => line.text).join("")
  deckRemainingRawText.value = rawText
  const rawRemaining = parseDeckRemainingFromText(rawText, deckTotal)
  const sample = updateDeckRemainingSample(deckRemainingSampler, rawRemaining, deckTotal)
  session.updateDeckRemaining(sample.stableRemaining, rawText)

  if (allowAutoConfirm && !autoListenConfig.value.requireConfirmReshuffle && session.trackerState.value.pendingReshuffleAlert?.status === "pending") {
    session.confirmPendingReshuffle()
  }
}

async function runRealOcr(): Promise<void> {
  const canvas = screen.activeCanvas.value
  if (!canvas) {
    ocr.setError("请先生成示例日志截图、上传图片，或截取当前屏幕画面。")
    return
  }

  try {
    const startedAt = performance.now()
    const lines = await ocr.runRealOcr(canvas)
    await ingestOcrLines(lines, "ocr", onlyNewVisibleLines.value)
    await runDeckRemainingOcr(screen.activeSourceCanvas.value)
    lastOcrAtMs = Date.now()
    lastOcrAt.value = formatTime(lastOcrAtMs)
    ocrMetrics.value = {
      ...ocrMetrics.value,
      lastOcrDurationMs: Math.round(performance.now() - startedAt)
    }
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
    const startedAt = performance.now()
    autoStatus.value = "OCR 中"
    autoError.value = ""
    const rawLines = await ocr.runRealOcr(canvas)
    const mergedLines = mergeBrokenOcrLines(rawLines, session.deckProfile.value)
    await session.recordOcrBatch({
      rawLines,
      mergedLines,
      source: "ocr",
      ocrEngine: "paddleocr"
    })
    ocr.setRecognitionResult(rawLines, mergedLines)

    let linesForBatch = mergedLines
    let duplicateSkippedCount = 0
    const stateBeforeBatch = autoSessionState.value
    const shouldPrimeMidGame =
      stateBeforeBatch.mode === "inGame" && stateBeforeBatch.startMode === "midGame" && stateBeforeBatch.baselineStatus !== "complete"

    if (stateBeforeBatch.mode === "inGame" && !shouldPrimeMidGame) {
      linesForBatch = visibleLogDeduper.getNewLines(mergedLines)
      duplicateSkippedCount = visibleLogDeduper.getLastStats().duplicateSkippedCount
    }

    const result = processAutoListenBatch({
      state: stateBeforeBatch,
      lines: linesForBatch,
      deckProfile: session.deckProfile.value,
      trackerState: session.trackerState.value,
      semanticDeduper: semanticEventDeduper,
      config: autoListenConfig.value,
      eventOrder: logProcessingOrder.value,
      now: Date.now()
    })

    if (stateBeforeBatch.mode === "armed" && result.resetTracker) {
      autoSessionState.value = {
        ...result.nextState,
        mode: "gameStarting"
      }
      autoStatus.value = "检测到开局，正在重置本局"
      await session.endAndCreateSession()
      primeVisibleLogBaseline(mergedLines)
      await session.ingestParsedEvents(result.events)
      primeSemanticWindow(mergedLines, "ocr")
      autoSessionState.value = result.nextState
      updateOcrMetrics(
        rawLines,
        mergedLines,
        Math.max(0, mergedLines.length - (Math.max(...(result.signal?.chooseLineIndexes ?? [-1])) + 1)),
        result.events,
        0,
        Math.round(performance.now() - startedAt)
      )
      const videoElement = capturePanelRef.value?.getVideoElement() ?? null
      await runDeckRemainingOcr(screen.captureCurrentSourceFrame(videoElement), true)
      autoStatus.value = result.autoAcceptedEventIds.length > 0 ? `正式监听中，已自动接受 ${result.autoAcceptedEventIds.length} 条 strict 事件` : "正式监听中"
    } else if (result.primedLineCount > 0) {
      primeVisibleLogBaseline(mergedLines)
      autoSessionState.value = result.nextState
      updateOcrMetrics(rawLines, mergedLines, 0, [], 0, Math.round(performance.now() - startedAt))
      autoStatus.value = "中途接入基线已建立，后续只统计新增公开日志"
    } else {
      autoSessionState.value = result.nextState
      if (result.events.length > 0) {
        await session.ingestParsedEvents(result.events)
      }
      primeSemanticWindow(mergedLines, "ocr")
      if (result.nextState.mode === "inGame") {
        const videoElement = capturePanelRef.value?.getVideoElement() ?? null
        await runDeckRemainingOcr(screen.captureCurrentSourceFrame(videoElement), true)
      }
      if (hasGameEndSignal(mergedLines)) {
        await session.endCurrentSession()
        autoStatus.value = "检测到对局结束，已生成报告并触发别名分析"
        stopAutoListening("idle")
      }
      updateOcrMetrics(
        rawLines,
        mergedLines,
        linesForBatch.length,
        result.events,
        duplicateSkippedCount,
        Math.round(performance.now() - startedAt)
      )
      if (result.nextState.mode === "armed") {
        autoStatus.value = result.signal ? "已检测到开局候选，请手动开始新局或开启自动开局" : "守护中，等待开局"
      } else {
        autoStatus.value = result.autoAcceptedEventIds.length > 0 ? `正式监听中，已自动接受 ${result.autoAcceptedEventIds.length} 条 strict 事件` : "正式监听中"
      }
    }

    const videoElement = capturePanelRef.value?.getVideoElement() ?? null
    lastOcrAtMs = Date.now()
    lastOcrAt.value = formatTime(lastOcrAtMs)
    dirtyAtMs = 0
  } catch (error) {
    autoError.value = error instanceof Error ? error.message : "自动 OCR 失败。"
    autoSessionState.value = enterErrorMode(autoSessionState.value)
    autoStatus.value = "自动 OCR 失败"
    stopAutoTimerOnly()
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

  const isStable = dirtyAtMs > 0 && now - dirtyAtMs >= autoListenConfig.value.stableDelayMs
  const isOcrIntervalReady = now - lastOcrAtMs >= autoListenConfig.value.minOcrIntervalMs
  if (isStable && isOcrIntervalReady && !ocr.isRecognizing.value) {
    void runAutoOcr(canvas)
  }
}

function startAutoListening(): void {
  if (autoListening.value && autoSessionState.value.mode === "armed") {
    return
  }

  autoSessionState.value = enterGuardMode(autoSessionState.value)
  autoStatus.value = "守护中，等待开局"
  startAutoTimerIfNeeded()
  tickAutoListening()
}

function stopAutoListening(mode: "paused" | "idle" = "paused"): void {
  stopAutoTimerOnly()
  autoSessionState.value = mode === "idle" ? enterIdleMode(autoSessionState.value) : enterPausedMode(autoSessionState.value)
  autoStatus.value = mode === "idle" ? "未启动" : autoError.value ? "错误" : "已暂停"
}

async function startManualNewGame(): Promise<void> {
  autoError.value = ""
  startAutoTimerIfNeeded()
  autoSessionState.value = {
    ...autoSessionState.value,
    mode: "gameStarting",
    hasEnteredInGame: true,
    startMode: "newGame",
    baselineStatus: "complete",
    currentGameStartSignature: undefined,
    lastGameStartDetectedAt: Date.now()
  }
  autoStatus.value = "手动开始新局，正在重置本局"
  await session.endAndCreateSession()
  const currentLines = ocr.mergedLines.value.length > 0 ? ocr.mergedLines.value : ocr.lines.value
  primeVisibleLogBaseline(currentLines)
  autoSessionState.value = {
    ...autoSessionState.value,
    mode: "inGame"
  }
  autoStatus.value = "正式监听中"
  tickAutoListening()
}

function startMidGameListening(): void {
  autoError.value = ""
  visibleLogDeduper.reset()
  autoSessionState.value = enterMidGameMode(autoSessionState.value)
  autoStatus.value = "中途接入：等待下一次稳定 OCR 建立基线"
  startAutoTimerIfNeeded()
  tickAutoListening()
}

function stopCaptureSource(): void {
  screen.stopDisplayCapture()
  stopAutoListening("idle")
}

async function reprocessCurrentScreenshot(): Promise<void> {
  visibleLogDeduper.reset()
  const lines = ocr.mergedLines.value.length > 0 ? ocr.mergedLines.value : ocr.lines.value
  const linesForParse = visibleLogDeduper.getNewLines(lines)
  const events = applySemanticEventDedupe(
    parseLogInput(orderLinesForProcessing(linesForParse), "ocr", session.deckProfile.value),
    semanticEventDeduper
  )
  const dedupeStats = visibleLogDeduper.getLastStats()
  ocrMetrics.value = {
    ...ocrMetrics.value,
    newLineCount: linesForParse.length,
    duplicateSkippedCount: dedupeStats.duplicateSkippedCount,
    ignoredLineCount: events.filter((event) => event.quality === "ignored").length,
    strictEventCount: events.filter((event) => event.quality === "strict").length,
    ambiguousEventCount: events.filter((event) => event.quality === "ambiguous").length,
    unsupportedEventCount: events.filter((event) => event.quality === "unsupported").length
  }
  await session.ingestParsedEvents(events)
  primeSemanticWindow(lines, "ocr")
  autoStatus.value = "已重新处理当前截图"
}

function clearDedupeCache(): void {
  visibleLogDeduper.clear()
  semanticEventDeduper.clear()
  autoStatus.value = "已清空去重缓存"
}

onMounted(() => {
  void session.init()
})

onBeforeUnmount(() => {
  stopAutoListening("idle")
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
        <div class="mt-4 flex flex-wrap gap-2">
          <button class="action-button secondary-button" type="button" @click="session.endCurrentSession()">
            结束本局并生成报告
          </button>
          <button class="action-button secondary-button" type="button" @click="showAliasLearningCenter = !showAliasLearningCenter">
            {{ showAliasLearningCenter ? "收起别名学习中心" : "别名学习中心" }}
          </button>
        </div>
      </header>

      <div v-if="showAliasLearningCenter" class="mt-6">
        <AliasLearningCenter />
      </div>

      <main class="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1.2fr_0.9fr]">
        <div class="space-y-6">
          <CapturePanel
            ref="capturePanelRef"
            :stream="screen.stream.value"
            :crop-rect="screen.cropRect.value"
            :deck-count-crop-rect="screen.deckCountCropRect.value"
            :preprocess-enabled="screen.preprocessEnabled.value"
            :capture-error="screen.captureError.value"
            :source-label="screen.sourceLabel.value"
            :has-source="screen.hasSource.value"
            @start-capture="screen.startDisplayCapture"
            @stop-capture="stopCaptureSource"
            @capture-frame="screen.captureCurrentFrame($event)"
            @upload-file="screen.loadImageFile"
            @generate-sample="screen.generateSampleImage"
            @update-crop="screen.updateCropRect"
            @update-deck-count-crop="screen.updateDeckCountCropRect"
            @reset-deck-count-crop="screen.resetDeckCountCropRect"
            @apply-crop="screen.refreshDerivedCanvases"
            @update:preprocess-enabled="screen.preprocessEnabled.value = $event"
          />

          <CropPreview
            :original-src="screen.originalPreviewUrl.value"
            :cropped-src="screen.croppedPreviewUrl.value"
            :processed-src="screen.processedPreviewUrl.value"
            :deck-count-cropped-src="screen.deckCountCroppedPreviewUrl.value"
            :deck-count-processed-src="screen.deckCountProcessedPreviewUrl.value"
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
            :auto-mode-label="autoModeLabel"
            :auto-status="autoStatus"
            :auto-mode-note="autoModeNote"
            :is-ocr-running="ocr.isRecognizing.value"
            :last-ocr-at="lastOcrAt"
            :auto-error="autoError"
            :only-new-visible-lines="onlyNewVisibleLines"
            :log-processing-order="logProcessingOrderLabel"
            :deck-remaining-raw-text="deckRemainingRawText"
            :stable-deck-remaining="session.trackerState.value.lastStableDeckRemaining"
            :auto-start-on-choose-general="autoListenConfig.autoStartOnChooseGeneral"
            :auto-reset-on-new-game="autoListenConfig.autoResetOnNewGame"
            :auto-accept-strict-events="autoListenConfig.autoAcceptStrictEvents"
            :require-confirm-reshuffle="autoListenConfig.requireConfirmReshuffle"
            :choose-line-count="autoSessionState.lastChooseLineCount"
            :last-start-signal="latestStartSignal"
            :current-game-start-signature="currentGameStartSignature"
            :has-entered-in-game="autoSessionState.hasEnteredInGame"
            :metrics="ocrMetrics"
            @run-real="runRealOcr"
            @run-mock="runMockOcr"
            @parse-text="parseCurrentText('manual')"
            @start-auto="startAutoListening"
            @stop-auto="stopAutoListening"
            @force-new-game="startManualNewGame"
            @enter-mid-game="startMidGameListening"
            @reprocess-current="reprocessCurrentScreenshot"
            @clear-dedupe="clearDedupeCache"
            @update:manual-text="ocr.setText"
            @update:only-new-visible-lines="onlyNewVisibleLines = $event"
            @update:log-processing-order="logProcessingOrder = $event"
            @update:auto-start-on-choose-general="autoListenConfig.autoStartOnChooseGeneral = $event"
            @update:auto-reset-on-new-game="autoListenConfig.autoResetOnNewGame = $event"
            @update:auto-accept-strict-events="autoListenConfig.autoAcceptStrictEvents = $event"
            @update:require-confirm-reshuffle="autoListenConfig.requireConfirmReshuffle = $event"
          />

          <ParsedEventsPanel
            :events="session.parsedEvents.value"
            @accept="acceptEventWithGuard"
            @reject="session.updateEventStatus($event, 'rejected')"
            @accept-high-confidence="session.acceptAllHighConfidence()"
          />
        </div>

        <div class="space-y-6">
          <DeckPanel
            :deck-profile="session.deckProfile.value"
            :deck-profiles="session.deckProfiles"
            :tracker-state="session.trackerState.value"
            @change-deck="session.switchDeckProfile"
            @confirm-reshuffle="session.confirmPendingReshuffle"
            @dismiss-reshuffle="session.dismissPendingReshuffle"
            @manual-reshuffle="session.markManualReshuffle"
            @correct-deck-remaining="session.correctDeckRemaining"
          />

          <RecentEvents
            :recent-events="session.trackerState.value.recentEvents"
            @undo="session.undo"
            @undo-event="session.undoOne"
            @mark-misrecognized="markEventMisrecognized"
            @reset="session.reset"
          />
        </div>
      </main>
    </div>
  </div>
</template>
