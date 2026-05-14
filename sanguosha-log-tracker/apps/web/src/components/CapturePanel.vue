<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Camera, Crop, ImagePlus, RotateCcw, Scissors, SlidersHorizontal, Square, Upload } from "lucide-vue-next"
import type { CropRect, SourceSize } from "../composables/useScreenCapture"
import UiTag from "./ui/UiTag.vue"

const props = defineProps<{
  stream: MediaStream | null
  cropRect: CropRect
  deckCountCropRect: CropRect
  preprocessEnabled: boolean
  captureError: string
  sourceLabel: string
  hasSource: boolean
}>()

const emit = defineEmits<{
  (event: "start-capture"): void
  (event: "stop-capture"): void
  (event: "capture-frame", videoElement: HTMLVideoElement | null): void
  (event: "upload-file", file: File): void
  (event: "generate-sample"): void
  (event: "update-crop", cropRect: CropRect, sourceSize?: SourceSize): void
  (event: "update-deck-count-crop", cropRect: CropRect, sourceSize?: SourceSize): void
  (event: "reset-deck-count-crop"): void
  (event: "apply-crop"): void
  (event: "source-size-ready", sourceSize: SourceSize): void
  (event: "update:preprocessEnabled", value: boolean): void
}>()

interface VideoViewport {
  scale: number
  offsetX: number
  offsetY: number
  displayWidth: number
  displayHeight: number
  sourceWidth: number
  sourceHeight: number
}

type CropTarget = "log" | "deckCount"

const videoElement = ref<HTMLVideoElement | null>(null)
const videoFrame = ref<HTMLElement | null>(null)
const localCropRect = ref<CropRect>({ ...props.cropRect })
const localDeckCountCropRect = ref<CropRect>({ ...props.deckCountCropRect })
const previewSize = ref({ width: 0, height: 0 })
const videoSourceSize = ref<SourceSize | null>(null)
const selectedCropTarget = ref<CropTarget>("log")
const dragStart = ref<{ x: number; y: number } | null>(null)
const draftCropRect = ref<CropRect | null>(null)
const isDraggingCrop = ref(false)
let resizeObserver: ResizeObserver | undefined

watch(
  () => props.cropRect,
  (value) => {
    localCropRect.value = { ...value }
  },
  { deep: true }
)

watch(
  () => props.deckCountCropRect,
  (value) => {
    localDeckCountCropRect.value = { ...value }
  },
  { deep: true }
)

watch(
  () => props.stream,
  async (stream) => {
    if (!videoElement.value) {
      return
    }

    videoElement.value.srcObject = stream
    if (stream) {
      await videoElement.value.play().catch(() => undefined)
      handleVideoMetadata()
    } else {
      videoSourceSize.value = null
      cancelCropDrag()
    }
  },
  { immediate: true }
)

const captureLabel = computed(() => (props.stream ? "重新选择窗口/标签页" : "开始屏幕捕获"))
const cropTargetLabel = computed(() => (selectedCropTarget.value === "log" ? "日志区域" : "剩余牌数区域"))
const activeStoredSelectionRect = computed(() =>
  selectedCropTarget.value === "log" ? props.cropRect : props.deckCountCropRect
)
const inactiveStoredSelectionRect = computed(() =>
  selectedCropTarget.value === "log" ? props.deckCountCropRect : props.cropRect
)
const activeSelectionRect = computed(() => draftCropRect.value ?? activeStoredSelectionRect.value)

const selectionStyle = computed(() => {
  return rectToSelectionStyle(activeSelectionRect.value)
})

const inactiveSelectionStyle = computed(() => {
  if (isDraggingCrop.value) {
    return undefined
  }

  return rectToSelectionStyle(inactiveStoredSelectionRect.value)
})

