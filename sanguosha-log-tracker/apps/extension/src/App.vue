<script setup lang="ts">
import { Download, Pause, Play, RotateCcw, Settings, X } from "lucide-vue-next"
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import CardGroup from "./components/CardGroup.vue"
import EnemyHand from "./components/EnemyHand.vue"
import RuleConfigView from "./components/RuleConfigView.vue"
import { trackerActions, trackerStore, type SupportedGameModeId } from "./trackerStore"

// App.vue 是插件面板的纯展示层：
// - 所有业务计算都已经在 content.ts -> trackerStore.snapshot 里完成；
// - 这里只读取 snapshot/ui，并把用户操作转发到 trackerActions。
const deckListRef = ref<HTMLElement | null>(null)
const eventLogRef = ref<HTMLElement | null>(null)
const snapshot = computed(() => trackerStore.snapshot)
const ui = trackerStore.ui

let removeResizeListeners: (() => void) | undefined

// 新事件追加时，如果用户原本就在日志底部，则自动跟随滚动；
// 如果用户正在回看旧日志，则不强行打断他的阅读位置。
watch(
  () => [trackerStore.revision, ui.logCollapsed],
  async () => {
    const log = eventLogRef.value
    const wasAtBottom = log ? log.scrollTop + log.clientHeight >= log.scrollHeight - 8 : true
    await nextTick()
    if (wasAtBottom && eventLogRef.value) {
      eventLogRef.value.scrollTop = eventLogRef.value.scrollHeight
    }
  },
  { flush: "pre" }
)

function setMode(mode: SupportedGameModeId): void {
  trackerActions.setMode(mode)
}

function toggleRuleConfig(): void {
  if (ui.ruleConfigOpen) {
    trackerActions.closeRuleConfig()
    return
  }
  trackerActions.openRuleConfig()
}

// 右侧面板宽度拖拽。面板固定在屏幕右侧，所以鼠标往左拖时宽度增加：
// startWidth + startX - currentX。
function startResize(event: MouseEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = ui.panelWidth
  const onMove = (moveEvent: MouseEvent) => {
    trackerActions.setPanelWidth(startWidth + startX - moveEvent.clientX)
  }
  const onUp = () => {
    window.removeEventListener("mousemove", onMove)
    window.removeEventListener("mouseup", onUp)
    removeResizeListeners = undefined
    trackerActions.setPanelWidth(ui.panelWidth, true)
  }
  removeResizeListeners = onUp
  window.addEventListener("mousemove", onMove)
  window.addEventListener("mouseup", onUp)
}

onBeforeUnmount(() => {
  removeResizeListeners?.()
})
</script>

