<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Ban, BookOpenCheck, Check, ClipboardList, Database, Eye, Plus, RefreshCw, Search, Trash2, X } from "lucide-vue-next"
import { cardNames, setRuntimeOcrAliases, type OcrAliasCandidate, type OcrAliasEntry, type OcrEvidenceImage } from "@slt/shared"

import { showGlobalMessage } from "../composables/useGlobalMessage"
import { apiClient } from "../services/apiClient"
import UiConfirmDialog from "./ui/UiConfirmDialog.vue"
import UiModal from "./ui/UiModal.vue"
import UiPagination from "./ui/UiPagination.vue"
import UiTag from "./ui/UiTag.vue"

type SessionListItem = Awaited<ReturnType<typeof apiClient.listSessions>>[number]
type AliasSourceFilter = OcrAliasEntry["source"] | null
type AliasActionOptions = {
  closeConfirmedModal?: boolean
}
type ConfirmDialogOptions = {
  title: string
  message: string
  description?: string
  confirmText?: string
  confirmVariant?: "primary" | "secondary" | "danger"
  onConfirm: () => Promise<void>
}

const minRealGameRawLines = 50
const minRealGameParsedEvents = 20

const sessions = ref<SessionListItem[]>([])
const candidates = ref<OcrAliasCandidate[]>([])
const aliases = ref<OcrAliasEntry[]>([])
const newAlias = ref("")
const newCanonical = ref(cardNames[0] ?? "")
const activeAliasSourceFilter = ref<AliasSourceFilter>(null)
const aliasSearchQuery = ref("")
const reportPage = ref(1)
const aliasPage = ref(1)
const pageSize = ref(10)
const addAliasModalOpen = ref(false)
const analysisModalOpen = ref(false)
const contextModalOpen = ref(false)
const confirmedAliasesModalOpen = ref(false)
const evidenceModalOpen = ref(false)
const analyzedSession = ref<SessionListItem | null>(null)
const analyzedCandidates = ref<OcrAliasCandidate[]>([])
const previewCandidateId = ref("")
const previewEvidenceImage = ref<OcrEvidenceImage | null>(null)
const confirmedSession = ref<SessionListItem | null>(null)
const confirmDialogOpen = ref(false)
const confirmDialogPending = ref(false)
const confirmDialogTitle = ref("")
const confirmDialogMessage = ref("")
const confirmDialogDescription = ref("")
const confirmDialogConfirmText = ref("确认")
const confirmDialogVariant = ref<"primary" | "secondary" | "danger">("danger")
let confirmDialogAction: (() => Promise<void>) | undefined

function aliasKey(alias: string, canonical: string): string {
  return `${alias}|${canonical}`
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN")
}

const sortedAliases = computed(() =>
  [...aliases.value].sort(
    (left, right) =>
      (right.createdAt ?? 0) - (left.createdAt ?? 0) ||
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
      left.alias.localeCompare(right.alias, "zh-CN")
  )
)
const userAliasMap = computed(
  () => new Map(aliases.value.filter((alias) => alias.source !== "builtIn").map((alias) => [aliasKey(alias.alias, alias.canonical), alias]))
)
const normalizedAliasSearchQuery = computed(() => normalizeSearchText(aliasSearchQuery.value))
const dictionaryAliases = computed(() => {
  const filteredBySource = activeAliasSourceFilter.value
    ? sortedAliases.value.filter((alias) => alias.source === activeAliasSourceFilter.value)
    : sortedAliases.value
  const query = normalizedAliasSearchQuery.value

  if (!query) {
    return filteredBySource
  }

  return filteredBySource.filter((alias) =>
    [alias.canonical, alias.alias, alias.note ?? ""].some((value) => normalizeSearchText(value).includes(query))
  )
})
const acceptedCandidates = computed(() =>
  candidates.value.filter(
    (candidate) =>
      candidate.status === "accepted" &&
      userAliasMap.value.has(aliasKey(candidate.alias, candidate.suggestedCanonical))
  )
)
const acceptedCandidatesBySession = computed(() => {
  const bySession = new Map<string, OcrAliasCandidate[]>()

  for (const candidate of acceptedCandidates.value) {
    for (const sessionId of candidate.sessionIds) {
      const sessionCandidates = bySession.get(sessionId)
      if (sessionCandidates) {
        sessionCandidates.push(candidate)
      } else {
        bySession.set(sessionId, [candidate])
      }
    }
  }

  return bySession
})
const reportSessions = computed(() =>
  sessions.value.filter(
    (session) =>
      session.status !== "active" &&
      (session.summary.rawLineCount >= minRealGameRawLines ||
        session.summary.parsedEventCount >= minRealGameParsedEvents ||
        session.summary.ambiguousCount > 0 ||
        session.summary.unknownCount > 0 ||
        session.summary.correctionCount > 0 ||
        confirmedAliasCount(session.sessionId) > 0)
  )
)
const pagedSessions = computed(() => paginate(reportSessions.value, reportPage.value, pageSize.value))
const pagedAliases = computed(() => paginate(dictionaryAliases.value, aliasPage.value, pageSize.value))
const previewCandidate = computed(() => analyzedCandidates.value.find((candidate) => candidate.id === previewCandidateId.value))
const confirmedSessionCandidates = computed(() => {
  if (!confirmedSession.value) {
    return []
  }

  return sortCandidates(acceptedCandidatesBySession.value.get(confirmedSession.value.sessionId) ?? [])
})
const confirmedSessionItems = computed(() =>
  confirmedSessionCandidates.value
    .map((candidate) => ({
      candidate,
      alias: userAliasMap.value.get(aliasKey(candidate.alias, candidate.suggestedCanonical))
    }))
    .filter((item): item is { candidate: OcrAliasCandidate; alias: OcrAliasEntry } => Boolean(item.alias))
)
const pendingCount = computed(() => candidates.value.filter((candidate) => candidate.status === "pending").length)
const acceptedCount = computed(() => candidates.value.filter((candidate) => candidate.status === "accepted").length)
const rejectedCount = computed(() => candidates.value.filter((candidate) => candidate.status === "rejected").length)
const activeAliasCount = computed(() => aliases.value.filter((alias) => alias.enabled).length)
const builtInAliasCount = computed(() => aliases.value.filter((alias) => alias.source === "builtIn").length)
const manualAliasCount = computed(() => aliases.value.filter((alias) => alias.source === "manual").length)
const minedAliasCount = computed(() => aliases.value.filter((alias) => alias.source === "mined").length)
const todayCandidateCount = computed(() => {
  const today = new Date().toDateString()
  return candidates.value.filter((candidate) => new Date(candidate.createdAt).toDateString() === today).length
})
const analysisModalDescription = computed(() => {
  if (!analyzedSession.value) {
    return "仅展示当前这次重新分析识别出的候选别名。"
  }
  return `${analyzedSession.value.sessionId} · ${formatShortTime(analyzedSession.value.endedAt ?? analyzedSession.value.startedAt)}`
})
const contextModalDescription = computed(() => {
  if (!previewCandidate.value) {
    return "点击候选别名后查看 OCR 上下文片段。"
  }
  return `命中 ${previewCandidate.value.count} 次，展示 ${previewCandidate.value.examples.length} 条上下文。`
})
const confirmedAliasesModalDescription = computed(() => {
  if (!confirmedSession.value) {
    return "展示该对局已经确认并写入字典的别名。"
  }

  return `${confirmedSession.value.sessionId} · 已确认 ${confirmedSessionCandidates.value.length} 个别名`
})