const currentCropLabel = computed(() => {
  const rect = activeSelectionRect.value
  return `${cropTargetLabel.value} ${rect.x}, ${rect.y}, ${rect.width} x ${rect.height}`
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getSourceSize(): SourceSize | undefined {
  return videoSourceSize.value ?? undefined
}

function emitCropUpdate(): void {
  emit("update-crop", localCropRect.value, getSourceSize())
}

function emitDeckCountRoiUpdate(): void {
  emit("update-deck-count-crop", localDeckCountCropRect.value, getSourceSize())
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    emit("upload-file", file)
  }
  input.value = ""
}

function updatePreviewSize(): void {
  const element = videoFrame.value
  if (!element) {
    return
  }

  const rect = element.getBoundingClientRect()
  previewSize.value = {
    width: rect.width,
    height: rect.height
  }
}

function handleVideoMetadata(): void {
  const element = videoElement.value
  if (!element || element.videoWidth === 0 || element.videoHeight === 0) {
    return
  }

  const sourceSize = {
    width: element.videoWidth,
    height: element.videoHeight
  }
  videoSourceSize.value = sourceSize
  emit("source-size-ready", sourceSize)
  updatePreviewSize()
}

function getVideoViewport(): VideoViewport | null {
  const sourceSize = videoSourceSize.value
  if (!sourceSize || previewSize.value.width <= 0 || previewSize.value.height <= 0) {
    return null
  }

  const scale = Math.min(previewSize.value.width / sourceSize.width, previewSize.value.height / sourceSize.height)
  const displayWidth = sourceSize.width * scale
  const displayHeight = sourceSize.height * scale

  return {
    scale,
    displayWidth,
    displayHeight,
    offsetX: (previewSize.value.width - displayWidth) / 2,
    offsetY: (previewSize.value.height - displayHeight) / 2,
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height
  }
}

function rectToSelectionStyle(crop: CropRect): Record<string, string> | undefined {
  const viewport = getVideoViewport()
  if (!viewport) {
    return undefined
  }

  const safeX = clamp(crop.x, 0, Math.max(0, viewport.sourceWidth - 1))
  const safeY = clamp(crop.y, 0, Math.max(0, viewport.sourceHeight - 1))
  const safeWidth = clamp(crop.width, 1, Math.max(1, viewport.sourceWidth - safeX))
  const safeHeight = clamp(crop.height, 1, Math.max(1, viewport.sourceHeight - safeY))

  return {
    left: `${viewport.offsetX + safeX * viewport.scale}px`,
    top: `${viewport.offsetY + safeY * viewport.scale}px`,
    width: `${safeWidth * viewport.scale}px`,
    height: `${safeHeight * viewport.scale}px`
  }
}

function pointerToSourcePoint(event: PointerEvent): { x: number; y: number } | null {
  const frame = videoFrame.value
  const viewport = getVideoViewport()
  if (!frame || !viewport) {
    return null
  }

  const frameRect = frame.getBoundingClientRect()
  const localX = clamp(event.clientX - frameRect.left - viewport.offsetX, 0, viewport.displayWidth)
  const localY = clamp(event.clientY - frameRect.top - viewport.offsetY, 0, viewport.displayHeight)

  return {
    x: clamp(Math.round(localX / viewport.scale), 0, viewport.sourceWidth),
    y: clamp(Math.round(localY / viewport.scale), 0, viewport.sourceHeight)
  }
}

function createRectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): CropRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y))
  }
}

function beginCropDrag(event: PointerEvent): void {
  if (!props.stream || !getVideoViewport()) {
    return
  }

  const point = pointerToSourcePoint(event)
  if (!point) {
    return
  }

  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  dragStart.value = point
  draftCropRect.value = { x: point.x, y: point.y, width: 1, height: 1 }
  isDraggingCrop.value = true
}

function updateCropDrag(event: PointerEvent): void {
  if (!isDraggingCrop.value || !dragStart.value) {
    return
  }

  const point = pointerToSourcePoint(event)
  if (!point) {
    return
  }

  event.preventDefault()
  draftCropRect.value = createRectFromPoints(dragStart.value, point)
}

function finishCropDrag(event: PointerEvent): void {
  if (!isDraggingCrop.value) {
    return
  }

  event.preventDefault()
  const finalRect = draftCropRect.value
  isDraggingCrop.value = false
  dragStart.value = null
  draftCropRect.value = null

  if (!finalRect || finalRect.width < 4 || finalRect.height < 4) {
    return
  }

  if (selectedCropTarget.value === "log") {
    localCropRect.value = { ...finalRect }
    emit("update-crop", finalRect, getSourceSize())
  } else {
    localDeckCountCropRect.value = { ...finalRect }
    emit("update-deck-count-crop", finalRect, getSourceSize())
  }
}

