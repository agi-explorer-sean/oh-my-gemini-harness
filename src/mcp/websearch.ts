import type { WebsearchConfig } from "../config/schema"

export function getWebsearchConfig(config?: WebsearchConfig) {
  const provider = config?.provider ?? "exa"

  if (provider === "tavily") {
    return {
      type: "remote" as const,
      url: "https://mcp.tavily.com/mcp",
      enabled: true,
      headers: process.env.TAVILY_API_KEY
        ? { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }
        : undefined,
      oauth: false as const,
    }
  }

  if (provider === "serper") {
    return {
      type: "remote" as const,
      url: "https://mcp.serper.dev/mcp",
      enabled: true,
      headers: process.env.SERPER_API_KEY
        ? { "X-API-KEY": process.env.SERPER_API_KEY }
        : undefined,
      oauth: false as const,
    }
  }

  // Default to Exa
  return {
    type: "remote" as const,
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
    enabled: true,
    headers: process.env.EXA_API_KEY
      ? { "x-api-key": process.env.EXA_API_KEY }
      : undefined,
    // Disable OAuth auto-detection - Exa uses API key header, not OAuth
    oauth: false as const,
  }
}