function paginate<T>(items: T[], page: number, size: number): T[] {
  const start = (Math.max(1, page) - 1) * size
  return items.slice(start, start + size)
}

function sortCandidates(items: OcrAliasCandidate[]): OcrAliasCandidate[] {
  return [...items].sort(
    (left, right) => right.count - left.count || right.confidence - left.confidence || right.createdAt - left.createdAt
  )
}

function formatShortTime(value?: number): string {
  return value
    ? new Date(value).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "-"
}

function candidateStatusVariant(status: OcrAliasCandidate["status"]): "warning" | "success" | "danger" {
  if (status === "accepted") {
    return "success"
  }
  if (status === "rejected") {
    return "danger"
  }
  return "warning"
}

function candidateStatusLabel(status: OcrAliasCandidate["status"]): string {
  const labels: Record<OcrAliasCandidate["status"], string> = {
    pending: "待审核",
    accepted: "已接受",
    rejected: "已拒绝"
  }
  return labels[status]
}

function aliasSourceLabel(source: OcrAliasEntry["source"]): string {
  const labels: Record<OcrAliasEntry["source"], string> = {
    builtIn: "内置",
    manual: "手动",
    mined: "学习生成"
  }
  return labels[source]
}

function aliasSourceVariant(source: OcrAliasEntry["source"]): "muted" | "warning" | "success" {
  if (source === "manual") {
    return "warning"
  }
  if (source === "mined") {
    return "success"
  }
  return "muted"
}

function candidateSourcesLabel(sources: OcrAliasCandidate["sources"]): string {
  const labels: Record<OcrAliasCandidate["sources"][number], string> = {
    unknownEvent: "未知事件",
    ambiguousEvent: "模糊事件",
    userCorrection: "用户修正",
    fuzzyMatch: "模糊匹配",
    overLimitEvent: "超限事件"
  }
  return sources.map((source) => labels[source]).join("、")
}

function toggleAliasSourceFilter(source: OcrAliasEntry["source"]): void {
  activeAliasSourceFilter.value = activeAliasSourceFilter.value === source ? null : source
  aliasPage.value = 1
}

function handleAliasSearchInput(event: Event): void {
  aliasSearchQuery.value = event.target instanceof HTMLInputElement ? event.target.value : ""
  aliasPage.value = 1
}

function clearAliasSearch(): void {
  aliasSearchQuery.value = ""
  aliasPage.value = 1
}

function sessionConfirmedCandidates(sessionId: string): OcrAliasCandidate[] {
  return acceptedCandidatesBySession.value.get(sessionId) ?? []
}

function confirmedAliasCount(sessionId: string): number {
  return sessionConfirmedCandidates(sessionId).length
}

function openConfirmedAliasesModal(session: SessionListItem): void {
  confirmedSession.value = session
  confirmedAliasesModalOpen.value = true
}