function cancelCropDrag(): void {
  isDraggingCrop.value = false
  dragStart.value = null
  draftCropRect.value = null
}

onMounted(() => {
  void nextTick(updatePreviewSize)
  if (videoFrame.value) {
    resizeObserver = new ResizeObserver(updatePreviewSize)
    resizeObserver.observe(videoFrame.value)
  }
  window.addEventListener("resize", updatePreviewSize)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener("resize", updatePreviewSize)
})

defineExpose({
  getVideoElement: () => videoElement.value
})
</script>

<template>
  <section class="glass-panel p-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="section-title section-title-row"><Camera class="section-title-icon" />采集与识别</h2>
        <p class="mt-1 text-xs muted">支持屏幕捕获、上传截图和示例日志三种来源。</p>
      </div>
      <UiTag variant="gold">{{ sourceLabel }}</UiTag>
    </div>

    <div class="mt-4 grid gap-2 md:grid-cols-3">
      <button class="action-button" type="button" @click="emit('start-capture')">
        <Camera class="button-icon" />
        {{ captureLabel }}
      </button>
      <button class="action-button secondary-button" type="button" :disabled="!stream" @click="emit('stop-capture')">
        <Square class="button-icon" />
        停止捕获
      </button>
      <button
        class="action-button secondary-button"
        type="button"
        :disabled="!stream"
        @click="emit('capture-frame', videoElement)"
      >
        <Scissors class="button-icon" />
        截取当前画面
      </button>
      <label class="input-shell flex cursor-pointer items-center justify-center gap-2">
        <Upload class="button-icon" />
        上传图片
        <input class="hidden" type="file" accept="image/*" @change="handleFileChange" />
      </label>
      <button class="action-button md:col-span-2" type="button" @click="emit('generate-sample')">
        <ImagePlus class="button-icon" />
        生成示例日志截图
      </button>
    </div>

    <div class="crop-target-switch mt-3" role="group" aria-label="框选目标">
      <button
        class="crop-target-button"
        :class="{ 'is-active': selectedCropTarget === 'log' }"
        type="button"
        @click="selectedCropTarget = 'log'"
      >
        日志区域
      </button>
      <button
        class="crop-target-button"
        :class="{ 'is-active': selectedCropTarget === 'deckCount' }"
        type="button"
        @click="selectedCropTarget = 'deckCount'"
      >
        剩余牌数区域
      </button>
    </div>

    <div
      ref="videoFrame"
      class="capture-frame mt-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80"
      @pointerdown="beginCropDrag"
      @pointermove="updateCropDrag"
      @pointerup="finishCropDrag"
      @pointercancel="cancelCropDrag"
      @pointerleave="updateCropDrag"
    >
      <video ref="videoElement" class="h-40 w-full object-contain" autoplay muted playsinline @loadedmetadata="handleVideoMetadata" />
      <div
        v-if="inactiveSelectionStyle"
        class="crop-selection is-secondary"
        :class="{ 'is-deck-count': selectedCropTarget === 'log' }"
        :style="inactiveSelectionStyle"
      />
      <div
        v-if="selectionStyle"
        class="crop-selection"
        :class="{ 'is-dragging': isDraggingCrop, 'is-deck-count': selectedCropTarget === 'deckCount' }"
        :style="selectionStyle"
      >
        <span>{{ currentCropLabel }}</span>
      </div>
    </div>

    <div class="mt-3 grid gap-2 sm:grid-cols-4">
      <label class="text-sm">
        <span class="mb-1 block text-xs text-slate-300">X</span>
        <input v-model.number="localCropRect.x" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-xs text-slate-300">Y</span>
        <input v-model.number="localCropRect.y" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-xs text-slate-300">宽度</span>
        <input v-model.number="localCropRect.width" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-xs text-slate-300">高度</span>
        <input v-model.number="localCropRect.height" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button class="action-button secondary-button" type="button" :disabled="!hasSource" @click="emit('apply-crop')">
        <Crop class="button-icon" />
        重新裁剪
      </button>
      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input
          :checked="preprocessEnabled"
          class="h-4 w-4 rounded border-slate-600 bg-slate-900"
          type="checkbox"
          @change="emit('update:preprocessEnabled', ($event.target as HTMLInputElement).checked)"
        />
        启用图像预处理
      </label>
    </div>

    <details class="compact-details mt-3">
      <summary>剩余牌数 OCR 区域</summary>
      <div class="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="section-title-row text-sm font-semibold text-slate-200"><SlidersHorizontal class="section-title-icon" />剩余牌数 OCR 区域</h3>
          <p class="mt-1 text-xs text-slate-400">可在上方预览切换到“剩余牌数区域”后直接框选，也可以在这里精调坐标。</p>
        </div>
        <button class="action-button secondary-button" type="button" @click="emit('reset-deck-count-crop')">
          <RotateCcw class="button-icon" />
          恢复默认
        </button>
      </div>

      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="text-sm">
          <span class="mb-2 block text-slate-300">X</span>
          <input v-model.number="localDeckCountCropRect.x" class="input-shell w-full" min="0" type="number" @input="emitDeckCountRoiUpdate" />
        </label>
        <label class="text-sm">
          <span class="mb-2 block text-slate-300">Y</span>
          <input v-model.number="localDeckCountCropRect.y" class="input-shell w-full" min="0" type="number" @input="emitDeckCountRoiUpdate" />
        </label>
        <label class="text-sm">
          <span class="mb-2 block text-slate-300">宽度</span>
          <input v-model.number="localDeckCountCropRect.width" class="input-shell w-full" min="1" type="number" @input="emitDeckCountRoiUpdate" />
        </label>
        <label class="text-sm">
          <span class="mb-2 block text-slate-300">高度</span>
          <input v-model.number="localDeckCountCropRect.height" class="input-shell w-full" min="1" type="number" @input="emitDeckCountRoiUpdate" />
        </label>
      </div>
      </div>
    </details>

    <p v-if="captureError" class="mt-3 rounded-2xl border border-red-400/20 bg-red-950/30 px-4 py-3 text-sm text-red-200">
      {{ captureError }}
    </p>
  </section>
