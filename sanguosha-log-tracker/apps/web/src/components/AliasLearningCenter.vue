<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import {
  Ban,
  BookOpenCheck,
  Check,
  ClipboardList,
  Database,
  FileJson,
  FileText,
  GitCompareArrows,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-vue-next"
import { cardNames, setRuntimeOcrAliases, type OcrAliasCandidate, type OcrAliasEntry } from "@slt/shared"

import { apiClient } from "../services/apiClient"
import UiPagination from "./ui/UiPagination.vue"
import UiTag from "./ui/UiTag.vue"

const sessions = ref<Awaited<ReturnType<typeof apiClient.listSessions>>>([])
const candidates = ref<OcrAliasCandidate[]>([])
const aliases = ref<OcrAliasEntry[]>([])
const selectedCandidateId = ref("")
const newAlias = ref("")
const newCanonical = ref(cardNames[0] ?? "")
const message = ref("")
const reportPage = ref(1)
const candidatePage = ref(1)
const aliasPage = ref(1)
const pageSize = ref(10)

const selectedCandidate = computed(() => candidates.value.find((candidate) => candidate.id === selectedCandidateId.value))
const userAliases = computed(() => aliases.value.filter((alias) => alias.source !== "builtIn"))
const pagedSessions = computed(() => paginate(sessions.value, reportPage.value, pageSize.value))
const pagedCandidates = computed(() => paginate(candidates.value, candidatePage.value, pageSize.value))
const pagedUserAliases = computed(() => paginate(userAliases.value, aliasPage.value, pageSize.value))
const pendingCount = computed(() => candidates.value.filter((candidate) => candidate.status === "pending").length)
const acceptedCount = computed(() => candidates.value.filter((candidate) => candidate.status === "accepted").length)
const rejectedCount = computed(() => candidates.value.filter((candidate) => candidate.status === "rejected").length)
const activeAliasCount = computed(() => aliases.value.filter((alias) => alias.enabled).length)
const todayCandidateCount = computed(() => {
  const today = new Date().toDateString()
  return candidates.value.filter((candidate) => new Date(candidate.createdAt).toDateString() === today).length
})

function paginate<T>(items: T[], page: number, size: number): T[] {
  const start = (Math.max(1, page) - 1) * size
  return items.slice(start, start + size)
}

function formatTime(value?: number): string {
  return value ? new Date(value).toLocaleString() : "-"
}

function formatShortTime(value?: number): string {
  return value ? new Date(value).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"
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

async function refresh(): Promise<void> {
  try {
    const [nextSessions, nextCandidates, nextAliases] = await Promise.all([
      apiClient.listSessions(),
      apiClient.getAliasCandidates(),
      apiClient.getAliases()
    ])
    sessions.value = nextSessions
    candidates.value = nextCandidates
    aliases.value = nextAliases
    setRuntimeOcrAliases(nextAliases)
    if (!selectedCandidateId.value && nextCandidates[0]) {
      selectedCandidateId.value = nextCandidates[0].id
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "别名学习中心加载失败。"
  }
}

async function acceptCandidate(id: string): Promise<void> {
  await apiClient.acceptAliasCandidate(id)
  message.value = "候选别名已合入用户字典。"
  await refresh()
}

async function rejectCandidate(id: string): Promise<void> {
  await apiClient.rejectAliasCandidate(id)
  message.value = "候选别名已拒绝。"
  await refresh()
}

async function analyzeSession(sessionId: string): Promise<void> {
  const result = await apiClient.analyzeAliases(sessionId)
  message.value = `已重新分析，候选 ${result.candidateCount} 个。`
  await refresh()
}

async function addAlias(): Promise<void> {
  if (!newAlias.value.trim() || !newCanonical.value) {
    return
  }
  await apiClient.addAlias({
    alias: newAlias.value.trim(),
    canonical: newCanonical.value,
    enabled: true,
    note: "手动新增"
  })
  newAlias.value = ""
  message.value = "手动别名已新增。"
  await refresh()
}

async function toggleAlias(alias: OcrAliasEntry): Promise<void> {
  await apiClient.updateAlias(alias.id, { enabled: !alias.enabled })
  await refresh()
}

async function deleteAlias(id: string): Promise<void> {
  await apiClient.deleteAlias(id)
  await refresh()
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
          <p v-if="message" class="mt-1 text-xs text-amber-200">{{ message }}</p>
        </div>
        <div class="alias-summary-metrics">
          <div class="summary-metric"><span>对局数</span><strong>{{ sessions.length }}</strong></div>
          <div class="summary-metric"><span>生成候选</span><strong>{{ candidates.length }}</strong></div>
          <div class="summary-metric"><span>当前字典条目</span><strong>{{ aliases.length }}</strong></div>
          <div class="summary-metric"><span>今日新增</span><strong>{{ todayCandidateCount }}</strong></div>
          <div class="summary-metric"><span>生效中</span><strong>{{ activeAliasCount }}</strong></div>
          <div class="summary-metric"><span>待审核</span><strong class="gold-text">{{ pendingCount }}</strong></div>
        </div>
        <button class="action-button secondary-button ml-auto" type="button" @click="refresh">
          <RefreshCw class="button-icon" />
          刷新
        </button>
      </div>
    </section>

    <div class="grid gap-3 xl:grid-cols-[1fr_1fr]">
      <section class="glass-panel min-w-0 p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="section-title section-title-row"><ClipboardList class="section-title-icon" />最近对局报告</h2>
        </div>
        <div class="overflow-x-auto rounded-lg border border-slate-800/70">
          <table class="data-table">
            <thead>
              <tr>
                <th>sessionId</th>
                <th>牌库</th>
                <th>开始</th>
                <th>结束</th>
                <th>OCR 行数</th>
                <th>模糊事件</th>
                <th>修正数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in pagedSessions" :key="session.sessionId">
                <td class="max-w-[180px] truncate">{{ session.sessionId }}</td>
                <td>{{ session.deckProfileId }}</td>
                <td>{{ formatShortTime(session.startedAt) }}</td>
                <td>{{ formatShortTime(session.endedAt) }}</td>
                <td>{{ session.summary.rawLineCount }}</td>
                <td>{{ session.summary.ambiguousCount }}</td>
                <td>{{ session.summary.correctionCount }}</td>
                <td>
                  <div class="flex gap-2">
                    <a class="action-button secondary-button compact-action" :href="apiClient.exportTextUrl(session.sessionId)"><FileText class="button-icon" />TXT</a>
                    <a class="action-button secondary-button compact-action" :href="apiClient.exportJsonUrl(session.sessionId)"><FileJson class="button-icon" />JSON</a>
                    <button class="action-button secondary-button compact-action" type="button" @click="analyzeSession(session.sessionId)">
                      <RefreshCw class="button-icon" />
                      重新分析
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination
          class="mt-3"
          :page="reportPage"
          :page-size="pageSize"
          :total="sessions.length"
          @update:page="reportPage = $event"
          @update:page-size="pageSize = $event"
        />
      </section>

      <section class="glass-panel min-w-0 p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="section-title section-title-row"><GitCompareArrows class="section-title-icon" />候选别名</h2>
          <div class="flex gap-2">
            <UiTag variant="warning" :icon="Search">待审核 {{ pendingCount }}</UiTag>
            <UiTag variant="success" :icon="Check">已接受 {{ acceptedCount }}</UiTag>
            <UiTag variant="danger" :icon="X">已拒绝 {{ rejectedCount }}</UiTag>
          </div>
        </div>
        <div class="overflow-x-auto rounded-lg border border-slate-800/70">
          <table class="data-table">
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
              <tr
                v-for="candidate in pagedCandidates"
                :key="candidate.id"
                class="cursor-pointer"
                @click="selectedCandidateId = candidate.id"
              >
                <td class="font-semibold text-slate-100">{{ candidate.alias }}</td>
                <td>{{ candidate.suggestedCanonical }}</td>
                <td>{{ candidate.count }}</td>
                <td><span class="confidence-pill">{{ candidate.confidence.toFixed(2) }}</span></td>
                <td>{{ candidateSourcesLabel(candidate.sources) }}</td>
                <td><UiTag :variant="candidateStatusVariant(candidate.status)" dot>{{ candidateStatusLabel(candidate.status) }}</UiTag></td>
                <td>
                  <div class="flex gap-2">
                    <button class="action-button secondary-button compact-action" type="button" :disabled="candidate.status !== 'pending'" @click.stop="acceptCandidate(candidate.id)">
                      <Check class="button-icon" />
                      接受
                    </button>
                    <button class="action-button danger-button compact-action" type="button" :disabled="candidate.status !== 'pending'" @click.stop="rejectCandidate(candidate.id)">
                      <X class="button-icon" />
                      拒绝
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination
          class="mt-3"
          :page="candidatePage"
          :page-size="pageSize"
          :total="candidates.length"
          @update:page="candidatePage = $event"
          @update:page-size="pageSize = $event"
        />
      </section>
    </div>

    <div class="grid gap-3 xl:grid-cols-[0.9fr_1.9fr]">
      <section class="glass-panel min-w-0 p-4">
        <h2 class="section-title section-title-row"><Search class="section-title-icon" />上下文预览</h2>
        <div class="mt-3 rounded-lg border border-slate-800/70 bg-slate-950/45 p-4 text-sm text-slate-300">
          <template v-if="selectedCandidate">
            <p class="font-semibold text-slate-100">
              当前候选：<span class="gold-text">{{ selectedCandidate.alias }} -> {{ selectedCandidate.suggestedCanonical }}</span>
            </p>
            <div v-for="example in selectedCandidate.examples" :key="`${example.sessionId}-${example.eventId}-${example.rawText}`" class="mt-3 border-t border-slate-800 pt-3 leading-7">
              <p>原始 OCR：<span class="gold-text">{{ example.rawText }}</span></p>
              <p>归一化文本：{{ example.normalizedText || "-" }}</p>
              <p>来源对局：{{ example.sessionId }}</p>
            </div>
          </template>
          <p v-else class="muted">暂无候选上下文。</p>
        </div>
      </section>

      <section class="glass-panel min-w-0 p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 class="section-title section-title-row"><Database class="section-title-icon" />当前别名字典</h2>
          <div class="flex flex-1 flex-wrap justify-end gap-2">
            <input v-model="newAlias" class="input-shell min-w-48" placeholder="别名" />
            <select v-model="newCanonical" class="input-shell min-w-40">
              <option v-for="name in cardNames" :key="name" :value="name">{{ name }}</option>
            </select>
            <button class="action-button" type="button" @click="addAlias">
              <Plus class="button-icon" />
              添加别名
            </button>
          </div>
        </div>
        <div class="overflow-x-auto rounded-lg border border-slate-800/70">
          <table class="data-table">
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
              <tr v-for="alias in pagedUserAliases" :key="alias.id">
                <td>{{ alias.alias }}</td>
                <td>{{ alias.canonical }}</td>
                <td>{{ aliasSourceLabel(alias.source) }}</td>
                <td><UiTag :variant="alias.enabled ? 'success' : 'muted'" dot>{{ alias.enabled ? "是" : "否" }}</UiTag></td>
                <td>{{ alias.hitCount }}</td>
                <td>{{ alias.note || "-" }}</td>
                <td>
                  <div class="flex gap-2">
                    <button class="action-button secondary-button compact-action" type="button" @click="toggleAlias(alias)">
                      <component :is="alias.enabled ? Ban : Check" class="button-icon" />
                      {{ alias.enabled ? "禁用" : "启用" }}
                    </button>
                    <button class="action-button danger-button compact-action" type="button" @click="deleteAlias(alias.id)">
                      <Trash2 class="button-icon" />
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination
          class="mt-3"
          :page="aliasPage"
          :page-size="pageSize"
          :total="userAliases.length"
          @update:page="aliasPage = $event"
          @update:page-size="pageSize = $event"
        />
      </section>
    </div>
  </div>
</template>