function handleConfirmedAliasesModalVisibility(nextValue: boolean): void {
  confirmedAliasesModalOpen.value = nextValue
  if (!nextValue) {
    confirmedSession.value = null
  }
}

function handleAddAliasModalVisibility(nextValue: boolean): void {
  addAliasModalOpen.value = nextValue
  if (!nextValue) {
    newAlias.value = ""
    newCanonical.value = cardNames[0] ?? ""
  }
}

function setErrorMessage(error: unknown, fallback: string): void {
  showGlobalMessage(error instanceof Error ? error.message : fallback, { variant: "error", durationMs: 3200 })
}

function canManageAlias(alias: OcrAliasEntry): boolean {
  return alias.source !== "builtIn"
}

function mergeAnalyzedExamples(
  items: OcrAliasCandidate["examples"],
  storedItems: OcrAliasCandidate["examples"]
): OcrAliasCandidate["examples"] {
  return items.map((item) => {
    if (item.evidenceImage) {
      return item
    }

    const stored = storedItems.find((candidateExample) => {
      if (item.eventId && candidateExample.eventId) {
        return item.sessionId === candidateExample.sessionId && item.eventId === candidateExample.eventId
      }

      return (
        item.sessionId === candidateExample.sessionId &&
        item.rawText === candidateExample.rawText &&
        item.normalizedText === candidateExample.normalizedText
      )
    })

    if (!stored?.evidenceImage) {
      return item
    }

    return {
      ...item,
      evidenceImage: stored.evidenceImage
    }
  })
}

function mergeAnalyzedCandidates(items: OcrAliasCandidate[]): OcrAliasCandidate[] {
  const storedById = new Map(candidates.value.map((candidate) => [candidate.id, candidate]))
  return sortCandidates(
    items.map((candidate) => {
      const stored = storedById.get(candidate.id)
      if (!stored) {
        return candidate
      }
      return {
        ...candidate,
        examples: mergeAnalyzedExamples(candidate.examples, stored.examples),
        status: stored.status,
        updatedAt: stored.updatedAt
      }
    })
  )
}

function updateAnalyzedCandidate(candidate: OcrAliasCandidate): void {
  analyzedCandidates.value = analyzedCandidates.value.map((item) => (item.id === candidate.id ? { ...item, ...candidate } : item))
}

function closeConfirmedAliasesModalIfNeeded(options?: AliasActionOptions): void {
  if (options?.closeConfirmedModal) {
    handleConfirmedAliasesModalVisibility(false)
  }
}

function openConfirmDialog(options: ConfirmDialogOptions): void {
  confirmDialogTitle.value = options.title
  confirmDialogMessage.value = options.message
  confirmDialogDescription.value = options.description ?? ""
  confirmDialogConfirmText.value = options.confirmText ?? "确认"
  confirmDialogVariant.value = options.confirmVariant ?? "danger"
  confirmDialogAction = options.onConfirm
  confirmDialogOpen.value = true
}

function closeConfirmDialog(): void {
  if (confirmDialogPending.value) {
    return
  }

  confirmDialogOpen.value = false
  confirmDialogTitle.value = ""
  confirmDialogMessage.value = ""
  confirmDialogDescription.value = ""
  confirmDialogConfirmText.value = "确认"
  confirmDialogVariant.value = "danger"
  confirmDialogAction = undefined
}

async function confirmPendingAction(): Promise<void> {
  if (!confirmDialogAction) {
    closeConfirmDialog()
    return
  }

  confirmDialogPending.value = true

  try {
    await confirmDialogAction()
    closeConfirmDialog()
  } finally {
    confirmDialogPending.value = false
  }
}

function handleAnalysisModalVisibility(nextValue: boolean): void {
  analysisModalOpen.value = nextValue
  if (!nextValue) {
    contextModalOpen.value = false
    previewCandidateId.value = ""
  }
}

function handleContextModalVisibility(nextValue: boolean): void {
  contextModalOpen.value = nextValue
  if (!nextValue) {
    previewCandidateId.value = ""
  }
}

function openContextModal(candidate: OcrAliasCandidate): void {
  previewCandidateId.value = candidate.id
  contextModalOpen.value = true
}

function openEvidenceModal(image: OcrEvidenceImage): void {
  previewEvidenceImage.value = image
  evidenceModalOpen.value = true
}

function handleEvidenceModalVisibility(nextValue: boolean): void {
  evidenceModalOpen.value = nextValue
  if (!nextValue) {
    previewEvidenceImage.value = null
  }
}

async function refresh(): Promise<void> {
  try {
    const [nextSessions, nextCandidates, nextAliases] = await Promise.all([
      apiClient.listSessions(),
      apiClient.getAliasCandidates(),
      apiClient.getAliases()
    ])
    sessions.value = nextSessions
    candidates.value = sortCandidates(nextCandidates)
    aliases.value = nextAliases
    setRuntimeOcrAliases(nextAliases)
  } catch (error) {
    setErrorMessage(error, "别名学习中心加载失败。")
  }
}

async function acceptCandidate(id: string): Promise<void> {
  try {
    const result = await apiClient.acceptAliasCandidate(id)
    updateAnalyzedCandidate(result.candidate)
    showGlobalMessage("候选别名已合入用户字典。")
    await refresh()
  } catch (error) {
    setErrorMessage(error, "接受候选别名失败。")
  }
}

