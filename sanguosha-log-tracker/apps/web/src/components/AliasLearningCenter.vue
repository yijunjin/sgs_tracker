<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { cardNames, setRuntimeOcrAliases, type OcrAliasCandidate, type OcrAliasEntry } from "@slt/shared"

import { apiClient } from "../services/apiClient"

const sessions = ref<Awaited<ReturnType<typeof apiClient.listSessions>>>([])
const candidates = ref<OcrAliasCandidate[]>([])
const aliases = ref<OcrAliasEntry[]>([])
const selectedCandidateId = ref("")
const newAlias = ref("")
const newCanonical = ref(cardNames[0] ?? "")
const message = ref("")

const selectedCandidate = computed(() => candidates.value.find((candidate) => candidate.id === selectedCandidateId.value))
const userAliases = computed(() => aliases.value.filter((alias) => alias.source !== "builtIn"))

function formatTime(value?: number): string {
  return value ? new Date(value).toLocaleString() : "-"
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
  <section class="glass-panel rounded-3xl p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="section-title">别名学习中心</h2>
        <p class="mt-1 text-sm muted">对局结束后从公开 OCR 日志和用户修正中挖掘候选别名，默认需要人工确认。</p>
      </div>
      <button class="action-button secondary-button" type="button" @click="refresh">刷新</button>
    </div>

    <p v-if="message" class="mt-3 text-xs text-amber-200">{{ message }}</p>

    <div class="mt-5 space-y-6">
      <div>
        <h3 class="text-sm font-bold text-slate-100">最近对局报告</h3>
        <div class="mt-3 overflow-x-auto">
          <table class="min-w-full text-left text-xs text-slate-300">
            <thead class="text-slate-500">
              <tr>
                <th class="py-2 pr-3">sessionId</th>
                <th class="py-2 pr-3">牌库</th>
                <th class="py-2 pr-3">开始</th>
                <th class="py-2 pr-3">结束</th>
                <th class="py-2 pr-3">OCR</th>
                <th class="py-2 pr-3">ambiguous</th>
                <th class="py-2 pr-3">unknown</th>
                <th class="py-2 pr-3">修正</th>
                <th class="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in sessions" :key="session.sessionId" class="border-t border-slate-800">
                <td class="max-w-[180px] truncate py-2 pr-3">{{ session.sessionId }}</td>
                <td class="py-2 pr-3">{{ session.deckProfileId }}</td>
                <td class="py-2 pr-3">{{ formatTime(session.startedAt) }}</td>
                <td class="py-2 pr-3">{{ formatTime(session.endedAt) }}</td>
                <td class="py-2 pr-3">{{ session.summary.rawLineCount }}</td>
                <td class="py-2 pr-3">{{ session.summary.ambiguousCount }}</td>
                <td class="py-2 pr-3">{{ session.summary.unknownCount }}</td>
                <td class="py-2 pr-3">{{ session.summary.correctionCount }}</td>
                <td class="flex flex-wrap gap-2 py-2 pr-3">
                  <a class="action-button secondary-button" :href="apiClient.exportTextUrl(session.sessionId)">TXT</a>
                  <a class="action-button secondary-button" :href="apiClient.exportJsonUrl(session.sessionId)">JSON</a>
                  <button class="action-button secondary-button" type="button" @click="analyzeSession(session.sessionId)">重新分析</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-bold text-slate-100">候选别名</h3>
        <div class="mt-3 max-h-72 overflow-auto">
          <table class="min-w-full text-left text-xs text-slate-300">
            <thead class="text-slate-500">
              <tr>
                <th class="py-2 pr-3">候选</th>
                <th class="py-2 pr-3">建议牌名</th>
                <th class="py-2 pr-3">次数</th>
                <th class="py-2 pr-3">置信度</th>
                <th class="py-2 pr-3">来源</th>
                <th class="py-2 pr-3">状态</th>
                <th class="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="candidate in candidates"
                :key="candidate.id"
                class="cursor-pointer border-t border-slate-800"
                @click="selectedCandidateId = candidate.id"
              >
                <td class="py-2 pr-3 font-semibold text-amber-200">{{ candidate.alias }}</td>
                <td class="py-2 pr-3">{{ candidate.suggestedCanonical }}</td>
                <td class="py-2 pr-3">{{ candidate.count }}</td>
                <td class="py-2 pr-3">{{ candidate.confidence.toFixed(2) }}</td>
                <td class="py-2 pr-3">{{ candidate.sources.join(", ") }}</td>
                <td class="py-2 pr-3">{{ candidate.status }}</td>
                <td class="flex gap-2 py-2 pr-3">
                  <button class="action-button secondary-button" type="button" :disabled="candidate.status !== 'pending'" @click.stop="acceptCandidate(candidate.id)">接受</button>
                  <button class="action-button danger-button" type="button" :disabled="candidate.status !== 'pending'" @click.stop="rejectCandidate(candidate.id)">拒绝</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-bold text-slate-100">上下文预览</h3>
        <div class="mt-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-300">
          <template v-if="selectedCandidate">
            <p class="font-semibold text-slate-100">{{ selectedCandidate.alias }} -> {{ selectedCandidate.suggestedCanonical }}</p>
            <div v-for="example in selectedCandidate.examples" :key="`${example.sessionId}-${example.eventId}-${example.rawText}`" class="mt-3 border-t border-slate-800 pt-3">
              <p>session: {{ example.sessionId }}</p>
              <p>raw: {{ example.rawText }}</p>
              <p>normalized: {{ example.normalizedText || "-" }}</p>
              <p>eventId: {{ example.eventId || "-" }}</p>
            </div>
          </template>
          <p v-else class="muted">暂无候选上下文。</p>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-bold text-slate-100">当前别名字典</h3>
        <div class="mt-3 flex flex-wrap gap-2">
          <input v-model="newAlias" class="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="alias" />
          <select v-model="newCanonical" class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
            <option v-for="name in cardNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <button class="action-button secondary-button" type="button" @click="addAlias">新增</button>
        </div>
        <div class="mt-3 max-h-72 overflow-auto">
          <table class="min-w-full text-left text-xs text-slate-300">
            <tbody>
              <tr v-for="alias in userAliases" :key="alias.id" class="border-t border-slate-800">
                <td class="py-2 pr-3">{{ alias.alias }}</td>
                <td class="py-2 pr-3">{{ alias.canonical }}</td>
                <td class="py-2 pr-3">{{ alias.source }}</td>
                <td class="py-2 pr-3">{{ alias.enabled ? "启用" : "禁用" }}</td>
                <td class="py-2 pr-3">{{ alias.hitCount }}</td>
                <td class="py-2 pr-3">{{ alias.note || "-" }}</td>
                <td class="flex gap-2 py-2 pr-3">
                  <button class="action-button secondary-button" type="button" @click="toggleAlias(alias)">{{ alias.enabled ? "禁用" : "启用" }}</button>
                  <button class="action-button danger-button" type="button" @click="deleteAlias(alias.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>
