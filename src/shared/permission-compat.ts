export type PermissionValue = "ask" | "allow" | "deny"

export interface PermissionFormat {
  permission: Record<string, PermissionValue>
}

export function createAgentToolRestrictions(
  denyTools: string[]
): PermissionFormat {
  return {
    permission: Object.fromEntries(
      denyTools.map((tool) => [tool, "deny" as const])
    ),
  }
}

export function createAgentToolAllowlist(
  allowTools: string[]
): PermissionFormat {
  return {
    permission: {
      "*": "deny" as const,
      ...Object.fromEntries(
        allowTools.map((tool) => [tool, "allow" as const])
      ),
    },
  }
}

export function migrateToolsToPermission(
  tools: Record<string, boolean>
): Record<string, PermissionValue> {
  return Object.fromEntries(
    Object.entries(tools).map(([key, value]) => [
      key,
      value ? ("allow" as const) : ("deny" as const),
    ])
  )
}

export function migrateAgentConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...config }

  if (result.tools && typeof result.tools === "object") {
    const existingPermission =
      (result.permission as Record<string, PermissionValue>) || {}
    const migratedPermission = migrateToolsToPermission(
      result.tools as Record<string, boolean>
    )
    result.permission = { ...migratedPermission, ...existingPermission }
    delete result.tools
  }

  return result
}
