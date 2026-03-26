export interface InstallArgs {
  tui: boolean
  skipAuth?: boolean
}

export interface InstallConfig {
  hasGemini: boolean
  hasGeminiZen?: boolean
  isMax20?: boolean
  hasVertexAI?: boolean
}

export interface ConfigMergeResult {
  success: boolean
  configPath: string
  error?: string
}

export interface DetectedConfig {
  isInstalled: boolean
  hasGemini: boolean
  hasVertexAI?: boolean
}
