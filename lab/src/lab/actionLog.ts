import { ref } from 'vue'

export interface ActionLogEntry {
  id: number
  at: number
  action: string
  path: string
  /** What the action saw (`ctx.data`) and what it wrote (`updateData` patch). */
  saw: unknown
  wrote?: Record<string, unknown>
  note?: string
}

const MAX = 50
let nextId = 0

export const actionLog = ref<ActionLogEntry[]>([])

export function logAction(entry: Omit<ActionLogEntry, 'id' | 'at'>): void {
  actionLog.value = [{ id: nextId++, at: Date.now(), ...entry }, ...actionLog.value].slice(0, MAX)
}

export function clearActionLog(): void {
  actionLog.value = []
}
