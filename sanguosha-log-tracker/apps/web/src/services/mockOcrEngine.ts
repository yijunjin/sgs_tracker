import type { OcrLine } from "@slt/shared"

import type { OcrEngine } from "./paddleOcrEngine"

export const mockOcrLines: OcrLine[] = [
  { text: "刘备 使用了【杀】", score: 0.99 },
  { text: "曹操 打出了【闪】", score: 0.99 },
  { text: "孙权 弃置了【桃】", score: 0.97 },
  { text: "司马懿 判定牌为【黑桃2 八卦阵】", score: 0.98 },
  { text: "黄盖 使用了【酒】", score: 0.99 },
  { text: "诸葛亮 使用了【无懈可击】", score: 0.98 }
]

export class MockOcrEngine implements OcrEngine {
  async init(): Promise<void> {
    return Promise.resolve()
  }

  async recognize(): Promise<OcrLine[]> {
    return Promise.resolve(mockOcrLines)
  }
}
