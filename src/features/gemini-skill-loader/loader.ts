import { promises as fs } from "fs"
import { join, basename } from "path"
import yaml from "js-yaml"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { resolveSymlinkAsync, isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import { getGeminiConfigDir } from "../../shared/gemini-config-dir"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { SkillScope, SkillMetadata, LoadedSkill, LazyContentLoader } from "./types"
import type { SkillMcpConfig } from "../skill-mcp-manager/types"

function parseSkillMcpConfigFromFrontmatter(content: string): SkillMcpConfig | undefined {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch) return undefined

  try {
    const parsed = yaml.load(frontmatterMatch[1]) as Record<string, unknown>
    if (parsed && typeof parsed === "object" && "mcp" in parsed && parsed.mcp) {
      return parsed.mcp as SkillMcpConfig
    }
  } catch {
    return undefined
  }
  return undefined
}

async function getMcpJsonFromDir(skillDir: string): Promise<SkillMcpConfig | undefined> {
  const mcpJsonPath = join(skillDir, "mcp.json")
  
  try {
    const content = await fs.readFile(mcpJsonPath, "utf-8")
    const parsed = JSON.parse(content) as Record<string, unknown>
    
    if (parsed && typeof parsed === "object" && "mcpServers" in parsed && parsed.mcpServers) {
      return parsed.mcpServers as SkillMcpConfig
    }
    
    if (parsed && typeof parsed === "object" && !("mcpServers" in parsed)) {
      const hasCommandField = Object.values(parsed).some(
        (v) => v && typeof v === "object" && "command" in (v as Record<string, unknown>)
      )
      if (hasCommandField) {
        return parsed as SkillMcpConfig
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function parseAllowedTools(allowedTools: string | string[] | undefined): string[] | undefined {
  if (!allowedTools) return undefined
  
  // Handle YAML array format: already parsed as string[]
  if (Array.isArray(allowedTools)) {
    return allowedTools.map(t => t.trim()).filter(Boolean)
  }
  
  // Handle space-separated string format: "Read Write Edit Bash"
  return allowedTools.split(/\s+/).filter(Boolean)
}

async function getSkillFromPath(
  skillPath: string,
  resolvedPath: string,
  defaultName: string,
  scope: SkillScope
): Promise<LoadedSkill | null> {
  try {
    const content = await fs.readFile(skillPath, "utf-8")
    const { data, body } = parseFrontmatter<SkillMetadata>(content)
    const frontmatterMcp = parseSkillMcpConfigFromFrontmatter(content)
    const mcpJsonMcp = await getMcpJsonFromDir(resolvedPath)
    const mcpConfig = mcpJsonMcp || frontmatterMcp

    const skillName = data.name || defaultName
    const originalDescription = data.description || ""
    const isGeminiSource = scope === "gemini" || scope === "gemini-project"
    const formattedDescription = `(${scope} - Skill) ${originalDescription}`

    const templateContent = `<skill-instruction>
Base directory for this skill: ${resolvedPath}/
File references (@path) in this skill are relative to this directory.

${body.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`

    const eagerLoader: LazyContentLoader = {
      loaded: true,
      content: templateContent,
      load: async () => templateContent,
    }

    const definition: CommandDefinition = {
      name: skillName,
      description: formattedDescription,
      template: templateContent,
      model: sanitizeModelField(data.model, isGeminiSource ? "gemini" : "claude-code"),
      agent: data.agent,
      subtask: data.subtask,
      argumentHint: data["argument-hint"],
    }

    return {
      name: skillName,
      path: skillPath,
      resolvedPath,
      definition,
      scope,
      license: data.license,
      compatibility: data.compatibility,
      metadata: data.metadata,
      allowedTools: parseAllowedTools(data["allowed-tools"]),
      mcpConfig,
      lazyContent: eagerLoader,
    }
  } catch {
    return null
  }
}

async function getSkillsFromDir(skillsDir: string, scope: SkillScope): Promise<LoadedSkill[]> {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])
  const skills: LoadedSkill[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    const entryPath = join(skillsDir, entry.name)

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const resolvedPath = await resolveSymlinkAsync(entryPath)
      const dirName = entry.name

      const skillMdPath = join(resolvedPath, "SKILL.md")
      try {
        await fs.access(skillMdPath)
        const skill = await getSkillFromPath(skillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      } catch {
      }

      const namedSkillMdPath = join(resolvedPath, `${dirName}.md`)
      try {
        await fs.access(namedSkillMdPath)
        const skill = await getSkillFromPath(namedSkillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      } catch {
      }

      continue
    }

    if (isMarkdownFile(entry)) {
      const skillName = basename(entry.name, ".md")
      const skill = await getSkillFromPath(entryPath, skillsDir, skillName, scope)
      if (skill) skills.push(skill)
    }
  }

  return skills
}

function skillsToRecord(skills: LoadedSkill[]): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const skill of skills) {
    const { name: _name, argumentHint: _argumentHint, ...geminiCompatible } = skill.definition
    result[skill.name] = geminiCompatible as CommandDefinition
  }
  return result
}

export async function getUserSkills(): Promise<Record<string, CommandDefinition>> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  const skills = await getSkillsFromDir(userSkillsDir, "user")
  return skillsToRecord(skills)
}

