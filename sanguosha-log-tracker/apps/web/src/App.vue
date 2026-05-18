<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { BookMarked, ClipboardCheck, Library, ScanLine, Server, Swords } from "lucide-vue-next"
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
  type OcrEvidenceImage,
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
import UiGlobalMessageHost from "./components/ui/UiGlobalMessageHost.vue"
import UiTabs from "./components/ui/UiTabs.vue"
import { useOcr } from "./composables/useOcr"
import { cropDeckCountCanvas, prepareDeckCountOcrCanvas, useScreenCapture } from "./composables/useScreenCapture"
import { useTrackerSession } from "./composables/useTrackerSession"

const screen = useScreenCapture()
const ocr = useOcr()
const session = useTrackerSession()
const capturePanelRef = ref<{ getVideoElement: () => HTMLVideoElement | null } | null>(null)
const pendingEventsDetailsRef = ref<HTMLDetailsElement | null>(null)

const diffThreshold = 6
const visibleLogDeduper = createVisibleLogDeduper()
const semanticEventDeduper = createSemanticEventDeduper()
const deckRemainingSampler = createDeckRemainingSamplerState()
const autoListenConfig = ref<AutoListenConfig>({ ...defaultAutoListenConfig })
const autoSessionState = ref<AutoGameSessionState>(createAutoGameSessionState())
const autoListening = ref(false)
const autoStatus = ref("未启动")
const autoError = ref("")
const activeModule = ref<"live" | "alias">("live")
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
const moduleTabs = [
  { value: "live", label: "实时对局", icon: Swords },
  { value: "alias", label: "别名学习", icon: BookMarked }
]
const autoDeckRemainingOcrIntervalMs = 5_000
const gameEndInactivityTimeoutMs = 4_000
let autoTimer: number | undefined
let lastOcrAtMs = 0
let lastDeckRemainingOcrAtMs = 0
let lastAutoLogActivityAtMs = 0
let dirtyAtMs = 0
let previousFingerprint: Uint8ClampedArray | undefined
let isEndingAutoGame = false

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

const apiOnline = computed(() => session.apiStatus.value === "online")
const ocrReady = computed(() => ocr.engineStatus.value === "ready")

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

function isTrackedAutoGameActive(): boolean {
  return autoSessionState.value.mode === "inGame" && autoSessionState.value.baselineStatus === "complete"
}

function markAutoLogActivity(timestamp = Date.now()): void {
  if (isTrackedAutoGameActive()) {
    lastAutoLogActivityAtMs = timestamp
  }
}

async function endAutoGameFromAutoListener(reason: string, errorMessage = ""): Promise<void> {
  if (!isTrackedAutoGameActive() || isEndingAutoGame) {
    return
  }

  isEndingAutoGame = true
  stopAutoTimerOnly()
  try {
    await session.endCurrentSession()
    autoError.value = errorMessage
    autoSessionState.value = enterIdleMode(autoSessionState.value)
    autoStatus.value = reason
    lastAutoLogActivityAtMs = 0
  } catch (error) {
    autoError.value = error instanceof Error ? error.message : "结束当前对局失败。"
    autoSessionState.value = enterErrorMode(autoSessionState.value)
    autoStatus.value = "结束当前对局失败"
  } finally {
    isEndingAutoGame = false
  }
}

function handleAutoLogReadFailure(errorMessage: string): void {
  if (isTrackedAutoGameActive()) {
    void endAutoGameFromAutoListener("读取日志区域失败，已判定对局结束并生成报告", errorMessage)
    return
  }

  autoError.value = errorMessage
  autoStatus.value = "读取日志区域失败"
}

