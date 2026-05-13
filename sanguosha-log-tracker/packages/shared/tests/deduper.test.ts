import { describe, expect, it } from "vitest"

import { createVisibleLogDeduper } from "../src/dedupe"

describe("createVisibleLogDeduper", () => {
  it("skips unchanged visible lines", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(0)
  })

  it("counts repeated occurrences in the visible window", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
    expect(deduper.getNewLines(["郭嘉使用闪", "郭嘉使用闪"])).toHaveLength(1)
  })

  it("treats first visible line as new", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
  })

  it("allows the same text again after it rolled out", () => {
    const deduper = createVisibleLogDeduper()
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
    expect(deduper.getNewLines([])).toHaveLength(0)
    expect(deduper.getNewLines(["郭嘉使用闪"])).toHaveLength(1)
  })
})
