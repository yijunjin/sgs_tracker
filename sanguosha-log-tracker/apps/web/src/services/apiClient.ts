import type { DeckProfile, ParsedLogEvent, TrackerState } from "@slt/shared"

const API_BASE_URL = "http://localhost:3000"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export const apiClient = {
  getHealth() {
    return request<{ ok: true; service: string }>("/health")
  },
  getDemoDeckProfile() {
    return request<DeckProfile>("/deck-profiles/demo")
  },
  createSession() {
    return request<{ sessionId: string; state: TrackerState }>("/sessions", {
      method: "POST"
    })
  },
  getSession(sessionId: string) {
    return request<TrackerState>(`/sessions/${sessionId}`)
  },
  applyEvent(sessionId: string, event: ParsedLogEvent) {
    return request<TrackerState>(`/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify(event)
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