async function rejectCandidate(id: string): Promise<void> {
  try {
    const result = await apiClient.rejectAliasCandidate(id)
    updateAnalyzedCandidate(result)
    showGlobalMessage("候选别名已拒绝。")
    await refresh()
  } catch (error) {
    setErrorMessage(error, "拒绝候选别名失败。")
  }
}

async function analyzeSession(session: SessionListItem): Promise<void> {
  try {
    const result = await apiClient.analyzeAliases(session.sessionId)
    analyzedSession.value = session
    analyzedCandidates.value = sortCandidates(result.candidates)
    analysisModalOpen.value = true

    await refresh()
    analyzedCandidates.value = mergeAnalyzedCandidates(result.candidates)
  } catch (error) {
    setErrorMessage(error, "重新分析失败。")
  }
}

async function addAlias(): Promise<void> {
  if (!newAlias.value.trim() || !newCanonical.value) {
    return
  }

  try {
    await apiClient.addAlias({
      alias: newAlias.value.trim(),
      canonical: newCanonical.value,
      enabled: true,
      note: "手动新增"
    })
    handleAddAliasModalVisibility(false)
    await refresh()
    showGlobalMessage("手动别名已新增。")
  } catch (error) {
    setErrorMessage(error, "新增别名失败。")
  }
}

async function toggleAlias(alias: OcrAliasEntry, options?: AliasActionOptions): Promise<void> {
  if (!canManageAlias(alias)) {
    return
  }

  try {
    await apiClient.updateAlias(alias.id, { enabled: !alias.enabled })
    await refresh()
    closeConfirmedAliasesModalIfNeeded(options)
    showGlobalMessage(alias.enabled ? "别名已禁用。" : "别名已启用。")
  } catch (error) {
    setErrorMessage(error, "更新别名字典失败。")
  }
}

function requestToggleAlias(alias: OcrAliasEntry, options?: AliasActionOptions): void {
  if (!alias.enabled) {
    void toggleAlias(alias, options)
    return
  }

  openConfirmDialog({
    title: "确认禁用别名",
    description: `${alias.alias} -> ${alias.canonical}`,
    message: "禁用后该别名将不再参与 OCR 归一化匹配，但不会从字典中删除。",
    confirmText: "确认禁用",
    onConfirm: () => toggleAlias(alias, options)
  })
}

async function deleteAlias(alias: OcrAliasEntry, options?: AliasActionOptions): Promise<void> {
  try {
    await apiClient.deleteAlias(alias.id)
    await refresh()
    closeConfirmedAliasesModalIfNeeded(options)
    showGlobalMessage("别名已删除。")
  } catch (error) {
    setErrorMessage(error, "删除别名失败。")
  }
}

