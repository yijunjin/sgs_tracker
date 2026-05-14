import { readonly, ref } from "vue"

export type GlobalMessageVariant = "success" | "error" | "info"

type GlobalMessageRecord = {
  id: number
  text: string
  variant: GlobalMessageVariant
}

const messages = ref<GlobalMessageRecord[]>([])
const dismissTimers = new Map<number, number>()
let nextMessageId = 1

function clearMessageTimer(id: number): void {
  const timer = dismissTimers.get(id)
  if (timer === undefined) {
    return
  }

  window.clearTimeout(timer)
  dismissTimers.delete(id)
}

export function dismissGlobalMessage(id: number): void {
  clearMessageTimer(id)
  messages.value = messages.value.filter((message) => message.id !== id)
}

export function showGlobalMessage(
  text: string,
  options?: {
    durationMs?: number
    variant?: GlobalMessageVariant
  }
): void {
  const id = nextMessageId
  nextMessageId += 1

  messages.value = [
    ...messages.value,
    {
      id,
      text,
      variant: options?.variant ?? "success"
    }
  ]

  const timer = window.setTimeout(() => {
    dismissGlobalMessage(id)
  }, options?.durationMs ?? 2600)
  dismissTimers.set(id, timer)
}

export function useGlobalMessage() {
  return {
    messages: readonly(messages),
    dismissGlobalMessage,
    showGlobalMessage
  }
}