export async function getProjectSkills(): Promise<Record<string, CommandDefinition>> {
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")
  const skills = await getSkillsFromDir(projectSkillsDir, "project")
  return skillsToRecord(skills)
}

export async function getGeminiGlobalSkills(): Promise<Record<string, CommandDefinition>> {
  const configDir = getGeminiConfigDir({ binary: "gemini" })
  const geminiSkillsDir = join(configDir, "skills")
  const skills = await getSkillsFromDir(geminiSkillsDir, "gemini")
  return skillsToRecord(skills)
}

export async function getGeminiProjectSkills(): Promise<Record<string, CommandDefinition>> {
  const rootSkillsDir = join(process.cwd(), "skills")
  const geminiProjectDir = join(process.cwd(), ".gemini", "skills")
  
  const [rootSkills, geminiSkills] = await Promise.all([
    getSkillsFromDir(rootSkillsDir, "gemini-project"),
    getSkillsFromDir(geminiProjectDir, "gemini-project"),
  ])
  
  return skillsToRecord([...rootSkills, ...geminiSkills])
}

export interface DiscoverSkillsOptions {
  includeClaudeCodePaths?: boolean
}

export async function discoverAllSkills(): Promise<LoadedSkill[]> {
  const [geminiProjectSkills, projectSkills, geminiGlobalSkills, userSkills] = await Promise.all([
    discoverGeminiProjectSkills(),
    discoverProjectClaudeSkills(),
    discoverGeminiGlobalSkills(),
    discoverUserClaudeSkills(),
  ])

  return [...geminiProjectSkills, ...projectSkills, ...geminiGlobalSkills, ...userSkills]
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<LoadedSkill[]> {
  const { includeClaudeCodePaths = true } = options

  const [geminiProjectSkills, geminiGlobalSkills] = await Promise.all([
    discoverGeminiProjectSkills(),
    discoverGeminiGlobalSkills(),
  ])

  if (!includeClaudeCodePaths) {
    return [...geminiProjectSkills, ...geminiGlobalSkills]
  }

  const [projectSkills, userSkills] = await Promise.all([
    discoverProjectClaudeSkills(),
    discoverUserClaudeSkills(),
  ])

  return [...geminiProjectSkills, ...projectSkills, ...geminiGlobalSkills, ...userSkills]
}

export async function getSkillByName(name: string, options: DiscoverSkillsOptions = {}): Promise<LoadedSkill | undefined> {
  const skills = await discoverSkills(options)
  return skills.find(s => s.name === name)
}

export async function discoverUserClaudeSkills(): Promise<LoadedSkill[]> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  return getSkillsFromDir(userSkillsDir, "user")
}

export async function discoverProjectClaudeSkills(): Promise<LoadedSkill[]> {
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")
  return getSkillsFromDir(projectSkillsDir, "project")
}

export async function discoverGeminiGlobalSkills(): Promise<LoadedSkill[]> {
  const configDir = getGeminiConfigDir({ binary: "gemini" })
  const geminiSkillsDir = join(configDir, "skills")
  return getSkillsFromDir(geminiSkillsDir, "gemini")
}

export async function discoverGeminiProjectSkills(): Promise<LoadedSkill[]> {
  const rootSkillsDir = join(process.cwd(), "skills")
  const geminiProjectDir = join(process.cwd(), ".gemini", "skills")
  
  const [rootSkills, geminiSkills] = await Promise.all([
    getSkillsFromDir(rootSkillsDir, "gemini-project"),
    getSkillsFromDir(geminiProjectDir, "gemini-project"),
  ])
  
  return [...rootSkills, ...geminiSkills]
}