function requestDeleteAlias(alias: OcrAliasEntry, options?: AliasActionOptions): void {
  openConfirmDialog({
    title: "确认删除别名",
    description: `${alias.alias} -> ${alias.canonical}`,
    message: "删除后该别名会从用户字典中移除，如需恢复需要重新添加或重新接受候选别名。",
    confirmText: "确认删除",
    onConfirm: () => deleteAlias(alias, options)
  })
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="space-y-3">
    <section class="glass-panel alias-summary-bar p-3">
      <div class="flex flex-wrap items-center gap-4">
        <div>
          <h2 class="section-title section-title-row"><BookOpenCheck class="section-title-icon" />学习结果概览</h2>
        </div>
        <div class="alias-summary-metrics">
          <div class="summary-metric"><span>对局数</span><strong>{{ reportSessions.length }}</strong></div>
          <div class="summary-metric"><span>生成候选</span><strong>{{ candidates.length }}</strong></div>
          <div class="summary-metric"><span>当前字典条目</span><strong>{{ aliases.length }}</strong></div>
          <div class="summary-metric"><span>今日新增</span><strong>{{ todayCandidateCount }}</strong></div>
          <div class="summary-metric"><span>生效中</span><strong>{{ activeAliasCount }}</strong></div>
          <div class="summary-metric"><span>待审核</span><strong class="gold-text">{{ pendingCount }}</strong></div>
        </div>
        <div class="ml-auto flex flex-wrap gap-2">
          <button class="action-button secondary-button" type="button" @click="handleAddAliasModalVisibility(true)">
            <Plus class="button-icon" />
            手动添加
          </button>
          <button class="action-button secondary-button" type="button" @click="refresh">
            <RefreshCw class="button-icon" />
            刷新
          </button>
        </div>
      </div>
    </section>

    <div class="grid gap-3 xl:grid-cols-[1.05fr_1fr]">
      <section class="glass-panel min-w-0 p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="section-title section-title-row"><ClipboardList class="section-title-icon" />最近对局报告</h2>
        </div>
        <div class="alias-table-scroll overflow-x-scroll rounded-lg border border-slate-800/70">
          <table class="data-table alias-wide-table alias-report-table">
            <colgroup>
              <col class="report-session-col" />
              <col class="report-deck-col" />
              <col class="report-time-col" />
              <col class="report-time-col" />
              <col class="report-number-col" />
              <col class="report-number-col" />
              <col class="report-number-col" />
              <col class="report-actions-col" />
            </colgroup>
            <thead>
              <tr>
                <th>sessionId</th>
                <th>牌库</th>
                <th>开始</th>
                <th>结束</th>
                <th>OCR 行数</th>
                <th>模糊事件</th>
                <th>已确认别名</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in pagedSessions" :key="session.sessionId">
                <td class="max-w-[180px] truncate" :title="session.sessionId">{{ session.sessionId }}</td>
                <td :title="session.deckProfileId">{{ session.deckProfileId }}</td>
                <td :title="formatShortTime(session.startedAt)">{{ formatShortTime(session.startedAt) }}</td>
                <td :title="formatShortTime(session.endedAt)">{{ formatShortTime(session.endedAt) }}</td>
                <td :title="String(session.summary.rawLineCount)">{{ session.summary.rawLineCount }}</td>
                <td :title="String(session.summary.ambiguousCount)">{{ session.summary.ambiguousCount }}</td>
                <td>
                  <button
                    :class="['session-count-button', { 'is-empty': confirmedAliasCount(session.sessionId) === 0 }]"
                    type="button"
                    :title="confirmedAliasCount(session.sessionId) === 0 ? '该对局暂无已确认别名' : `查看 ${confirmedAliasCount(session.sessionId)} 个已确认别名`"
                    @click="openConfirmedAliasesModal(session)"
                  >
                    {{ confirmedAliasCount(session.sessionId) }}
                  </button>
                </td>
                <td>
                  <button class="action-button secondary-button compact-action" type="button" @click="analyzeSession(session)">
                    <RefreshCw class="button-icon" />
                    重新分析
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination
          class="mt-3"
          :page="reportPage"
          :page-size="pageSize"
          :total="reportSessions.length"
          @update:page="reportPage = $event"
          @update:page-size="pageSize = $event"
        />
      </section>

      <section class="glass-panel min-w-0 p-4">
        <div class="alias-dictionary-header mb-3">
          <div>
            <h2 class="section-title section-title-row"><Database class="section-title-icon" />别名字典</h2>
          </div>
          <div class="alias-dictionary-controls">
            <label class="alias-search-field">
              <Search class="alias-search-icon" />
              <input
                :value="aliasSearchQuery"
                class="input-shell alias-search-input"
                placeholder="搜索标准牌名或别名"
                type="search"
                @input="handleAliasSearchInput"
              />
              <button
                v-if="aliasSearchQuery"
                class="alias-search-clear"
                type="button"
                title="清空搜索"
                @click="clearAliasSearch"
              >
                <X class="button-icon" />
              </button>
            </label>
            <UiTag
              variant="muted"
              interactive
              :active="activeAliasSourceFilter === 'builtIn'"
              @click="toggleAliasSourceFilter('builtIn')"
            >
              内置 {{ builtInAliasCount }}
            </UiTag>
            <UiTag
              variant="warning"
              interactive
              :active="activeAliasSourceFilter === 'manual'"
              @click="toggleAliasSourceFilter('manual')"
            >
              手动 {{ manualAliasCount }}
            </UiTag>
            <UiTag
              variant="success"
              interactive
              :active="activeAliasSourceFilter === 'mined'"
              @click="toggleAliasSourceFilter('mined')"
            >
              学习生成 {{ minedAliasCount }}
            </UiTag>
          </div>
        </div>

        <div class="alias-table-scroll overflow-x-scroll rounded-lg border border-slate-800/70">
          <table class="data-table alias-wide-table alias-dictionary-table">
            <colgroup>
              <col class="dictionary-alias-col" />
              <col class="dictionary-canonical-col" />
              <col class="dictionary-source-col" />
              <col class="dictionary-status-col" />
              <col class="dictionary-hit-col" />
              <col class="dictionary-note-col" />
              <col class="dictionary-actions-col" />
            </colgroup>
            <thead>
              <tr>
                <th>别名</th>
                <th>标准牌名</th>
                <th>来源</th>
                <th>状态</th>
                <th>命中次数</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="alias in pagedAliases" :key="alias.id">
                <td class="font-semibold text-slate-100" :title="alias.alias">{{ alias.alias }}</td>
                <td :title="alias.canonical">{{ alias.canonical }}</td>
                <td :title="aliasSourceLabel(alias.source)">
                  <UiTag :variant="aliasSourceVariant(alias.source)">{{ aliasSourceLabel(alias.source) }}</UiTag>
                </td>
                <td :title="alias.enabled ? '生效中' : '已停用'"><UiTag :variant="alias.enabled ? 'success' : 'muted'" dot>{{ alias.enabled ? "生效中" : "已停用" }}</UiTag></td>
                <td :title="String(alias.hitCount)">{{ alias.hitCount }}</td>
                <td :title="alias.note || '-'">{{ alias.note || "-" }}</td>
                <td>
                  <div v-if="canManageAlias(alias)" class="flex gap-2">
                    <button class="action-button secondary-button compact-action" type="button" @click="requestToggleAlias(alias)">
                      <component :is="alias.enabled ? Ban : Check" class="button-icon" />
                      {{ alias.enabled ? "禁用" : "启用" }}
                    </button>
                    <button class="action-button danger-button compact-action" type="button" @click="requestDeleteAlias(alias)">
                      <Trash2 class="button-icon" />
                      删除
                    </button>
                  </div>
                  <span v-else class="text-xs text-slate-500">内置项不可编辑</span>
                </td>
              </tr>
              <tr v-if="dictionaryAliases.length === 0">
                <td colspan="7">
                  <div class="empty-state">暂无匹配的别名。</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination
          class="mt-3"
          :page="aliasPage"
          :page-size="pageSize"
          :total="dictionaryAliases.length"
          @update:page="aliasPage = $event"
          @update:page-size="pageSize = $event"
        />
      </section>
    </div>

    <UiModal
      :model-value="addAliasModalOpen"
      title="手动添加别名"
      description="新增后会直接写入用户字典，并按最新时间排在前面。"
      width-class="max-w-xl"
      @update:model-value="handleAddAliasModalVisibility"
    >
      <div class="space-y-4">
        <label class="add-alias-field">
          <span>别名</span>
          <input v-model="newAlias" class="input-shell w-full" placeholder="输入待新增别名" />
        </label>
        <label class="add-alias-field">
          <span>标准牌名</span>
          <select v-model="newCanonical" class="input-shell w-full">
            <option v-for="name in cardNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
      </div>

      <template #footer>
        <button class="action-button secondary-button" type="button" @click="handleAddAliasModalVisibility(false)">
          取消
        </button>
        <button class="action-button" type="button" @click="addAlias">
          <Plus class="button-icon" />
          添加别名
        </button>
      </template>
    </UiModal>

    <UiModal
      :model-value="analysisModalOpen"
      title="本次分析候选别名"
      :description="analysisModalDescription"
      width-class="max-w-6xl"
      @update:model-value="handleAnalysisModalVisibility"
    >
      <div class="flex flex-wrap gap-2">
        <UiTag variant="warning">待审核 {{ analyzedCandidates.filter((candidate) => candidate.status === 'pending').length }}</UiTag>
        <UiTag variant="success">已接受 {{ analyzedCandidates.filter((candidate) => candidate.status === 'accepted').length }}</UiTag>
        <UiTag variant="danger">已拒绝 {{ analyzedCandidates.filter((candidate) => candidate.status === 'rejected').length }}</UiTag>
      </div>

      <div v-if="analyzedCandidates.length" class="alias-table-scroll mt-3 overflow-x-scroll rounded-lg border border-slate-800/70">
        <table class="data-table alias-wide-table alias-candidate-table">
          <colgroup>
            <col class="candidate-alias-col" />
            <col class="candidate-canonical-col" />
            <col class="candidate-count-col" />
            <col class="candidate-confidence-col" />
            <col class="candidate-source-col" />
            <col class="candidate-status-col" />
            <col class="candidate-actions-col" />
          </colgroup>
          <thead>
            <tr>
              <th>候选词</th>
              <th>建议牌名</th>
              <th>次数</th>
              <th>置信度</th>
              <th>来源</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="candidate in analyzedCandidates" :key="candidate.id">
              <td :title="candidate.alias">
                <button class="candidate-link" type="button" :title="candidate.alias" @click="openContextModal(candidate)">
                  {{ candidate.alias }}
                </button>
              </td>
              <td :title="candidate.suggestedCanonical">{{ candidate.suggestedCanonical }}</td>
              <td :title="String(candidate.count)">{{ candidate.count }}</td>
              <td :title="candidate.confidence.toFixed(2)"><span class="confidence-pill">{{ candidate.confidence.toFixed(2) }}</span></td>
              <td :title="candidateSourcesLabel(candidate.sources)">{{ candidateSourcesLabel(candidate.sources) }}</td>
              <td :title="candidateStatusLabel(candidate.status)"><UiTag :variant="candidateStatusVariant(candidate.status)" dot>{{ candidateStatusLabel(candidate.status) }}</UiTag></td>
              <td>
                <div class="flex gap-2">
                  <button class="action-button secondary-button compact-action" type="button" @click="openContextModal(candidate)">
                    <Eye class="button-icon" />
                    上下文
                  </button>
                  <button class="action-button secondary-button compact-action" type="button" :disabled="candidate.status !== 'pending'" @click="acceptCandidate(candidate.id)">
                    <Check class="button-icon" />
                    接受
                  </button>
                  <button class="action-button danger-button compact-action" type="button" :disabled="candidate.status !== 'pending'" @click="rejectCandidate(candidate.id)">
                    <X class="button-icon" />
                    拒绝
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state mt-3">
        本次分析没有识别出新的候选别名。
      </div>

      <template #footer>
        <button class="action-button secondary-button" type="button" @click="handleAnalysisModalVisibility(false)">
          关闭
        </button>
      </template>
    </UiModal>

    <UiModal
      :model-value="confirmedAliasesModalOpen"
      title="该对局已确认别名"
      :description="confirmedAliasesModalDescription"
      width-class="max-w-6xl"
      @update:model-value="handleConfirmedAliasesModalVisibility"
    >
      <div v-if="confirmedSessionItems.length" class="alias-table-scroll overflow-x-scroll rounded-lg border border-slate-800/70">
        <table class="data-table alias-wide-table alias-confirmed-table">
          <colgroup>
            <col class="confirmed-alias-col" />
            <col class="confirmed-canonical-col" />
            <col class="confirmed-source-col" />
            <col class="confirmed-confidence-col" />
            <col class="confirmed-hit-col" />
            <col class="confirmed-status-col" />
            <col class="confirmed-actions-col" />
          </colgroup>
          <thead>
            <tr>
              <th>别名</th>
              <th>标准牌名</th>
              <th>来源</th>
              <th>置信度</th>
              <th>命中次数</th>
              <th>字典状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in confirmedSessionItems" :key="item.candidate.id">
              <td :title="item.candidate.alias">{{ item.candidate.alias }}</td>
              <td :title="item.candidate.suggestedCanonical">{{ item.candidate.suggestedCanonical }}</td>
              <td :title="candidateSourcesLabel(item.candidate.sources)">{{ candidateSourcesLabel(item.candidate.sources) }}</td>
              <td :title="item.candidate.confidence.toFixed(2)"><span class="confidence-pill">{{ item.candidate.confidence.toFixed(2) }}</span></td>
              <td :title="String(item.candidate.count)">{{ item.candidate.count }}</td>
              <td :title="item.alias.enabled ? '生效中' : '已停用'">
                <UiTag :variant="item.alias.enabled ? 'success' : 'muted'" dot>{{ item.alias.enabled ? "生效中" : "已停用" }}</UiTag>
              </td>
              <td>
                <div class="flex gap-2">
                  <button class="action-button secondary-button compact-action" type="button" @click="requestToggleAlias(item.alias, { closeConfirmedModal: true })">
                    <component :is="item.alias.enabled ? Ban : Check" class="button-icon" />
                    {{ item.alias.enabled ? "禁用" : "启用" }}
                  </button>
                  <button class="action-button danger-button compact-action" type="button" @click="requestDeleteAlias(item.alias, { closeConfirmedModal: true })">
                    <Trash2 class="button-icon" />
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state">
        该对局目前还没有已确认并写入字典的别名。
      </div>

      <template #footer>
        <button class="action-button secondary-button" type="button" @click="handleConfirmedAliasesModalVisibility(false)">
          关闭
        </button>
      </template>
    </UiModal>

    <UiModal
      :model-value="contextModalOpen"
      :title="previewCandidate ? `${previewCandidate.alias} -> ${previewCandidate.suggestedCanonical}` : '候选上下文预览'"
      :description="contextModalDescription"
      width-class="max-w-3xl"
      @update:model-value="handleContextModalVisibility"
    >
      <div v-if="previewCandidate" class="space-y-3">
        <div class="flex flex-wrap gap-2">
          <UiTag variant="warning">{{ candidateSourcesLabel(previewCandidate.sources) }}</UiTag>
          <UiTag variant="success">置信度 {{ previewCandidate.confidence.toFixed(2) }}</UiTag>
          <UiTag :variant="candidateStatusVariant(previewCandidate.status)">{{ candidateStatusLabel(previewCandidate.status) }}</UiTag>
        </div>

        <article
          v-for="example in previewCandidate.examples"
          :key="`${example.sessionId}-${example.eventId ?? 'na'}-${example.rawText}`"
          class="candidate-example-card"
        >
          <figure v-if="example.evidenceImage" class="candidate-evidence">
            <button class="candidate-evidence-button" type="button" @click="openEvidenceModal(example.evidenceImage)">
            <img
              :src="example.evidenceImage.dataUrl"
              :width="example.evidenceImage.width"
              :height="example.evidenceImage.height"
              alt="当时的日志区域截图"
            />
            <figcaption>截图 {{ formatShortTime(example.evidenceImage.capturedAt) }}</figcaption>
            </button>
          </figure>
          <p><span class="candidate-example-label">原始 OCR</span>{{ example.rawText }}</p>
          <p><span class="candidate-example-label">归一化</span>{{ example.normalizedText || "-" }}</p>
          <p><span class="candidate-example-label">来源对局</span>{{ example.sessionId }}</p>
          <p><span class="candidate-example-label">事件 ID</span>{{ example.eventId || "-" }}</p>
        </article>
      </div>
      <div v-else class="empty-state">暂无候选上下文。</div>

      <template #footer>
        <button class="action-button secondary-button" type="button" @click="handleContextModalVisibility(false)">
          关闭
        </button>
      </template>
    </UiModal>

    <UiModal
      :model-value="evidenceModalOpen"
      title="截图预览"
      description="当时的日志区域截图"
      width-class="max-w-5xl"
      @update:model-value="handleEvidenceModalVisibility"
    >
      <div v-if="previewEvidenceImage" class="evidence-preview">
        <img
          :src="previewEvidenceImage.dataUrl"
          :width="previewEvidenceImage.width"
          :height="previewEvidenceImage.height"
          alt="放大的日志区域截图"
        />
      </div>
      <div v-else class="empty-state">暂无截图。</div>

      <template #footer>
        <button class="action-button secondary-button" type="button" @click="handleEvidenceModalVisibility(false)">
          关闭
        </button>
      </template>
    </UiModal>

    <UiConfirmDialog
      :model-value="confirmDialogOpen"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      :description="confirmDialogDescription"
      :confirm-text="confirmDialogConfirmText"
      :confirm-variant="confirmDialogVariant"
      :pending="confirmDialogPending"
      @update:model-value="closeConfirmDialog"
      @confirm="confirmPendingAction"
    />
  </div>
</template>

<style scoped>
.alias-table-scroll {
  scrollbar-color: rgba(148, 163, 184, 0.45) rgba(15, 23, 42, 0.72);
  scrollbar-width: thin;
}

.alias-wide-table {
  min-width: 100%;
  table-layout: fixed;
}

.alias-report-table {
  width: 74rem;
}

.alias-dictionary-table {
  width: 76rem;
}

.alias-candidate-table {
  width: 72rem;
}

.alias-confirmed-table {
  width: 66rem;
}

.alias-dictionary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 1rem;
}

