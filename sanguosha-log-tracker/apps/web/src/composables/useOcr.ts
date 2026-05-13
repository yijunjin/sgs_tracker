import { computed, ref } from "vue"
import type { OcrLine } from "@slt/shared"

import { MockOcrEngine } from "../services/mockOcrEngine"
import { PaddleOcrEngine } from "../services/paddleOcrEngine"

export function useOcr() {
  const engineStatus = ref<"idle" | "loading" | "ready" | "failed">("idle")
  const errorMessage = ref("")
  const text = ref("")
  const lines = ref<OcrLine[]>([])
  const rawLines = ref<OcrLine[]>([])
  const mergedLines = ref<OcrLine[]>([])
  const isRecognizing = ref(false)
  const paddleEngine = new PaddleOcrEngine()
  const mockEngine = new MockOcrEngine()

  function setText(nextText: string): void {
    text.value = nextText
  }

  function setError(message: string): void {
    errorMessage.value = message
  }

  function setRecognitionResult(raw: OcrLine[], merged = raw): void {
    rawLines.value = raw
    mergedLines.value = merged
    lines.value = merged
    text.value = merged.map((line) => line.text).join("\n")
  }

  async function runRealOcr(canvas: HTMLCanvasElement): Promise<OcrLine[]> {
    engineStatus.value = "loading"
    errorMessage.value = ""
    isRecognizing.value = true

    try {
      await paddleEngine.init()
      const result = await paddleEngine.recognize(canvas)
      setRecognitionResult(result)
      engineStatus.value = "ready"
      return result
    } catch (error) {
      engineStatus.value = "failed"
      errorMessage.value =
        error instanceof Error
          ? `${error.message}。你仍然可以使用 Mock OCR 或手动文本完成完整演示。`
          : "真实 OCR 运行失败。你仍然可以使用 Mock OCR 或手动文本完成完整演示。"
      throw error
    } finally {
      isRecognizing.value = false
    }
  }

  async function recognizeOnly(canvas: HTMLCanvasElement): Promise<OcrLine[]> {
    engineStatus.value = "loading"
    errorMessage.value = ""
    isRecognizing.value = true

    try {
      await paddleEngine.init()
      const result = await paddleEngine.recognize(canvas)
      engineStatus.value = "ready"
      return result
    } catch (error) {
      engineStatus.value = "failed"
      errorMessage.value =
        error instanceof Error
          ? `${error.message}。你仍然可以使用 Mock OCR 或手动文本完成完整演示。`
          : "真实 OCR 运行失败。你仍然可以使用 Mock OCR 或手动文本完成完整演示。"
      throw error
    } finally {
      isRecognizing.value = false
    }
  }

  async function runMockOcr(): Promise<OcrLine[]> {
    await mockEngine.init()
    const result = await mockEngine.recognize()
    setRecognitionResult(result)
    return result
  }

  return {
    engineStatus,
    errorMessage,
    text,
    lines,
    rawLines,
    mergedLines,
    isRecognizing,
    recognizedPreview: computed(() => lines.value.map((line) => line.text).join("\n")),
    rawPreview: computed(() => rawLines.value.map((line) => line.text).join("\n")),
    mergedPreview: computed(() => mergedLines.value.map((line) => line.text).join("\n")),
    setText,
    setError,
    setRecognitionResult,
    runRealOcr,
    recognizeOnly,
    runMockOcr
  }
}
