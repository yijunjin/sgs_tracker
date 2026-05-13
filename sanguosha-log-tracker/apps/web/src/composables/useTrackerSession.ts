import { computed, ref } from "vue"
import {
  acceptEvent,
  applyEvent,
  confirmReshuffle,
  createInitialTrackerState,
  defaultDeckProfile,
  deckProfiles,
  dismissReshuffleAlert,
  rejectEvent,
  setManualDeckRemaining,
  undoEvent,
  undoLastEvent,
  updateDeckRemainingState,
  type DeckProfile,
  type ParsedLogEvent,
  type TrackerState
} from "@slt/shared"

import { apiClient } from "../services/apiClient"

type ApiStatus = "checking" | "online" | "offline"
type RuntimeMode = "remote" | "local"

export function useTrackerSession() {
  const apiStatus = ref<ApiStatus>("checking")
  const runtimeMode = ref<RuntimeMode>("local")
  const sessionId = ref<string | null>(null)
  const deckProfile = ref<DeckProfile>(defaultDeckProfile)
  const trackerState = ref<TrackerState>(createInitialTrackerState(defaultDeckProfile))
  const statusMessage = ref("正在检查 API 状态...")

  function setLocalState(nextDeckProfile: DeckProfile): void {
    deckProfile.value = nextDeckProfile
    trackerState.value = createInitialTrackerState(nextDeckProfile)
  }

  async function init(): Promise<void> {
    apiStatus.value = "checking"
    statusMessage.value = "正在连接 API..."

    try {
      await apiClient.getHealth()
      apiStatus.value = "online"
      runtimeMode.value = "remote"
      deckProfile.value = await apiClient.getDemoDeckProfile()
      const session = await apiClient.createSession()
      sessionId.value = session.sessionId
      trackerState.value = session.state
      statusMessage.value = "已连接 Nest API，当前使用内存会话。"
    } catch {
      apiStatus.value = "offline"
      runtimeMode.value = "local"
      sessionId.value = null
      setLocalState(defaultDeckProfile)
      statusMessage.value = "API 不可用，已自动切换到前端本地演示模式。"
    }
  }

  async function syncEvent(event: ParsedLogEvent): Promise<void> {
    if (runtimeMode.value === "remote" && sessionId.value) {
      trackerState.value = await apiClient.applyEvent(sessionId.value, event)
      return
    }

    trackerState.value = applyEvent(trackerState.value, event)
  }

  async function ingestParsedEvents(events: ParsedLogEvent[]): Promise<void> {
    for (const event of events) {
      await syncEvent(event)
    }
  }

  async function updateEventStatus(eventId: string, status: ParsedLogEvent["status"]): Promise<void> {
    const current = trackerState.value.events.find((event) => event.id === eventId)
    if (!current) {
      return
    }

    const nextEvent = {
      ...current,
      status
    } satisfies ParsedLogEvent

    if (runtimeMode.value === "remote" && sessionId.value) {
      trackerState.value = await apiClient.applyEvent(sessionId.value, nextEvent)
      return
    }

    if (status === "accepted") {
      trackerState.value = acceptEvent(trackerState.value, eventId)
      return
    }

    if (status === "rejected") {
      trackerState.value = rejectEvent(trackerState.value, eventId)
      return
    }

    trackerState.value = applyEvent(trackerState.value, nextEvent)
  }

  async function acceptAllStrictEvents(): Promise<void> {
    const candidates = trackerState.value.events.filter(
      (event) =>
        event.status === "pending" &&
        event.quality === "strict" &&
        event.autoAcceptable &&
        Boolean(event.cardName) &&
        event.supportStatus !== "unsupported" &&
        event.action !== "ignore" &&
        event.action !== "unknown" &&
        !event.duplicate
    )

    for (const event of candidates) {
      await updateEventStatus(event.id, "accepted")
    }
  }

  async function undo(): Promise<void> {
    if (runtimeMode.value === "remote" && sessionId.value) {
      trackerState.value = await apiClient.undo(sessionId.value)
      return
    }

    trackerState.value = undoLastEvent(trackerState.value)
  }

  async function undoOne(eventId: string): Promise<void> {
    if (runtimeMode.value === "remote") {
      runtimeMode.value = "local"
      sessionId.value = null
    }

    trackerState.value = undoEvent(trackerState.value, eventId)
  }

  async function reset(): Promise<void> {
    if (runtimeMode.value === "remote" && sessionId.value) {
      trackerState.value = await apiClient.reset(sessionId.value)
      return
    }

    trackerState.value = createInitialTrackerState(deckProfile.value)
  }

  function updateDeckRemaining(stableRemaining: number | undefined, rawText?: string): void {
    trackerState.value = updateDeckRemainingState(trackerState.value, stableRemaining, rawText)
  }

  function confirmPendingReshuffle(): void {
    trackerState.value = confirmReshuffle(trackerState.value, trackerState.value.pendingReshuffleAlert?.id)
  }

  function dismissPendingReshuffle(): void {
    trackerState.value = dismissReshuffleAlert(trackerState.value)
  }

  function markManualReshuffle(): void {
    trackerState.value = confirmReshuffle(trackerState.value)
  }

  function correctDeckRemaining(value: number): void {
    trackerState.value = setManualDeckRemaining(trackerState.value, value)
  }

  function switchDeckProfile(profileId: string): void {
    const nextDeckProfile = deckProfiles.find((profile) => profile.id === profileId)
    if (!nextDeckProfile || nextDeckProfile.id === deckProfile.value.id) {
      return
    }

    const confirmed = window.confirm("切换牌库模式会重置当前局统计，是否继续？")
    if (!confirmed) {
      return
    }

    runtimeMode.value = "local"
    sessionId.value = null
    setLocalState(nextDeckProfile)
    statusMessage.value = `已切换到 ${nextDeckProfile.name}，当前局统计已重置。`
  }

  return {
    apiStatus,
    runtimeMode,
    sessionId,
    deckProfile,
    deckProfiles,
    trackerState,
    statusMessage,
    parsedEvents: computed(() => [...trackerState.value.events].reverse()),
    init,
    ingestParsedEvents,
    updateEventStatus,
    acceptAllHighConfidence: acceptAllStrictEvents,
    acceptAllStrictEvents,
    switchDeckProfile,
    updateDeckRemaining,
    confirmPendingReshuffle,
    dismissPendingReshuffle,
    markManualReshuffle,
    correctDeckRemaining,
    undo,
    undoOne,
    reset
  }
}