.alias-dictionary-controls {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  gap: 0.5rem;
}

.alias-search-field {
  position: relative;
  display: flex;
  flex: 1 1 14rem;
  align-items: center;
  min-width: 10rem;
  max-width: 18rem;
}

.alias-search-icon {
  position: absolute;
  left: 0.65rem;
  width: 1rem;
  height: 1rem;
  color: #94a3b8;
  pointer-events: none;
}

.alias-search-input {
  width: 100%;
  min-height: 2rem;
  padding: 0.36rem 2rem 0.36rem 2rem;
  font-size: 0.84rem;
}

.alias-search-clear {
  position: absolute;
  right: 0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.45rem;
  height: 1.45rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
}

.alias-search-clear:hover {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.12);
}

.alias-dictionary-controls :deep(.ui-tag) {
  flex: 0 0 auto;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .alias-dictionary-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .alias-dictionary-controls {
    justify-content: flex-start;
    width: 100%;
    overflow-x: auto;
    padding-bottom: 0.15rem;
  }

  .alias-search-field {
    flex-basis: 12rem;
  }
}

.alias-wide-table th:last-child,
.alias-wide-table td:last-child {
  overflow: visible;
}

.report-session-col {
  width: 8.5rem;
}

.report-deck-col {
  width: 8.5rem;
}

