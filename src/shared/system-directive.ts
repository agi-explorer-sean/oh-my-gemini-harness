export const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-GEMINI"

export function createSystemDirective(type: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${type}]`
}

export function isSystemDirective(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_DIRECTIVE_PREFIX)
}

export function hasSystemReminder(text: string): boolean {
  return /<system-reminder>[\s\S]*?<\/system-reminder>/i.test(text)
}

export function removeSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim()
}

export const SystemDirectiveTypes = {
  TODO_CONTINUATION: "TODO CONTINUATION",
  RALPH_LOOP: "RALPH LOOP",
  BOULDER_CONTINUATION: "BOULDER CONTINUATION",
  DELEGATION_REQUIRED: "DELEGATION REQUIRED",
  SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
  COMPACTION_CONTEXT: "COMPACTION CONTEXT",
  CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
  PROMETHEUS_READ_ONLY: "PROMETHEUS READ-ONLY",
} as const

export type SystemDirectiveType = (typeof SystemDirectiveTypes)[keyof typeof SystemDirectiveTypes]
