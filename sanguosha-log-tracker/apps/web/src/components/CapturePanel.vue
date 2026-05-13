<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { CropRect } from "../composables/useScreenCapture"

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
  (event: "update-crop", cropRect: CropRect): void
  (event: "update-deck-count-crop", cropRect: CropRect): void
  (event: "reset-deck-count-crop"): void
  (event: "apply-crop"): void
  (event: "update:preprocessEnabled", value: boolean): void
}>()

const videoElement = ref<HTMLVideoElement | null>(null)
const localCropRect = ref<CropRect>({ ...props.cropRect })
const localDeckCountCropRect = ref<CropRect>({ ...props.deckCountCropRect })

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
    }
  },
  { immediate: true }
)

const captureLabel = computed(() => (props.stream ? "重新选择窗口/标签页" : "开始屏幕捕获"))

function emitCropUpdate(): void {
  emit("update-crop", localCropRect.value)
}

function emitDeckCountRoiUpdate(): void {
  emit("update-deck-count-crop", localDeckCountCropRect.value)
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    emit("upload-file", file)
  }
  input.value = ""
}

defineExpose({
  getVideoElement: () => videoElement.value
})
</script>

<template>
  <section class="glass-panel rounded-3xl p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="section-title">日志截图来源</h2>
        <p class="mt-1 text-sm muted">支持屏幕捕获、上传截图和示例日志三种来源。</p>
      </div>
      <span class="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
        {{ sourceLabel }}
      </span>
    </div>

    <div class="mt-4 grid gap-3 md:grid-cols-2">
      <button class="action-button" type="button" @click="emit('start-capture')">
        {{ captureLabel }}
      </button>
      <button class="action-button secondary-button" type="button" :disabled="!stream" @click="emit('stop-capture')">
        停止捕获
      </button>
      <button
        class="action-button secondary-button md:col-span-2"
        type="button"
        :disabled="!stream"
        @click="emit('capture-frame', videoElement)"
      >
        截取当前画面
      </button>
      <label class="input-shell flex cursor-pointer items-center justify-center md:col-span-2">
        上传图片
        <input class="hidden" type="file" accept="image/*" @change="handleFileChange" />
      </label>
      <button class="action-button md:col-span-2" type="button" @click="emit('generate-sample')">
        生成示例日志截图
      </button>
    </div>

    <div class="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80">
      <video ref="videoElement" class="h-56 w-full object-contain" autoplay muted playsinline />
    </div>

    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <label class="text-sm">
        <span class="mb-2 block text-slate-300">裁剪 X</span>
        <input v-model.number="localCropRect.x" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
      <label class="text-sm">
        <span class="mb-2 block text-slate-300">裁剪 Y</span>
        <input v-model.number="localCropRect.y" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
      <label class="text-sm">
        <span class="mb-2 block text-slate-300">裁剪宽度</span>
        <input v-model.number="localCropRect.width" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
      <label class="text-sm">
        <span class="mb-2 block text-slate-300">裁剪高度</span>
        <input v-model.number="localCropRect.height" class="input-shell w-full" type="number" @input="emitCropUpdate" />
      </label>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button class="action-button secondary-button" type="button" :disabled="!hasSource" @click="emit('apply-crop')">
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

    <div class="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-slate-200">剩余牌数 OCR 区域</h3>
          <p class="mt-1 text-xs text-slate-400">独立于日志区域，使用整张游戏画面的像素坐标裁剪。</p>
        </div>
        <button class="action-button secondary-button" type="button" @click="emit('reset-deck-count-crop')">
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

    <p v-if="captureError" class="mt-3 rounded-2xl border border-red-400/20 bg-red-950/30 px-4 py-3 text-sm text-red-200">
      {{ captureError }}
    </p>
  </section>
</template>
