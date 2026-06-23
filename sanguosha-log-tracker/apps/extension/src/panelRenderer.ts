import { createApp, type App as VueApp, type Component } from "vue"

/**
 * Vue 面板挂载和渲染调度。
 *
 * content.ts 的业务事件可能非常高频，不能每条 hook 都同步改 DOM。这个模块集中负责：
 * - 创建 shadow DOM 面板；
 * - 把原 CSS 选择器改成 shadow 内可用的 class 选择器；
 * - 合并高频 render 请求；
 * - 清理已废弃的敌方手牌浮窗根节点。
 *
 * 它不理解牌局状态，只在回调里让 content.ts 同步 store、上报 collector。
 */

export type PanelRenderer = {
  mountVuePanel(): void
  renderPanel(): void
  queueRender(): void
  scheduleRenderWork(callback: () => void): void
  ensureRootHost(): HTMLElement
  ensureRoot(): HTMLElement
  bindPanelEvents(): void
  queueKnownHandOverlayRender(force?: boolean): void
}

export function createPanelRenderer(options: {
  rootId: string
  handOverlayRootId: string
  trackerStyles: string
  appComponent: Component
  isTopFrame: boolean
  syncReactiveState: () => void
  bindTrackerActions: () => void
  queueRenderStateSnapshot: () => void
}): PanelRenderer {
  let vueApp: VueApp<Element> | undefined
  let renderQueued = false
  let handOverlayQueued = false
  let lastHandOverlayRenderAt = 0

  function ensureRootHost(): HTMLElement {
    let root = document.getElementById(options.rootId)
    if (!root) {
      root = document.createElement("div")
      root.id = options.rootId
      document.documentElement.append(root)
    }
    return root
  }

  function mountVuePanel(): void {
    const host = ensureRootHost()
    if (vueApp) {
      return
    }
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = options.trackerStyles
      .replaceAll(`#${options.rootId}`, ".sgs-card-tracker-root")
      .replaceAll(`#${options.handOverlayRootId}`, ".sgs-known-hand-overlay-root")
    const mountPoint = document.createElement("div")
    shadow.append(style, mountPoint)
    vueApp = createApp(options.appComponent)
    vueApp.mount(mountPoint)
  }

  function scheduleRenderWork(callback: () => void): void {
    if (document.visibilityState === "hidden") {
      window.setTimeout(callback, 0)
      return
    }
    window.requestAnimationFrame(callback)
  }

  function renderKnownHandOverlay(): void {
    document.getElementById(options.handOverlayRootId)?.remove()
  }

  function queueKnownHandOverlayRender(force = false): void {
    if (!options.isTopFrame) {
      return
    }
    const now = Date.now()
    if (!force && now - lastHandOverlayRenderAt < 200) {
      if (!handOverlayQueued) {
        handOverlayQueued = true
        window.setTimeout(() => {
          handOverlayQueued = false
          lastHandOverlayRenderAt = Date.now()
          renderKnownHandOverlay()
        }, 200)
      }
      return
    }
    if (handOverlayQueued) {
      return
    }
    handOverlayQueued = true
    scheduleRenderWork(() => {
      handOverlayQueued = false
      lastHandOverlayRenderAt = Date.now()
      renderKnownHandOverlay()
    })
  }

  function renderPanel(): void {
    mountVuePanel()
    options.syncReactiveState()
    queueKnownHandOverlayRender()
    options.queueRenderStateSnapshot()
  }

  function queueRender(): void {
    if (renderQueued) {
      return
    }
    renderQueued = true
    scheduleRenderWork(() => {
      renderQueued = false
      renderPanel()
    })
  }

  function ensureRoot(): HTMLElement {
    mountVuePanel()
    return ensureRootHost()
  }

  function bindPanelEvents(): void {
    options.bindTrackerActions()
  }

  return {
    mountVuePanel,
    renderPanel,
    queueRender,
    scheduleRenderWork,
    ensureRootHost,
    ensureRoot,
    bindPanelEvents,
    queueKnownHandOverlayRender
  }
}
