import type {
  DeckProfile,
  OcrAliasCandidate,
  OcrAliasEntry,
  OcrLine,
  OcrLogRecord,
  ParsedLogEvent,
  SessionReport,
  TruncatedCardCompletionRule,
  TrackerState,
  UserCorrectionRecord
} from "@slt/shared"

const DEFAULT_API_BASE_URL = "http://localhost:3000"
const API_BASE_STORAGE_KEY = "slt-api-base-url"

function envApiBaseUrl(): string | undefined {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL
}

function localStorageApiBaseUrl(): string | undefined {
  try {
    return window.localStorage.getItem(API_BASE_STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function rememberApiBaseUrl(baseUrl: string): void {
  try {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, baseUrl)
  } catch {
    // Ignore storage failures; probing still works for the current request.
  }
}

function candidateApiBaseUrls(): string[] {
  const configured = envApiBaseUrl()
  const cached = localStorageApiBaseUrl()
  return [
    configured,
    cached,
    DEFAULT_API_BASE_URL,
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://localhost:3005"
  ].filter((baseUrl, index, values): baseUrl is string => Boolean(baseUrl && values.indexOf(baseUrl) === index))
}

function activeApiBaseUrl(): string {
  return localStorageApiBaseUrl() ?? envApiBaseUrl() ?? DEFAULT_API_BASE_URL
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let lastError: unknown
  for (const baseUrl of candidateApiBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        },
        ...init
      })

      if (response.ok) {
        rememberApiBaseUrl(baseUrl)
        return response.json() as Promise<T>
      }

      lastError = new Error(`API request failed at ${baseUrl}: ${response.status} ${response.statusText}`)
      if (response.status !== 404 && response.status !== 501) {
        throw lastError
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error("API request failed")
}

async function requestOptional<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  let sawCapabilityMiss = false
  let lastError: unknown

  for (const baseUrl of candidateApiBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        },
        ...init
      })

      if (response.ok) {
        rememberApiBaseUrl(baseUrl)
        return response.json() as Promise<T>
      }

      if (response.status === 404 || response.status === 501) {
        sawCapabilityMiss = true
        continue
      }

      lastError = new Error(`API request failed at ${baseUrl}: ${response.status} ${response.statusText}`)
      throw lastError
    } catch (error) {
      lastError = error
    }
  }

  if (sawCapabilityMiss) {
    return fallback
  }

  throw lastError instanceof Error ? lastError : new Error("API request failed")
}

function downloadUrl(path: string): string {
  return `${activeApiBaseUrl()}${path}`
}

export const apiClient = {
  get baseUrl() {
    return activeApiBaseUrl()
  },
  getHealth() {
    return request<{ ok: true; service: string }>("/health")
  },
  getDemoDeckProfile() {
    return request<DeckProfile>("/deck-profiles/demo")
  },
  createSession(options?: { endActive?: boolean }) {
    return request<{ sessionId: string; state: TrackerState }>("/sessions", {
      method: "POST",
      body: JSON.stringify(options ?? {})
    })
  },
  getSession(sessionId: string) {
    return request<TrackerState>(`/sessions/${sessionId}`)
  },
  listSessions() {
    return request<
      Array<{
        sessionId: string
        status: string
        exportStatus: string
        startedAt: number
        endedAt?: number
        deckProfileId: string
        summary: {
          rawLineCount: number
          mergedLineCount: number
          parsedEventCount: number
          ambiguousCount: number
          unknownCount: number
          correctionCount: number
        }
        lastError?: string
      }>
    >("/sessions")
  },
  applyEvent(sessionId: string, event: ParsedLogEvent) {
    return request<TrackerState>(`/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify(event)
    })
  },
  recordOcrBatch(
    sessionId: string,
    body: {
      rawLines?: OcrLine[] | string[]
      mergedLines?: OcrLine[] | string[]
      source?: OcrLogRecord["source"]
      ocrEngine?: string
    }
  ) {
    return request<{ ok: true; rawLineCount: number; mergedLineCount: number }>(`/sessions/${sessionId}/ocr-batch`, {
      method: "POST",
      body: JSON.stringify(body)
    })
  },
  recordCorrection(
    sessionId: string,
    body: {
      eventId: string
      correctedCardName?: string
      reason?: UserCorrectionRecord["reason"]
    }
  ) {
    return request<TrackerState>(`/sessions/${sessionId}/corrections`, {
      method: "POST",
      body: JSON.stringify(body)
    })
  },
  endSession(sessionId: string) {
    return request<{ report: SessionReport; candidateCount: number; error?: string }>(`/sessions/${sessionId}/end`, {
      method: "POST"
    })
  },
  analyzeAliases(sessionId: string) {
    return request<{ candidateCount: number; candidates: OcrAliasCandidate[] }>(`/sessions/${sessionId}/analyze-aliases`, {
      method: "POST"
    })
  },
  exportTextUrl(sessionId: string) {
    return downloadUrl(`/sessions/${sessionId}/export/text`)
  },
  exportJsonUrl(sessionId: string) {
    return downloadUrl(`/sessions/${sessionId}/export/json`)
  },
  getAliases() {
    return request<OcrAliasEntry[]>("/ocr-aliases")
  },
  getAliasCandidates(status?: OcrAliasCandidate["status"]) {
    return request<OcrAliasCandidate[]>(`/ocr-alias-candidates${status ? `?status=${status}` : ""}`)
  },
  getTruncatedCardCompletions() {
    return requestOptional<TruncatedCardCompletionRule[]>("/truncated-card-completions", [])
  },
  acceptAliasCandidate(id: string) {
    return request<{ candidate: OcrAliasCandidate; alias: OcrAliasEntry }>(`/ocr-alias-candidates/${id}/accept`, {
      method: "POST"
    })
  },
  acceptTruncatedCardCompletionCandidate(id: string) {
    return request<{ candidate: OcrAliasCandidate; rule: TruncatedCardCompletionRule }>(
      `/ocr-alias-candidates/${id}/accept-truncated-completion`,
      {
        method: "POST"
      }
    )
  },
  rejectAliasCandidate(id: string) {
    return request<OcrAliasCandidate>(`/ocr-alias-candidates/${id}/reject`, {
      method: "POST"
    })
  },
  addAlias(body: Pick<OcrAliasEntry, "alias" | "canonical"> & Partial<OcrAliasEntry>) {
    return request<OcrAliasEntry>("/ocr-aliases", {
      method: "POST",
      body: JSON.stringify(body)
    })
  },
  updateAlias(id: string, body: Partial<OcrAliasEntry>) {
    return request<OcrAliasEntry>(`/ocr-aliases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    })
  },
  deleteAlias(id: string) {
    return request<{ ok: true }>(`/ocr-aliases/${id}`, {
      method: "DELETE"
    })
  },
  undo(sessionId: string) {
    return request<TrackerState>(`/sessions/${sessionId}/undo`, {
      method: "POST"
    })
  },
  reset(sessionId: string) {
    return request<TrackerState>(`/sessions/${sessionId}/reset`, {
      method: "POST"
    })
  }
}
