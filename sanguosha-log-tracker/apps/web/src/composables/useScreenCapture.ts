import { computed, ref, shallowRef, watch } from "vue"
import { defaultDeckCountCropRect } from "@slt/shared"

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

function createCanvas(width = 1, height = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  return canvas
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toPreviewUrl(canvas: HTMLCanvasElement | null): string {
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    return ""
  }

  return canvas.toDataURL("image/png")
}

function preprocessCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const output = createCanvas(source.width, source.height)
  const context = output.getContext("2d")
  if (!context) {
    return output
  }

  context.drawImage(source, 0, 0)
  const imageData = context.getImageData(0, 0, output.width, output.height)
  const contrastFactor = 1.35

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index] ?? 0
    const green = imageData.data[index + 1] ?? 0
    const blue = imageData.data[index + 2] ?? 0
    const grayscale = 0.299 * red + 0.587 * green + 0.114 * blue
    const contrasted = clamp((grayscale - 128) * contrastFactor + 128, 0, 255)
    const thresholded = contrasted > 132 ? 255 : contrasted

    imageData.data[index] = thresholded
    imageData.data[index + 1] = thresholded
    imageData.data[index + 2] = thresholded
  }

  context.putImageData(imageData, 0, 0)
  return output
}

export function cropDeckCountCanvas(source: HTMLCanvasElement, deckCountCropRect: CropRect): HTMLCanvasElement {
  const safeX = clamp(Math.round(deckCountCropRect.x), 0, Math.max(0, source.width - 1))
  const safeY = clamp(Math.round(deckCountCropRect.y), 0, Math.max(0, source.height - 1))
  const safeWidth = clamp(Math.round(deckCountCropRect.width), 1, Math.max(1, source.width - safeX))
  const safeHeight = clamp(Math.round(deckCountCropRect.height), 1, Math.max(1, source.height - safeY))
  const canvas = createCanvas(safeWidth, safeHeight)
  const context = canvas.getContext("2d")
  if (!context) {
    return canvas
  }

  context.drawImage(source, safeX, safeY, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight)
  return canvas
}

export function prepareDeckCountOcrCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const scale = 5
  const output = createCanvas(canvas.width * scale, canvas.height * scale)
  const context = output.getContext("2d")
  if (!context) {
    return output
  }

  context.imageSmoothingEnabled = false
  context.drawImage(canvas, 0, 0, output.width, output.height)
  const imageData = context.getImageData(0, 0, output.width, output.height)
  const contrastFactor = 1.8

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index] ?? 0
    const green = imageData.data[index + 1] ?? 0
    const blue = imageData.data[index + 2] ?? 0
    const grayscale = 0.299 * red + 0.587 * green + 0.114 * blue
    const contrasted = clamp((grayscale - 128) * contrastFactor + 128, 0, 255)
    const thresholded = contrasted > 150 ? 255 : 0
    imageData.data[index] = thresholded
    imageData.data[index + 1] = thresholded
    imageData.data[index + 2] = thresholded
  }

  context.putImageData(imageData, 0, 0)
  return output
}

function cropVideoFrame(videoElement: HTMLVideoElement, cropRect: CropRect): HTMLCanvasElement | null {
  if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    return null
  }

  const safeX = clamp(cropRect.x, 0, Math.max(0, videoElement.videoWidth - 1))
  const safeY = clamp(cropRect.y, 0, Math.max(0, videoElement.videoHeight - 1))
  const safeWidth = clamp(cropRect.width, 1, Math.max(1, videoElement.videoWidth - safeX))
  const safeHeight = clamp(cropRect.height, 1, Math.max(1, videoElement.videoHeight - safeY))
  const canvas = createCanvas(safeWidth, safeHeight)
  const context = canvas.getContext("2d")

  if (!context) {
    return null
  }

  context.drawImage(
    videoElement,
    safeX,
    safeY,
    safeWidth,
    safeHeight,
    0,
    0,
    safeWidth,
    safeHeight
  )

  return canvas
}

