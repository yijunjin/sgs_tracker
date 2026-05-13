import type { OcrLine as SharedOcrLine } from "@slt/shared"
import ortJsepMjsUrl from "../vendor/ort/ort-wasm-simd-threaded.jsep.mjs?url"
import ortJsepWasmUrl from "../vendor/ort/ort-wasm-simd-threaded.jsep.wasm?url"

export interface OcrLine extends SharedOcrLine {}

export interface OcrEngine {
  init(): Promise<void>
  recognize(input: HTMLCanvasElement | ImageData | Blob | ImageBitmap): Promise<OcrLine[]>
}

interface PaddleResultItem {
  text?: string
  score?: number
  poly?: unknown
}

interface PaddleResult {
  items?: PaddleResultItem[]
}

type PaddlePredictInput = HTMLCanvasElement | ImageData | Blob | ImageBitmap

type PaddleInstance = {
  initialize?: () => Promise<unknown>
  predict?: (input: PaddlePredictInput | PaddlePredictInput[]) => Promise<unknown>
  recognize?: (input: PaddlePredictInput) => Promise<unknown>
  detect?: (input: PaddlePredictInput) => Promise<unknown>
  dispose?: () => Promise<void> | void
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function getOrtWasmPaths(): { mjs: string; wasm: string } {
  return {
    mjs: ortJsepMjsUrl,
    wasm: ortJsepWasmUrl
  }
}

function normalizePaddleResultItems(result: unknown): OcrLine[] {
  if (!Array.isArray(result)) {
    return []
  }

  const lines: Array<OcrLine | undefined> = result.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [] as Array<OcrLine | undefined>
    }

    const items = (entry as PaddleResult).items
    if (!Array.isArray(items)) {
      return [] as Array<OcrLine | undefined>
    }

    return items.map((item) => {
      if (!item || typeof item !== "object" || typeof item.text !== "string") {
        return undefined
      }

      return {
        text: item.text,
        score: typeof item.score === "number" ? item.score : 0.9,
        box: item.poly
      }
    })
  })

  return lines.filter(isDefined)
}

function normalizeLegacyResult(result: unknown): OcrLine[] {
  if (!Array.isArray(result)) {
    return []
  }

  const lines: Array<OcrLine | undefined> = result.map((candidate) => {
    if (typeof candidate === "string") {
      return { text: candidate, score: 0.9 }
    }

    if (!candidate || typeof candidate !== "object") {
      return undefined
    }

    const maybeRecord = candidate as Record<string, unknown>
    const text =
      typeof maybeRecord.text === "string"
        ? maybeRecord.text
        : typeof maybeRecord.label === "string"
          ? maybeRecord.label
          : undefined

    if (!text) {
      return undefined
    }

    return {
      text,
      score:
        typeof maybeRecord.score === "number"
          ? maybeRecord.score
          : typeof maybeRecord.confidence === "number"
            ? maybeRecord.confidence
            : 0.9,
      box: maybeRecord.box ?? maybeRecord.points
    }
  })

  return lines.filter(isDefined)
}

function extractLines(result: unknown): OcrLine[] {
  const predictLines = normalizePaddleResultItems(result)
  if (predictLines.length > 0) {
    return predictLines
  }

  return normalizeLegacyResult(result)
}

async function loadPaddleFactory(): Promise<(options: Record<string, unknown>) => Promise<PaddleInstance>> {
  const mod = await import("@paddleocr/paddleocr-js")
  const namespace = mod as Record<string, unknown>
  const factoryContainer = (namespace.PaddleOCR ?? namespace.default ?? namespace) as Record<string, unknown>
  const create = factoryContainer.create ?? namespace.create

  if (typeof create !== "function") {
    throw new Error("当前安装的 @paddleocr/paddleocr-js 未暴露 create() 工厂方法。")
  }

  return create as (options: Record<string, unknown>) => Promise<PaddleInstance>
}

async function createPaddleInstance(worker: boolean): Promise<PaddleInstance> {
  const create = await loadPaddleFactory()
  const instance = await create({
    lang: "ch",
    ocrVersion: "PP-OCRv5",
    worker,
    ortOptions: {
      backend: "wasm",
      wasmPaths: getOrtWasmPaths(),
      simd: true,
      numThreads: worker ? 2 : 1
    }
  })

  if (typeof instance.initialize === "function") {
    await instance.initialize()
  }

  return instance
}

export class PaddleOcrEngine implements OcrEngine {
  private instance: PaddleInstance | null = null

  private initErrorMessages: string[] = []

  async init(): Promise<void> {
    if (this.instance) {
      return
    }

    const attempts: Array<{ worker: boolean; label: string }> = [
      { worker: false, label: "worker=false" },
      { worker: true, label: "worker=true" }
    ]

    this.initErrorMessages = []

    for (const attempt of attempts) {
      try {
        this.instance = await createPaddleInstance(attempt.worker)
        return
      } catch (error) {
        this.initErrorMessages.push(
          `${attempt.label}: ${error instanceof Error ? error.message : String(error)}`
        )
        this.instance = null
      }
    }

    throw new Error(
      `PaddleOCR 初始化失败。${this.initErrorMessages.join("；")}。请刷新页面后重试，或改用 Mock OCR / 手动文本继续演示。`
    )
  }

  async recognize(input: PaddlePredictInput): Promise<OcrLine[]> {
    if (!this.instance) {
      await this.init()
    }

    if (!this.instance) {
      throw new Error("PaddleOCR 尚未完成初始化。")
    }

    try {
      const result =
        typeof this.instance.predict === "function"
          ? await this.instance.predict(input)
          : typeof this.instance.recognize === "function"
            ? await this.instance.recognize(input)
            : typeof this.instance.detect === "function"
              ? await this.instance.detect(input)
              : undefined

      const lines = extractLines(result)
      if (lines.length === 0) {
        throw new Error("OCR 未返回可解析的文本行。")
      }

      return lines
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`PaddleOCR 推理失败：${message}`)
    }
  }
}