<template>
  <div
    class="sgs-card-tracker-root"
    :style="{ '--sgs-panel-width': `${ui.panelWidth}px` }"
    @wheel.stop
    @dragstart.prevent
    @selectstart.prevent
  >
    <button
      v-if="ui.collapsed"
      class="sgs-tracker-tab"
      type="button"
      title="展开三国杀记牌器"
      @click="trackerActions.expand"
    >
      <span>杀</span>
      <b>{{ snapshot.isDeckActive ? snapshot.drawPileRemainingLabel : "待命" }}</b>
    </button>

    <aside
      v-else
      class="sgs-tracker-panel"
      :class="{ 'is-wide': ui.panelWidth >= 520, 'is-log-collapsed': ui.logCollapsed }"
      aria-label="三国杀记牌器"
    >
      <div class="sgs-resize-handle" title="拖拽调整宽度" @mousedown="startResize"></div>
      <header class="sgs-tracker-header">
        <div class="sgs-title-lockup">
          <div class="sgs-logo-mark">杀</div>
          <div>
            <h2>三国杀记牌器</h2>
            <p>
              <span class="sgs-status-dot" :class="snapshot.connectionClass"></span>
              {{ snapshot.connectionLabel }} ·
              {{ snapshot.gameModeLabel }} ·
              {{ snapshot.isDeckActive ? snapshot.deckProfileSource : snapshot.gameModeSource }} ·
              {{ snapshot.versionLabel }}
            </p>
          </div>
        </div>
        <div class="sgs-count" :title="snapshot.countTitle">
          <span v-if="snapshot.countWaiting" class="sgs-count-waiting">{{ snapshot.countText }}</span>
          <template v-else>
            {{ snapshot.countText }}<small>/{{ snapshot.countTotal }}</small>
          </template>
        </div>
      </header>

      <div class="sgs-toolbar" role="toolbar" aria-label="记牌器操作">
        <button type="button" :title="snapshot.status.listening ? '暂停监听' : '继续监听'" @click="trackerActions.toggleListen">
          <Pause v-if="snapshot.status.listening" class="sgs-icon" aria-hidden="true" />
          <Play v-else class="sgs-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="sgs-mode-button"
          :class="{ 'is-active': snapshot.gameModeId === 'sgs-happy-2v2' }"
          title="手动锁定欢乐 2v2"
          @click="setMode('sgs-happy-2v2')"
        >
          2v2
        </button>
        <button
          type="button"
          class="sgs-mode-button"
          :class="{ 'is-active': snapshot.gameModeId === 'sgs-1v1' }"
          title="手动锁定 1v1"
          @click="setMode('sgs-1v1')"
        >
          1v1
        </button>
        <button type="button" title="重置本局" @click="trackerActions.reset">
          <RotateCcw class="sgs-icon" aria-hidden="true" />
        </button>
        <button type="button" title="复制本局 JSON" @click="trackerActions.exportJson">
          <Download class="sgs-icon" aria-hidden="true" />
        </button>
        <button type="button" :class="{ 'is-active': ui.ruleConfigOpen }" title="规则配置" @click="toggleRuleConfig">
          <Settings class="sgs-icon" aria-hidden="true" />
        </button>
        <button type="button" title="收起" @click="trackerActions.collapse">
          <X class="sgs-icon" aria-hidden="true" />
        </button>
      </div>

      <div ref="deckListRef" class="sgs-deck-list">
        <RuleConfigView
          v-if="ui.ruleConfigOpen"
          :system-rules="trackerStore.state.ruleConfig.systemRules"
          :custom-rules="trackerStore.state.ruleConfig.customRules"
          :error="trackerStore.state.ruleConfig.lastError"
          @save-rule="trackerActions.saveCustomRule"
          @toggle-rule="trackerActions.toggleCustomRule"
          @remove-rule="trackerActions.removeCustomRule"
        />
        <template v-else-if="snapshot.isDeckActive">
          <CardGroup
            v-for="group in snapshot.groups"
            :key="group.type"
            :group="group"
            @toggle="trackerActions.toggleGroup"
          />
          <EnemyHand :hands="snapshot.enemyHands" />
        </template>
        <div v-else class="sgs-waiting-view">
          <div class="sgs-waiting-status">{{ snapshot.waitingTitle }}</div>
          <div class="sgs-waiting-detail">{{ snapshot.waitingDetail }}</div>
          <div class="sgs-mode-row">
            <button
              type="button"
              :class="{ 'is-active': snapshot.gameModeId === 'sgs-happy-2v2' }"
              @click="setMode('sgs-happy-2v2')"
            >
              2v2
            </button>
            <button
              type="button"
              :class="{ 'is-active': snapshot.gameModeId === 'sgs-1v1' }"
              @click="setMode('sgs-1v1')"
            >
              1v1
            </button>
          </div>
        </div>
      </div>

      <footer class="sgs-tracker-footer">
        <div v-if="snapshot.deckOrderPreview.visible" class="sgs-guanxing" :title="snapshot.deckOrderPreview.title">
          <span class="sgs-gx-head">{{ snapshot.deckOrderPreview.heading }}</span>
          <span v-if="snapshot.deckOrderPreview.topCount > 0" class="sgs-gx-top" :title="snapshot.deckOrderPreview.topTitle">
            顶 {{ snapshot.deckOrderPreview.topCount }} 张待摸
          </span>
          <span v-if="snapshot.deckOrderPreview.bottomCount > 0" class="sgs-gx-bottom" :title="snapshot.deckOrderPreview.bottomTitle">
            底 {{ snapshot.deckOrderPreview.bottomCount }} 张垫底
          </span>
        </div>
        <div class="sgs-footer-stats">
          <template v-if="snapshot.isDeckActive">
            <span>{{ snapshot.baselineText }}</span>
            <span>牌堆 {{ snapshot.drawPileRemainingLabel }}</span>
            <span>未见 {{ snapshot.cycleRemainingTotal }}</span>
            <span>已见 {{ snapshot.cycleSeenTotal }}</span>
            <span>洗牌 {{ snapshot.status.reshuffleCount }}</span>
            <span>结束 {{ snapshot.status.gameOverCount }}</span>
          </template>
          <template v-else>
            <span>{{ snapshot.phaseLabel }}</span>
            <span>支持 2v2 / 1v1</span>
            <span>{{ snapshot.gameModeSource }}</span>
          </template>
          <button type="button" :title="ui.logCollapsed ? '展开日志' : '折叠日志'" @click="trackerActions.toggleLog">
            {{ ui.logCollapsed ? "日志展开" : "日志折叠" }}
          </button>
        </div>
        <div v-if="!ui.logCollapsed" ref="eventLogRef" class="sgs-event-log">
          <div v-if="!snapshot.events.length" class="sgs-empty">等待对局内公开事件</div>
          <div v-for="item in snapshot.events" :key="item.id" class="sgs-event-row" :class="`is-${item.type}`">
            <time>{{ item.time }}</time>
            <span>{{ item.text }}</span>
          </div>
        </div>
      </footer>
    </aside>
  </div>
</template>