.report-time-col {
  width: 7.4rem;
}

.report-number-col {
  width: 7.2rem;
}

.report-actions-col {
  width: 8.8rem;
}

.dictionary-alias-col,
.dictionary-canonical-col {
  width: 8rem;
}

.dictionary-source-col {
  width: 7rem;
}

.dictionary-status-col {
  width: 8rem;
}

.dictionary-hit-col {
  width: 5.5rem;
}

.dictionary-note-col {
  width: 11rem;
}

.dictionary-actions-col {
  width: 16rem;
}

.candidate-alias-col,
.candidate-canonical-col {
  width: 8.6rem;
}

.candidate-count-col {
  width: 5.5rem;
}

.candidate-confidence-col {
  width: 7rem;
}

.candidate-source-col {
  width: 10rem;
}

.candidate-status-col {
  width: 8rem;
}

.candidate-actions-col {
  width: 18.5rem;
}

.confirmed-alias-col,
.confirmed-canonical-col {
  width: 8rem;
}

.confirmed-source-col {
  width: 8rem;
}

.confirmed-confidence-col {
  width: 6rem;
}

.confirmed-hit-col {
  width: 6rem;
}

.confirmed-status-col {
  width: 8rem;
}

.confirmed-actions-col {
  width: 16rem;
}