function startAutoTimerIfNeeded(): void {
  if (autoListening.value) {
    return
  }

  autoError.value = ""
  previousFingerprint = undefined
  dirtyAtMs = 0
  lastAutoLogActivityAtMs = 0
  lastDeckRemainingOcrAtMs = 0
  isEndingAutoGame = false
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

function isAliasEvidenceEvent(event: ParsedLogEvent): boolean {
  return (
    event.action === "unknown" ||
    event.quality === "ambiguous" ||
    event.quality === "unsupported" ||
    event.supportStatus === "unsupported" ||
    Boolean(event.note?.includes(CYCLE_TOTAL_EXCEED_NOTE))
  )
}

function canvasToEvidenceImage(canvas: HTMLCanvasElement): OcrEvidenceImage {
  const maxWidth = 520
  const scale = canvas.width > maxWidth ? maxWidth / canvas.width : 1
  const output = document.createElement("canvas")
  output.width = Math.max(1, Math.round(canvas.width * scale))
  output.height = Math.max(1, Math.round(canvas.height * scale))

  const context = output.getContext("2d")
  if (context) {
    context.imageSmoothingEnabled = true
    context.drawImage(canvas, 0, 0, output.width, output.height)
  }

  const dataUrl = output.toDataURL("image/webp", 0.64)
  return {
    dataUrl,
    width: output.width,
    height: output.height,
    sourceWidth: canvas.width,
    sourceHeight: canvas.height,
    capturedAt: Date.now(),
    kind: "logRoi",
    mimeType: dataUrl.slice(5, dataUrl.indexOf(";"))
  }
}

function extractBoxRect(box: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!box) {
    return undefined
  }

  if (Array.isArray(box)) {
    const points = box.filter(
      (point): point is [number, number] => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
    )
    if (points.length === 0) {
      return undefined
    }
    const xs = points.map((point) => Number(point[0]))
    const ys = points.map((point) => Number(point[1]))
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const right = Math.max(...xs)
    const bottom = Math.max(...ys)
    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    }
  }

  if (typeof box === "object") {
    const record = box as Record<string, unknown>
    const left = Number(record.x ?? record.left)
    const top = Number(record.y ?? record.top)
    const width = Number(record.width)
    const height = Number(record.height)
    if ([left, top, width, height].every(Number.isFinite)) {
      return {
        x: left,
        y: top,
        width: Math.max(1, width),
        height: Math.max(1, height)
      }
    }
  }

  return undefined
}

function cropCanvasToLineEvidence(canvas: HTMLCanvasElement, box: unknown): HTMLCanvasElement | undefined {
  const rect = extractBoxRect(box)
  if (!rect) {
    return undefined
  }

  const safeX = Math.max(0, Math.floor(rect.x - 12))
  const safeY = Math.max(0, Math.floor(rect.y - 4))
  const maxWidth = Math.max(1, canvas.width - safeX)
  const maxHeight = Math.max(1, canvas.height - safeY)
  const safeWidth = Math.min(maxWidth, Math.ceil(rect.width + 24))
  const safeHeight = Math.min(maxHeight, Math.ceil(rect.height + 8))
  const output = document.createElement("canvas")
  output.width = Math.max(1, safeWidth)
  output.height = Math.max(1, safeHeight)

  const context = output.getContext("2d")
  if (!context) {
    return undefined
  }

  context.drawImage(canvas, safeX, safeY, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight)
  return output
}

function attachEvidenceImage(
  events: ParsedLogEvent[],
  canvas: HTMLCanvasElement | null,
  sourceLines: OcrLine[] = []
): ParsedLogEvent[] {
  if (!canvas || !events.some(isAliasEvidenceEvent)) {
    return events
  }

  const evidenceByText = new Map<string, OcrEvidenceImage>()
  const fullEvidenceImage = canvasToEvidenceImage(canvas)

  return events.map((event) => {
    if (!isAliasEvidenceEvent(event)) {
      return event
    }

    const cached = evidenceByText.get(event.rawText)
    if (cached) {
      return { ...event, evidenceImage: cached }
    }

    const line = sourceLines.find((item) => item.text === event.rawText && item.box)
    const croppedCanvas = line ? cropCanvasToLineEvidence(canvas, line.box) : undefined
    const evidenceImage = croppedCanvas ? canvasToEvidenceImage(croppedCanvas) : fullEvidenceImage
    evidenceByText.set(event.rawText, evidenceImage)
    return { ...event, evidenceImage }
  })
}

