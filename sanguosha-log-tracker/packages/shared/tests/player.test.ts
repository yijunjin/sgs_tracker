import { describe, expect, it } from "vitest"

import { canonicalPlayerKey, isSuspiciousPlayerName } from "../src/player"

describe("player helpers", () => {
  it("canonicalizes self player name", () => {
    expect(canonicalPlayerKey("界孙坚（您）")).toBe("__self__")
    expect(canonicalPlayerKey("流马5英魂奔雷木牛流马界孙坚（您）")).toBe("__self__")
  })

  it("marks suspicious player names", () => {
    expect(isSuspiciousPlayerName("界孙坚（您）")).toBe(false)
    expect(isSuspiciousPlayerName("流马5英魂奔雷木牛流马界孙坚（您）")).toBe(true)
  })
})