export function useScreenCapture() {
  const stream = shallowRef<MediaStream | null>(null)
  const sourceCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const croppedCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const processedCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const deckCountCroppedCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const deckCountProcessedCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const originalPreviewUrl = ref("")
  const croppedPreviewUrl = ref("")
  const processedPreviewUrl = ref("")
  const deckCountCroppedPreviewUrl = ref("")
  const deckCountProcessedPreviewUrl = ref("")
  const captureError = ref("")
  const sourceLabel = ref("未选择来源")
  const preprocessEnabled = ref(true)
  const deckCountCropRect = ref<CropRect>(loadDeckCountCropRect())
  const cropRect = ref<CropRect>({
    x: 1677,
    y: 337,
    width: 200,
    height: 230
  })

  function normalizeCropRect(value: Partial<CropRect>): CropRect {
    return {
      x: Math.max(0, Math.round(Number(value.x) || 0)),
      y: Math.max(0, Math.round(Number(value.y) || 0)),
      width: Math.max(1, Math.round(Number(value.width) || 1)),
      height: Math.max(1, Math.round(Number(value.height) || 1))
    }
  }

  function loadDeckCountCropRect(): CropRect {
    try {
      const stored = window.localStorage.getItem("slt.deckCountCropRect")
      if (!stored) {
        const legacyStored = window.localStorage.getItem("slt.deckCountRoiPercent")
        if (legacyStored) {
          const legacy = JSON.parse(legacyStored) as CropRect
          if (legacy.width <= 1 && legacy.height <= 1) {
            return normalizeCropRect({
              x: legacy.x * 1920,
              y: legacy.y * 1080,
              width: legacy.width * 1920,
              height: legacy.height * 1080
            })
          }
          return normalizeCropRect(legacy)
        }

        return { ...defaultDeckCountCropRect }
      }
      const parsed = JSON.parse(stored) as CropRect
      return normalizeCropRect(parsed)
    } catch {
      return { ...defaultDeckCountCropRect }
    }
  }

  function refreshDerivedCanvases(): void {
    const source = sourceCanvas.value
    if (!source) {
      croppedCanvas.value = null
      processedCanvas.value = null
      deckCountCroppedCanvas.value = null
      deckCountProcessedCanvas.value = null
      originalPreviewUrl.value = ""
      croppedPreviewUrl.value = ""
      processedPreviewUrl.value = ""
      deckCountCroppedPreviewUrl.value = ""
      deckCountProcessedPreviewUrl.value = ""
      return
    }

    const safeX = clamp(cropRect.value.x, 0, Math.max(0, source.width - 1))
    const safeY = clamp(cropRect.value.y, 0, Math.max(0, source.height - 1))
    const safeWidth = clamp(cropRect.value.width, 1, Math.max(1, source.width - safeX))
    const safeHeight = clamp(cropRect.value.height, 1, Math.max(1, source.height - safeY))

    const cropped = createCanvas(safeWidth, safeHeight)
    const croppedContext = cropped.getContext("2d")
    if (!croppedContext) {
      return
    }

    croppedContext.drawImage(
      source,
      safeX,
      safeY,
      safeWidth,
      safeHeight,
      0,
      0,
      safeWidth,
      safeHeight
    )

    croppedCanvas.value = cropped
    processedCanvas.value = preprocessEnabled.value ? preprocessCanvas(cropped) : cropped
    originalPreviewUrl.value = toPreviewUrl(source)
    croppedPreviewUrl.value = toPreviewUrl(cropped)
    processedPreviewUrl.value = toPreviewUrl(processedCanvas.value)
    refreshDeckCountPreview(source)
  }

  function refreshDeckCountPreview(source: HTMLCanvasElement | null = sourceCanvas.value): void {
    if (!source) {
      deckCountCroppedCanvas.value = null
      deckCountProcessedCanvas.value = null
      deckCountCroppedPreviewUrl.value = ""
      deckCountProcessedPreviewUrl.value = ""
      return
    }

    const cropped = cropDeckCountCanvas(source, deckCountCropRect.value)
    const processed = prepareDeckCountOcrCanvas(cropped)
    deckCountCroppedCanvas.value = cropped
    deckCountProcessedCanvas.value = processed
    deckCountCroppedPreviewUrl.value = toPreviewUrl(cropped)
    deckCountProcessedPreviewUrl.value = toPreviewUrl(processed)
  }

  async function startDisplayCapture(): Promise<void> {
    captureError.value = ""
    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      })

      stream.value?.getTracks().forEach((track) => track.stop())
      stream.value = nextStream
      sourceLabel.value = "屏幕捕获"
    } catch (error) {
      captureError.value = error instanceof Error ? error.message : "无法启动屏幕捕获。"
    }
  }

  function stopDisplayCapture(): void {
    stream.value?.getTracks().forEach((track) => track.stop())
    stream.value = null
  }

  function captureCurrentFrame(videoElement: HTMLVideoElement | null): void {
    captureError.value = ""
    if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      captureError.value = "当前没有可截取的视频画面。"
      return
    }

    const canvas = createCanvas(videoElement.videoWidth, videoElement.videoHeight)
    const context = canvas.getContext("2d")
    if (!context) {
      captureError.value = "无法创建截图画布。"
      return
    }

    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
    sourceCanvas.value = canvas
    refreshDerivedCanvases()
  }

  function captureCurrentSourceFrame(videoElement: HTMLVideoElement | null): HTMLCanvasElement | null {
    if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      return null
    }

    const canvas = createCanvas(videoElement.videoWidth, videoElement.videoHeight)
    const context = canvas.getContext("2d")
    if (!context) {
      return null
    }

    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  function captureCurrentRoiFrame(videoElement: HTMLVideoElement | null): HTMLCanvasElement | null {
    captureError.value = ""
    if (!videoElement) {
      captureError.value = "当前没有可截取的视频画面。"
      return null
    }

    const cropped = cropVideoFrame(videoElement, cropRect.value)
    if (!cropped) {
      captureError.value = "当前没有可截取的视频画面。"
      return null
    }

    return preprocessEnabled.value ? preprocessCanvas(cropped) : cropped
  }

  async function loadImageFile(file: File): Promise<void> {
    captureError.value = ""
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = createCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext("2d")
      if (!context) {
        throw new Error("无法绘制上传图片。")
      }

      context.drawImage(bitmap, 0, 0)
      sourceCanvas.value = canvas
      sourceLabel.value = `上传图片：${file.name}`
      refreshDerivedCanvases()
    } catch (error) {
      captureError.value = error instanceof Error ? error.message : "上传图片失败。"
    }
  }

  function generateSampleImage(): void {
    const canvas = createCanvas(960, 540)
    const context = canvas.getContext("2d")
    if (!context) {
      captureError.value = "无法创建示例截图。"
      return
    }

    context.fillStyle = "#111827"
    context.fillRect(0, 0, canvas.width, canvas.height)

    context.fillStyle = "#0f172a"
    context.fillRect(18, 70, 924, 340)

    context.strokeStyle = "#334155"
    context.lineWidth = 2
    context.strokeRect(18, 70, 924, 340)

    context.fillStyle = "#020617"
    context.fillRect(704, 72, 118, 34)
    context.strokeStyle = "#f59e0b"
    context.strokeRect(704, 72, 118, 34)
    context.fillStyle = "#fef3c7"
    context.font = '600 18px "Microsoft YaHei"'
    context.fillText("剩余牌12", 716, 96)

    context.fillStyle = "#f8fafc"
    context.font = '600 18px "Microsoft YaHei"'
    context.fillText("公开游戏日志区域", 40, 54)

    const lines = [
      "刘备 使用了【杀】",
      "曹操 打出了【闪】",
      "孙权 弃置了【桃】",
      "司马懿 判定牌为【黑桃2 八卦阵】",
      "黄盖 使用了【酒】",
      "诸葛亮 使用了【无懈可击】"
    ]

    context.font = '24px "Microsoft YaHei"'
    lines.forEach((line, index) => {
      context.fillStyle = index % 2 === 0 ? "#f8fafc" : "#fef3c7"
      context.fillText(line, 42, 128 + index * 46)
    })

    sourceCanvas.value = canvas
    sourceLabel.value = "示例日志截图"
    cropRect.value = {
      x: 24,
      y: 86,
      width: 900,
      height: 310
    }
    deckCountCropRect.value = {
      x: 704,
      y: 72,
      width: 118,
      height: 34
    }
    refreshDerivedCanvases()
  }

  function updateCropRect(nextCropRect: CropRect): void {
    cropRect.value = {
      x: Math.max(0, nextCropRect.x),
      y: Math.max(0, nextCropRect.y),
      width: Math.max(1, nextCropRect.width),
      height: Math.max(1, nextCropRect.height)
    }
  }

  function updateDeckCountCropRect(nextCropRect: CropRect): void {
    deckCountCropRect.value = normalizeCropRect(nextCropRect)
  }

  function resetDeckCountCropRect(): void {
    deckCountCropRect.value = { ...defaultDeckCountCropRect }
  }

  watch(
    () => [cropRect.value.x, cropRect.value.y, cropRect.value.width, cropRect.value.height, preprocessEnabled.value],
    () => refreshDerivedCanvases()
  )

  watch(
    () => deckCountCropRect.value,
    (value) => {
      window.localStorage.setItem("slt.deckCountCropRect", JSON.stringify(value))
      refreshDeckCountPreview()
    },
    { deep: true }
  )

  return {
    stream,
    cropRect,
    deckCountCropRect,
    preprocessEnabled,
    captureError,
    sourceLabel,
    originalPreviewUrl,
    croppedPreviewUrl,
    processedPreviewUrl,
    deckCountCroppedPreviewUrl,
    deckCountProcessedPreviewUrl,
    activeCanvas: computed(() => (preprocessEnabled.value ? processedCanvas.value : croppedCanvas.value)),
    activeDeckCountCanvas: computed(() => deckCountProcessedCanvas.value),
    activeSourceCanvas: computed(() => sourceCanvas.value),
    hasSource: computed(() => Boolean(sourceCanvas.value)),
    startDisplayCapture,
    stopDisplayCapture,
    captureCurrentFrame,
    captureCurrentSourceFrame,
    captureCurrentRoiFrame,
    loadImageFile,
    generateSampleImage,
    updateCropRect,
    updateDeckCountCropRect,
    resetDeckCountCropRect,
    refreshDeckCountPreview,
    refreshDerivedCanvases
  }
}