.candidate-link {
  border: 0;
  background: transparent;
  color: #f4c76f;
  padding: 0;
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.candidate-link:hover {
  color: #ffe19e;
}

.session-count-button {
  min-width: 2.2rem;
  border: 0;
  background: transparent;
  color: #f4c76f;
  padding: 0;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.session-count-button:hover {
  color: #ffe19e;
}

.session-count-button.is-empty {
  color: #94a3b8;
}

.add-alias-field {
  display: grid;
  gap: 0.55rem;
}

.add-alias-field span {
  color: #cbd5e1;
  font-size: 0.88rem;
  font-weight: 700;
}

.candidate-example-card,
.empty-state {
  border: 1px solid rgba(51, 65, 85, 0.88);
  border-radius: 0.9rem;
  background: rgba(2, 6, 23, 0.44);
  padding: 1rem;
}

.candidate-example-card {
  color: #cbd5e1;
}

.candidate-evidence {
  margin: 0 0 0.85rem;
}

.candidate-evidence-button {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: zoom-in;
}

.candidate-evidence img,
.evidence-preview img {
  display: block;
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.65rem;
  background: #020617;
  object-fit: contain;
}

.candidate-evidence img {
  max-height: 14rem;
}

.candidate-evidence-button:hover img {
  border-color: rgba(244, 199, 111, 0.42);
}

.evidence-preview img {
  max-height: 72vh;
}

.candidate-evidence figcaption {
  margin-top: 0.35rem;
  color: #94a3b8;
  font-size: 0.75rem;
}

.candidate-example-card p {
  margin: 0;
  line-height: 1.75;
}

.candidate-example-card p + p {
  margin-top: 0.35rem;
}

.candidate-example-label {
  display: inline-block;
  min-width: 4.75rem;
  color: #94a3b8;
}

.empty-state {
  color: #94a3b8;
  text-align: center;
}
</style>