</template>

<style scoped>
.capture-frame {
  position: relative;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.capture-frame video {
  display: block;
}

.crop-target-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.5rem;
  background: rgba(7, 14, 25, 0.58);
  padding: 0.25rem;
}

.crop-target-button {
  border-radius: 0.35rem;
  color: #94a3b8;
  font-size: 0.78rem;
  font-weight: 800;
  line-height: 1;
  min-height: 2rem;
  padding: 0.45rem 0.6rem;
}

.crop-target-button.is-active {
  border: 1px solid rgba(245, 158, 11, 0.38);
  background: rgba(245, 158, 11, 0.16);
  color: #fef3c7;
}

.crop-selection {
  position: absolute;
  min-width: 10px;
  min-height: 10px;
  border: 2px solid rgba(245, 158, 11, 0.95);
  background: rgba(245, 158, 11, 0.14);
  box-shadow: 0 0 0 9999px rgba(2, 6, 23, 0.36), 0 0 18px rgba(245, 158, 11, 0.28);
  pointer-events: none;
}

.crop-selection.is-deck-count {
  border-color: rgba(96, 165, 250, 0.98);
  background: rgba(37, 99, 235, 0.16);
  box-shadow: 0 0 0 9999px rgba(2, 6, 23, 0.28), 0 0 18px rgba(96, 165, 250, 0.24);
}

.crop-selection.is-dragging {
  border-color: rgba(96, 165, 250, 0.98);
  background: rgba(37, 99, 235, 0.16);
}

.crop-selection.is-secondary {
  border-width: 1px;
  border-style: dashed;
  background: transparent;
  box-shadow: none;
  opacity: 0.75;
}

.crop-selection span {
  position: absolute;
  left: 0;
  top: 0;
  max-width: min(13rem, 100vw);
  transform: translateY(calc(-100% - 0.35rem));
  border: 1px solid rgba(245, 158, 11, 0.42);
  border-radius: 0.35rem;
  background: rgba(7, 14, 25, 0.92);
  color: #fef3c7;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
  padding: 0.28rem 0.4rem;
  white-space: nowrap;
}
</style>
