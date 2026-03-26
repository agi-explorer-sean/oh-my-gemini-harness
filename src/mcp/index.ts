import { getWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import type { McpName } from "./types"
import type { WebsearchConfig } from "../config/schema"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createBuiltinMcps(
  disabledMcps: string[] = [],
  websearchConfig?: WebsearchConfig
) {
  const mcps: Record<string, RemoteMcpConfig> = {}

  const builtinMcps: Record<McpName, RemoteMcpConfig> = {
    websearch: getWebsearchConfig(websearchConfig) as RemoteMcpConfig,
    context7: context7 as RemoteMcpConfig,
    grep_app: grep_app as RemoteMcpConfig,
  }

  for (const [name, config] of Object.entries(builtinMcps)) {
    if (!disabledMcps.includes(name)) {
      mcps[name] = config as RemoteMcpConfig
    }
  }

  return mcps
}