async function ingestOcrLines(
  rawLines: OcrLine[],
  source: "ocr" | "mock",
  onlyNewVisibleLines: boolean,
  evidenceCanvas: HTMLCanvasElement | null = null
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
  const events = attachEvidenceImage(
    applySemanticEventDedupe(
      parseLogInput(orderLinesForProcessing(linesForParse), source, session.deckProfile.value),
      semanticEventDeduper
    ),
    evidenceCanvas,
    linesForParse
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

async function runDeckRemainingCropOcr(
  croppedCanvas: HTMLCanvasElement | null,
  options: { allowAutoConfirm?: boolean } = {}
): Promise<void> {
  if (!croppedCanvas) {
    return
  }

  const deckTotal = getDeckTotalCount(session.deckProfile.value)
  const prepared = prepareDeckCountOcrCanvas(croppedCanvas)
  const lines = await ocr.recognizeOnly(prepared)
  const rawText = lines.map((line) => line.text).join("")
  deckRemainingRawText.value = rawText
  const rawRemaining = parseDeckRemainingFromText(rawText, deckTotal)
  const sample = updateDeckRemainingSample(deckRemainingSampler, rawRemaining, deckTotal)
  session.updateDeckRemaining(sample.stableRemaining, rawText)

  if (options.allowAutoConfirm && !autoListenConfig.value.requireConfirmReshuffle && session.trackerState.value.pendingReshuffleAlert?.status === "pending") {
    session.confirmPendingReshuffle()
  }
}

async function runDeckRemainingOcr(
  sourceCanvas: HTMLCanvasElement | null,
  options: { allowAutoConfirm?: boolean; updatePreview?: boolean } = {}
): Promise<void> {
  if (!sourceCanvas) {
    return
  }

  const cropped = cropDeckCountCanvas(sourceCanvas, screen.deckCountCropRect.value)
  if (options.updatePreview !== false) {
    screen.refreshDeckCountPreview(sourceCanvas)
  }
  await runDeckRemainingCropOcr(cropped, options)
}

async function runAutoDeckRemainingOcr(videoElement: HTMLVideoElement | null): Promise<void> {
  const now = Date.now()
  const hasPendingReshuffle = session.trackerState.value.pendingReshuffleAlert?.status === "pending"
  if (!hasPendingReshuffle && now - lastDeckRemainingOcrAtMs < autoDeckRemainingOcrIntervalMs) {
    return
  }

  lastDeckRemainingOcrAtMs = now
  await runDeckRemainingCropOcr(screen.captureCurrentDeckCountFrame(videoElement), { allowAutoConfirm: true })
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
    await ingestOcrLines(lines, "ocr", onlyNewVisibleLines.value, canvas)
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
    if (!autoListening.value || autoSessionState.value.mode === "idle") {
      return
    }

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
      const eventsWithEvidence = attachEvidenceImage(result.events, canvas, linesForBatch)
      autoSessionState.value = {
        ...result.nextState,
        mode: "gameStarting"
      }
      autoStatus.value = "检测到开局，正在重置本局"
      await session.endAndCreateSession()
      primeVisibleLogBaseline(mergedLines)
      await session.ingestParsedEvents(eventsWithEvidence)
      primeSemanticWindow(mergedLines, "ocr")
      autoSessionState.value = result.nextState
      updateOcrMetrics(
        rawLines,
        mergedLines,
        Math.max(0, mergedLines.length - (Math.max(...(result.signal?.chooseLineIndexes ?? [-1])) + 1)),
        eventsWithEvidence,
        0,
        Math.round(performance.now() - startedAt)
      )
      const videoElement = capturePanelRef.value?.getVideoElement() ?? null
      await runAutoDeckRemainingOcr(videoElement)
      markAutoLogActivity()
      autoStatus.value = result.autoAcceptedEventIds.length > 0 ? `正式监听中，已自动接受 ${result.autoAcceptedEventIds.length} 条 strict 事件` : "正式监听中"
    } else if (result.primedLineCount > 0) {
      primeVisibleLogBaseline(mergedLines)
      autoSessionState.value = result.nextState
      markAutoLogActivity()
      updateOcrMetrics(rawLines, mergedLines, 0, [], 0, Math.round(performance.now() - startedAt))
      autoStatus.value = "中途接入基线已建立，后续只统计新增公开日志"
    } else {
      const eventsWithEvidence = attachEvidenceImage(result.events, canvas, linesForBatch)
      autoSessionState.value = result.nextState
      if (eventsWithEvidence.length > 0) {
        await session.ingestParsedEvents(eventsWithEvidence)
      }
      primeSemanticWindow(mergedLines, "ocr")
      if (result.nextState.mode === "inGame") {
        const videoElement = capturePanelRef.value?.getVideoElement() ?? null
        await runAutoDeckRemainingOcr(videoElement)
      }
      if (linesForBatch.length > 0) {
        markAutoLogActivity()
      }
      updateOcrMetrics(
        rawLines,
        mergedLines,
        linesForBatch.length,
        eventsWithEvidence,
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
    const errorMessage = error instanceof Error ? error.message : "自动 OCR 失败。"
    if (isTrackedAutoGameActive()) {
      await endAutoGameFromAutoListener("读取日志失败，已判定对局结束并生成报告", errorMessage)
      return
    }

    autoError.value = errorMessage
    autoSessionState.value = enterErrorMode(autoSessionState.value)
    autoStatus.value = "自动 OCR 失败"
    stopAutoTimerOnly()
  }
}

function tickAutoListening(): void {
  const videoElement = capturePanelRef.value?.getVideoElement() ?? null
  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = screen.captureCurrentRoiFrame(videoElement)
  } catch (error) {
    handleAutoLogReadFailure(error instanceof Error ? error.message : "读取日志区域失败。")
    return
  }

  if (!canvas) {
    if (isTrackedAutoGameActive()) {
      handleAutoLogReadFailure(screen.captureError.value || "读取日志区域失败。")
      return
    }

    autoStatus.value = "等待可用画面"
    return
  }

  let fingerprint: Uint8ClampedArray
  try {
    fingerprint = createImageFingerprint(canvas)
  } catch (error) {
    handleAutoLogReadFailure(error instanceof Error ? error.message : "读取日志区域失败。")
    return
  }

  const now = Date.now()
  if (isTrackedAutoGameActive() && lastAutoLogActivityAtMs === 0) {
    lastAutoLogActivityAtMs = now
  }

  if (previousFingerprint) {
    const diff = meanAbsoluteDifference(previousFingerprint, fingerprint)
    if (diff > diffThreshold) {
      dirtyAtMs = now
      markAutoLogActivity(now)
      autoStatus.value = `检测到日志区变化（diff ${diff.toFixed(1)}）`
    }
  } else {
    dirtyAtMs = now
  }

  previousFingerprint = fingerprint

  if (isTrackedAutoGameActive() && lastAutoLogActivityAtMs > 0 && now - lastAutoLogActivityAtMs >= gameEndInactivityTimeoutMs) {
    void endAutoGameFromAutoListener("长时间没有日志更替，已判定对局结束并生成报告")
    return
  }

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
  lastAutoLogActivityAtMs = 0
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
  markAutoLogActivity()
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

function showPendingEventsPanel(): void {
  const element = pendingEventsDetailsRef.value
  if (!element) {
    return
  }

  element.open = true
  window.requestAnimationFrame(() => {
    element.scrollIntoView({ behavior: "smooth", block: "start" })
  })
}

onMounted(() => {
  void session.init()
})

onBeforeUnmount(() => {
  stopAutoListening("idle")
})
</script>

<template>
  <div class="app-shell min-h-screen px-3 py-4 text-slate-100 sm:px-5">
    <div class="mx-auto max-w-[1880px]">
      <header class="app-header">
        <div class="brand-lockup">
          <div class="brand-mark">杀</div>
          <div>
            <h1>OCR</h1>
            <p>公开日志 · OCR 记牌 · 不读取隐藏信息</p>
          </div>
        </div>

        <UiTabs
          class="header-tabs"
          :items="moduleTabs"
          :model-value="activeModule"
          @update:model-value="activeModule = $event as 'live' | 'alias'"
        />

        <div class="header-actions">
          <div class="status-pill" :class="apiOnline ? 'is-good' : 'is-muted'">
            <Server class="pill-icon" />
            <span class="status-dot" />
            <span>API {{ apiOnline ? "在线" : apiStatusLabel }}</span>
          </div>
          <div class="status-pill" :class="ocrReady ? 'is-good' : 'is-muted'">
            <ScanLine class="pill-icon" />
            <span class="status-dot" />
            <span>OCR {{ ocrReady ? "ready" : ocr.engineStatus.value }}</span>
          </div>
          <label class="deck-switcher">
            <Library class="pill-icon gold-text" />
            <span>当前牌堆:</span>
            <select
              :value="session.deckProfile.value.id"
              @change="session.switchDeckProfile(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="profile in session.deckProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name }}
              </option>
            </select>
          </label>
          <button class="action-button header-primary" type="button" @click="session.endCurrentSession()">
            <ClipboardCheck class="button-icon" />
            结束本局并生成报告
          </button>
        </div>
      </header>

      <main v-if="activeModule === 'live'" class="battle-grid">
        <div class="space-y-6 battle-column capture-column">
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
            @source-size-ready="screen.applyCropSourceSize"
            @update-deck-count-crop="screen.updateDeckCountCropRect"
            @reset-deck-count-crop="screen.resetDeckCountCropRect"
            @apply-crop="screen.refreshDerivedCanvases"
            @update:preprocess-enabled="screen.preprocessEnabled.value = $event"
          />

          <details class="compact-details">
            <summary>裁剪与预处理预览</summary>
            <CropPreview
              :original-src="screen.originalPreviewUrl.value"
              :cropped-src="screen.croppedPreviewUrl.value"
              :processed-src="screen.processedPreviewUrl.value"
              :deck-count-cropped-src="screen.deckCountCroppedPreviewUrl.value"
              :deck-count-processed-src="screen.deckCountProcessedPreviewUrl.value"
            />
          </details>
        </div>

        <div class="space-y-6 battle-column ocr-column">
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
            :pending-event-count="session.parsedEvents.value.length"
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
            @show-pending-events="showPendingEventsPanel"
          />

          <details ref="pendingEventsDetailsRef" class="compact-details">
            <summary>待确认事件（{{ session.parsedEvents.value.length }}）</summary>
            <ParsedEventsPanel
              :events="session.parsedEvents.value"
              @accept="acceptEventWithGuard"
              @reject="session.updateEventStatus($event, 'rejected')"
              @accept-high-confidence="session.acceptAllHighConfidence()"
            />
          </details>
        </div>

        <div class="space-y-6 battle-column deck-column">
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

        <footer class="system-strip xl:col-span-3">
          <span>● 系统运行正常</span>
          <span>↻ {{ autoListening ? "日志监听中" : "日志监听待机" }}</span>
          <span>◉ 自动保存已开启</span>
          <span class="ml-auto">© 2025 三国杀日志 OCR 记牌器</span>
          <span>v1.0.0</span>
        </footer>
      </main>

      <main v-else class="alias-page">
        <AliasLearningCenter />
      </main>
    </div>
    <UiGlobalMessageHost />
  </div>
</template>
