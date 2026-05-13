import { computed, ref, shallowRef, watch } from "vue"

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
  const originalPreviewUrl = ref("")
  const croppedPreviewUrl = ref("")
  const processedPreviewUrl = ref("")
  const captureError = ref("")
  const sourceLabel = ref("未选择来源")
  const preprocessEnabled = ref(true)
  const cropRect = ref<CropRect>({
    x: 1677,
    y: 337,
    width: 200,
    height: 230
  })

  function refreshDerivedCanvases(): void {
    const source = sourceCanvas.value
    if (!source) {
      croppedCanvas.value = null
      processedCanvas.value = null
      originalPreviewUrl.value = ""
      croppedPreviewUrl.value = ""
      processedPreviewUrl.value = ""
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

  watch(
    () => [cropRect.value.x, cropRect.value.y, cropRect.value.width, cropRect.value.height, preprocessEnabled.value],
    () => refreshDerivedCanvases()
  )

  return {
    stream,
    cropRect,
    preprocessEnabled,
    captureError,
    sourceLabel,
    originalPreviewUrl,
    croppedPreviewUrl,
    processedPreviewUrl,
    activeCanvas: computed(() => (preprocessEnabled.value ? processedCanvas.value : croppedCanvas.value)),
    hasSource: computed(() => Boolean(sourceCanvas.value)),
    startDisplayCapture,
    stopDisplayCapture,
    captureCurrentFrame,
    captureCurrentRoiFrame,
    loadImageFile,
    generateSampleImage,
    updateCropRect,
    refreshDerivedCanvases
  }
}
