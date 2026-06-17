(() => {
  const HOOK_VERSION = "extension-public-hook-v7-raw-protocol"
  const MAX_TEXT = 500
  const MAX_RECORDS = 5000
  const VISIBLE_SAMPLE_MS = 700
  const HIDDEN_SAMPLE_MS = 2000
  const publicEventPattern = /^(Pub|Gs|Msg|Smsg|Game|Room|S2C|C2S|Net)/i
  const textPattern = /使用|打出|弃置|获得|判定|发动|受到|回复|濒死|杀的目标|托管|思考|请选择|请弃置|无懈可击|桃|闪|杀|系统|牌局|洗牌|剩余牌|牌堆|牌库|回合|轮|1v1|新1v1|一对一|一战到底|2v2|欢乐|欢乐成双|欢乐军争|房间模式|模式/

  function cleanText(value) {
    if (value == null) return ""
    return String(value)
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT)
  }

  function safePos(node) {
    try {
      const point = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null
      const canvas = (window.Laya && Laya.stage && Laya.stage.canvas) || document.querySelector("canvas")
      const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null
      const stageWidth = (window.Laya && Laya.stage && Laya.stage.width) || (canvas && canvas.width) || 0
      const stageHeight = (window.Laya && Laya.stage && Laya.stage.height) || (canvas && canvas.height) || 0
      const scaleX = rect && stageWidth ? rect.width / stageWidth : 1
      const scaleY = rect && stageHeight ? rect.height / stageHeight : 1
      const rawX = point ? point.x : node.x || 0
      const rawY = point ? point.y : node.y || 0
      const rawWidth = node.width || 0
      const rawHeight = node.height || 0
      return {
        x: Math.round((rect ? rect.left : 0) + rawX * scaleX),
        y: Math.round((rect ? rect.top : 0) + rawY * scaleY),
        width: Math.round(rawWidth * scaleX),
        height: Math.round(rawHeight * scaleY),
        visible: node.visible !== false,
        name: node.name || "",
        ctor: (node.constructor && node.constructor.name) || ""
      }
    } catch (_) {
      return null
    }
  }

  function isExactDeckDraw(text) {
    const match = text.match(/^(.*?)从摸牌堆获得(.+)$/)
    if (!match) return null
    const rest = match[2].trim()
    if (/^\d+张牌$/.test(rest)) return null
    return { actor: match[1].trim(), rest }
  }

  function countCards(rest) {
    const countMatch = rest.match(/(\d+)张牌/)
    if (countMatch) return Number(countMatch[1])
    const parts = rest.split(/[，,、]/).map((item) => item.trim()).filter(Boolean)
    return parts.length || 1
  }

  function sanitizeTextForPersistence(text, pos) {
    const draw = isExactDeckDraw(text)
    if (!draw) return { text, redacted: false }
    const authorized = draw.actor.includes("您") || (pos && pos.visible === true)
    if (authorized) return { text, redacted: false, actor: draw.actor }
    return {
      text: text.replace(/从摸牌堆获得(.+)$/, `从摸牌堆获得${countCards(draw.rest)}张牌`),
      rawText: text,
      redacted: true,
      redactionReason: "unauthorized-offscreen-deck-draw",
      actor: draw.actor
    }
  }

  function emit(record) {
    window.postMessage(
      {
        source: "sgs-tracker-page-hook",
        hookVersion: HOOK_VERSION,
        record
      },
      "*"
    )
  }

  function push(record) {
    const hook = window.__SGS_PUBLIC_HOOK__
    if (!hook) return
    const enriched = Object.assign({ at: Date.now() }, record)
    hook.records.push(enriched)
    if (hook.records.length > MAX_RECORDS) {
      hook.records.splice(0, hook.records.length - MAX_RECORDS)
    }
    emit(enriched)
  }

  function bytesToBase64(bytes) {
    try {
      let binary = ""
      const chunkSize = 0x8000
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize)
        binary += String.fromCharCode.apply(null, Array.from(chunk))
      }
      return btoa(binary)
    } catch (_) {
      return ""
    }
  }

  function decodeBytes(bytes, encoding) {
    try {
      return new TextDecoder(encoding, { fatal: false }).decode(bytes)
    } catch (error) {
      return `<decode failed: ${error && error.message ? error.message : error}>`
    }
  }

  function rawBytesPayload(bytes) {
    const safeBytes = bytes || new Uint8Array(0)
    return {
      byteLength: safeBytes.byteLength,
      base64: bytesToBase64(safeBytes),
      hex: Array.from(safeBytes).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      utf8: decodeBytes(safeBytes, "utf-8"),
      gb18030: decodeBytes(safeBytes, "gb18030")
    }
  }

  function normalizeBinaryPayload(value, done) {
    try {
      if (typeof value === "string") {
        const encoded = new TextEncoder().encode(value)
        done({ kind: "string", text: value, decoded: rawBytesPayload(encoded) })
        return
      }
      if (value instanceof ArrayBuffer) {
        done({ kind: "arraybuffer", decoded: rawBytesPayload(new Uint8Array(value)) })
        return
      }
      if (ArrayBuffer.isView(value)) {
        done({
          kind: value.constructor && value.constructor.name ? value.constructor.name : "typed-array",
          decoded: rawBytesPayload(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        })
        return
      }
      if (typeof Blob !== "undefined" && value instanceof Blob) {
        value.arrayBuffer().then((buffer) => {
          done({ kind: "blob", type: value.type || "", decoded: rawBytesPayload(new Uint8Array(buffer)) })
        }).catch((error) => {
          done({ kind: "blob-error", error: String(error && error.stack || error) })
        })
        return
      }
      done({ kind: typeof value, text: String(value) })
    } catch (error) {
      done({ kind: "normalize-error", error: String(error && error.stack || error) })
    }
  }

  function cloneRawValue(value, depth, seen) {
    if (value == null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "function") return { __type: "function", name: value.name || "" }
    if (typeof value !== "object") return String(value)
    if (depth > 10) return { __truncated: "depth", __ctor: value.constructor && value.constructor.name || "" }
    if (seen.indexOf(value) >= 0) return { __circular: true, __ctor: value.constructor && value.constructor.name || "" }
    seen.push(value)
    try {
      if (value instanceof ArrayBuffer) {
        return { __type: "ArrayBuffer", ...rawBytesPayload(new Uint8Array(value)) }
      }
      if (ArrayBuffer.isView(value)) {
        return {
          __type: value.constructor && value.constructor.name || "TypedArray",
          ...rawBytesPayload(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        }
      }
    } catch (_) {}
    if (Array.isArray(value)) {
      const output = value.map((item) => cloneRawValue(item, depth + 1, seen))
      seen.pop()
      return output
    }
    const output = { __ctor: value.constructor && value.constructor.name || "Object" }
    let keys = []
    try {
      keys = Object.keys(value)
    } catch (_) {}
    for (const key of keys) {
      try {
        output[key] = cloneRawValue(value[key], depth + 1, seen)
      } catch (error) {
        output[key] = { __error: String(error && error.message || error) }
      }
    }
    seen.pop()
    return output
  }

  function installRawWebSocketCapture() {
    try {
      if (window.__SGS_RAW_WS_CAPTURE_VERSION__ === HOOK_VERSION) return
      const OriginalWebSocket = window.WebSocket
      if (!OriginalWebSocket || !OriginalWebSocket.prototype) return
      function CapturedWebSocket(url, protocols) {
        const socket = protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols)
        try {
          const wsUrl = String(url)
          socket.addEventListener("message", (event) => {
            normalizeBinaryPayload(event.data, (payload) => {
              push({ kind: "raw-ws-frame", direction: "recv", wsUrl, payload })
            })
          })
        } catch (_) {}
        return socket
      }
      CapturedWebSocket.prototype = OriginalWebSocket.prototype
      Object.setPrototypeOf(CapturedWebSocket, OriginalWebSocket)
      window.WebSocket = CapturedWebSocket
      const originalSend = OriginalWebSocket.prototype.send
      if (OriginalWebSocket.prototype.__sgsRawSendCaptureVersion !== HOOK_VERSION) {
        OriginalWebSocket.prototype.send = function capturedSend(data) {
          try {
            normalizeBinaryPayload(data, (payload) => {
              push({ kind: "raw-ws-frame", direction: "sent", wsUrl: this && this.url ? this.url : "", payload })
            })
          } catch (_) {}
          return originalSend.apply(this, arguments)
        }
        OriginalWebSocket.prototype.__sgsRawSendCaptureVersion = HOOK_VERSION
      }
      window.__SGS_RAW_WS_CAPTURE_VERSION__ = HOOK_VERSION
      push({ kind: "raw-capture-ready", text: "raw-websocket-capture-ready" })
    } catch (error) {
      push({ kind: "raw-capture-error", text: String(error && error.stack || error) })
    }
  }

  function summarizeProtocolValue(value, depth) {
    if (value == null || typeof value === "boolean" || typeof value === "number") return value
    if (typeof value === "string") return value.slice(0, 80)
    if (depth > 2) return undefined
    if (Array.isArray(value)) {
      return value.slice(0, 8).map((item) => summarizeProtocolValue(item, depth + 1)).filter((item) => item !== undefined)
    }
    if (typeof value !== "object") return undefined
    const output = {}
    for (const [key, child] of Object.entries(value)) {
      if (!/mode|mod|room|game|type|scene|playerNum|num|rule|id|kind|name|card|pile|deck|remain|left|shuffle|draw|discard/i.test(key)) continue
      const summarized = summarizeProtocolValue(child, depth + 1)
      if (summarized !== undefined) output[key] = summarized
    }
    return Object.keys(output).length ? output : undefined
  }

  function summarizeProtocolData(data) {
    try {
      return summarizeProtocolValue(data, 0)
    } catch (_) {
      return undefined
    }
  }

  function sampleSoon(reason) {
    const hook = window.__SGS_PUBLIC_HOOK__
    if (!hook || typeof hook.sampleStage !== "function") return
    try {
      hook.sampleStage(reason)
    } catch (_) {}
    window.setTimeout(() => {
      try {
        const latestHook = window.__SGS_PUBLIC_HOOK__
        if (latestHook && typeof latestHook.sampleStage === "function") {
          latestHook.sampleStage(`${reason}-deferred`)
        }
      } catch (_) {}
    }, 250)
  }

  function scheduleStageSampler() {
    const hook = window.__SGS_PUBLIC_HOOK__
    if (!hook || hook.sampleTimer) return
    const tick = () => {
      const latestHook = window.__SGS_PUBLIC_HOOK__
      if (!latestHook || latestHook.version !== HOOK_VERSION) return
      try {
        latestHook.sampleStage(document.visibilityState === "hidden" ? "hidden-interval" : "visible-interval")
      } catch (_) {}
      latestHook.sampleTimer = window.setTimeout(tick, document.visibilityState === "hidden" ? HIDDEN_SAMPLE_MS : VISIBLE_SAMPLE_MS)
    }
    hook.sampleTimer = window.setTimeout(tick, 0)
  }

  function recordText(kind, value, node) {
    const text = cleanText(value)
    if (!text || !textPattern.test(text)) return
    const pos = safePos(node)
    const sanitized = sanitizeTextForPersistence(text, pos)
    push({
      kind,
      text: sanitized.text,
      pos,
      redacted: sanitized.redacted || undefined,
      rawText: sanitized.rawText || undefined,
      redactionReason: sanitized.redactionReason
    })
  }

  function isAnchorCandidate(text, pos) {
    if (!text || !pos || pos.visible === false) return false
    if (text.length < 2 || text.length > 18) return false
    if (/^\d+$/.test(text)) return false
    if (/使用|打出|弃置|获得|判定|发动|受到|回复|濒死|请选择|请弃置|系统|牌局|剩余牌|牌堆|牌库|回合|轮|房间|模式|欢乐|小杀|出杀次数|托管|思考/.test(text)) return false
    return /[\u4e00-\u9fa5A-Za-z0-9_·•]/.test(text)
  }

  function install() {
    if (window.__SGS_PUBLIC_HOOK__ && window.__SGS_PUBLIC_HOOK__.version === HOOK_VERSION) {
      return
    }

    const L = window.Laya
    if (!L || !L.EventDispatcher) {
      window.setTimeout(install, 1000)
      return
    }

    window.__SGS_PUBLIC_HOOK__ = {
      installed: true,
      version: HOOK_VERSION,
      startedAt: Date.now(),
      seenStageText: Object.create(null),
      records: [],
      sampleTimer: 0,
      sampleStage(reason) {
        try {
          if (!window.Laya || !Laya.stage) return
          const seenTexts = []
          const walk = (node, depth) => {
            if (!node || depth > 30) return
            const values = [node.text, node._text, node.htmlText, node._htmlText, node.innerHTML]
            const pos = safePos(node)
            for (const value of values) {
              const text = cleanText(value)
              if (text) seenTexts.push({ text, pos })
              if (isAnchorCandidate(text, pos)) {
                const anchorBucket = Math.floor(Date.now() / 1000)
                const anchorKey = `anchor|${text}|${anchorBucket}|${pos ? [pos.x, pos.y, pos.width, pos.height, pos.visible].join(",") : ""}`
                if (!this.seenStageText[anchorKey]) {
                  this.seenStageText[anchorKey] = 1
                  push({ kind: "laya-anchor-candidate", text, pos })
                }
              }
              if (!text || !textPattern.test(text)) continue
              const bucket = Math.floor(Date.now() / 1000)
              const key = `${text}|${bucket}|${pos ? [pos.x, pos.y, pos.width, pos.height, pos.visible].join(",") : ""}`
              if (this.seenStageText[key]) continue
              this.seenStageText[key] = 1
              const sanitized = sanitizeTextForPersistence(text, pos)
              push({
                kind: "laya-stage-snapshot",
                text: sanitized.text,
                pos,
                redacted: sanitized.redacted || undefined,
                rawText: sanitized.rawText || undefined,
                redactionReason: sanitized.redactionReason
              })
            }
            const children = node._children || node._childs || node.children
            if (children && children.length) {
              for (let index = 0; index < children.length; index += 1) {
                walk(children[index], depth + 1)
              }
            }
          }
          walk(Laya.stage, 0)
          synthesizeRemainingText(seenTexts, this.seenStageText, reason)
        } catch (_) {}
      },
      drain() {
        const output = this.records.slice()
        this.records.length = 0
        return output
      }
    }

    const eventProto = L.EventDispatcher.prototype
    if (eventProto.__sgsPublicHookEventVersion !== HOOK_VERSION) {
      const originalEvent = eventProto.event
      eventProto.event = function patchedEvent(type, data) {
        try {
          if (typeof type === "string" && publicEventPattern.test(type)) {
            const dataSummary = summarizeProtocolData(data)
            const dataRaw = cloneRawValue(data, 0, [])
            push({ kind: "protocol-event", eventType: type, dataSummary })
            push({ kind: "raw-protocol-event", eventType: type, dataRaw })
          }
        } catch (_) {}
        return originalEvent.apply(this, arguments)
      }
      eventProto.__sgsPublicHookEventVersion = HOOK_VERSION
    }

    function patchSetter(Ctor, prop, kind) {
      if (!Ctor || !Ctor.prototype || Ctor.prototype[`__sgsHookVersion_${prop}`] === HOOK_VERSION) return false
      let proto = Ctor.prototype
      let desc = null
      while (proto && !desc) {
        desc = Object.getOwnPropertyDescriptor(proto, prop)
        proto = Object.getPrototypeOf(proto)
      }
      if (!desc || !desc.set) return false
      Object.defineProperty(Ctor.prototype, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get ? function getText() { return desc.get.call(this) } : undefined,
        set(value) {
          try {
            recordText(kind, value, this)
          } catch (_) {}
          return desc.set.call(this, value)
        }
      })
      Ctor.prototype[`__sgsHookVersion_${prop}`] = HOOK_VERSION
      return true
    }

    function patchMethod(Ctor, method, kind) {
      if (!Ctor || !Ctor.prototype || Ctor.prototype[`__sgsHookVersion_${method}`] === HOOK_VERSION) return false
      const original = Ctor.prototype[method]
      if (typeof original !== "function") return false
      Ctor.prototype[method] = function patchedTextMethod(value) {
        try {
          recordText(kind, value, this)
        } catch (_) {}
        return original.apply(this, arguments)
      }
      Ctor.prototype[`__sgsHookVersion_${method}`] = HOOK_VERSION
      return true
    }

    patchSetter(L.Text, "text", "laya-text")
    patchSetter(L.Label, "text", "laya-label")
    patchSetter(L.HTMLDivElement, "innerHTML", "laya-html")
    patchMethod(L.Text, "changeText", "laya-changeText")
    patchMethod(L.Label, "changeText", "laya-label-changeText")
    scheduleStageSampler()
    window.addEventListener("pageshow", () => {
      push({ kind: "page-lifecycle", text: "pageshow" })
      sampleSoon("pageshow")
    })
    window.addEventListener("focus", () => {
      push({ kind: "page-lifecycle", text: "focus" })
      sampleSoon("focus")
    })
    window.addEventListener("blur", () => {
      push({ kind: "page-lifecycle", text: "blur" })
      sampleSoon("blur")
    })
    document.addEventListener("visibilitychange", () => {
      push({ kind: "page-lifecycle", text: document.visibilityState === "hidden" ? "hidden" : "visible" })
      sampleSoon(document.visibilityState)
    })
    document.addEventListener("freeze", () => {
      push({ kind: "page-lifecycle", text: "freeze" })
      sampleSoon("freeze")
    })
    document.addEventListener("resume", () => {
      push({ kind: "page-lifecycle", text: "resume" })
      sampleSoon("resume")
    })
    window.addEventListener("pagehide", () => {
      push({ kind: "page-lifecycle", text: "pagehide" })
      sampleSoon("pagehide")
    })
    window.addEventListener("beforeunload", () => {
      push({ kind: "page-lifecycle", text: "beforeunload" })
      sampleSoon("beforeunload")
    })
    emit({ at: Date.now(), kind: "hook-ready", text: "hook-ready" })
    installRawWebSocketCapture()
  }

  function synthesizeRemainingText(items, seenStageText, reason) {
    try {
      const labels = items.filter((item) => /剩余牌|牌堆|牌库/.test(item.text))
      const numbers = items.filter((item) => /^\d{1,3}$/.test(item.text))
      for (const label of labels) {
        const labelPos = label.pos
        const direct = label.text.match(/(?:剩余牌|牌堆|牌库)\s*[:：]?\s*(\d{1,3})/)
        if (direct) {
          const text = `剩余牌 ${direct[1]}`
          const bucket = Math.floor(Date.now() / 1000)
          const key = `synthetic|${text}|${bucket}`
          if (!seenStageText[key]) {
            seenStageText[key] = 1
            push({ kind: "laya-stage-synthetic", text, pos: labelPos, sampleReason: reason })
          }
          continue
        }
        if (!labelPos) continue
        let best = null
        let bestScore = Infinity
        const labelCenterX = (labelPos.x || 0) + (labelPos.width || 0) / 2
        const labelCenterY = (labelPos.y || 0) + (labelPos.height || 0) / 2
        for (const number of numbers) {
          const pos = number.pos
          if (!pos) continue
          const numberCenterX = (pos.x || 0) + (pos.width || 0) / 2
          const numberCenterY = (pos.y || 0) + (pos.height || 0) / 2
          const dx = Math.abs(numberCenterX - labelCenterX)
          const dy = Math.abs(numberCenterY - labelCenterY)
          const nearbyRight = Math.abs((pos.x || 0) - ((labelPos.x || 0) + (labelPos.width || 0))) < 170 && dy < 70
          const nearbyVertical = dx < 120 && dy < 95
          const score = dx + dy * 2
          if ((nearbyRight || nearbyVertical) && score < bestScore) {
            best = number
            bestScore = score
          }
        }
        if (!best) continue
        const text = `${label.text.replace(/\d+/g, "").trim()} ${best.text}`.trim()
        const bucket = Math.floor(Date.now() / 1000)
        const key = `synthetic|${text}|${bucket}`
        if (seenStageText[key]) continue
        seenStageText[key] = 1
        push({ kind: "laya-stage-synthetic", text, pos: labelPos, sampleReason: reason })
      }
    } catch (_) {}
  }

  install()
})()
