/**
 * Skills HTTP routes — list, create, edit, delete skills.
 *
 * Scans multiple skill directories matching CodePilot's approach:
 * - ~/.claude/commands/ — global slash commands
 * - cwd/.claude/commands/ — project slash commands
 * - cwd/.claude/skills/SKILL.md — project agent skills
 * - ~/.agents/skills/SKILL.md — installed agent skills
 * - ~/.claude/skills/SKILL.md — installed agent skills
 * - ~/.miniclaw/skills/ — legacy miniclaw skills
 */

import { Hono } from 'hono'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import type { SkillFile, SkillKind } from '../../../shared/types'

const skillsRoutes = new Hono()

// ==========================================
// YAML Front Matter Parser
// ==========================================

function parseSkillFrontMatter(content: string): { name?: string; description?: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/)
  if (!fmMatch) return {}

  const lines = fmMatch[1].split(/\r?\n/)
  const result: { name?: string; description?: string } = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const nameMatch = line.match(/^name:\s*(.+)/)
    if (nameMatch) {
      result.name = nameMatch[1].trim()
      continue
    }

    // Multi-line YAML block scalar: description: |
    if (/^description:\s*\|/.test(line)) {
      const descLines: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+/.test(lines[j])) {
          descLines.push(lines[j].trim())
        } else {
          break
        }
      }
      if (descLines.length > 0) {
        result.description = descLines.filter(Boolean).join(' ')
      }
      continue
    }

    const descMatch = line.match(/^description:\s+(.+)/)
    if (descMatch) {
      result.description = descMatch[1].trim()
    }
  }
  return result
}

function computeContentHash(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex')
}

// ==========================================
// Scanning Functions
// ==========================================

/** Scan a directory recursively for .md slash commands */
function scanDirectory(dir: string, source: 'global' | 'project', prefix = ''): SkillFile[] {
  const skills: SkillFile[] = []
  if (!fs.existsSync(dir)) return skills

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name
        skills.push(...scanDirectory(fullPath, source, subPrefix))
        continue
      }

      if (!entry.name.endsWith('.md')) continue
      const baseName = entry.name.replace(/\.md$/, '')
      const name = prefix ? `${prefix}:${baseName}` : baseName
      const content = fs.readFileSync(fullPath, 'utf-8')
      const firstLine = content.split('\n')[0]?.trim() || ''
      const description = firstLine.startsWith('#')
        ? firstLine.replace(/^#+\s*/, '')
        : firstLine || `Skill: /${name}`
      skills.push({ name, description, content, source, kind: 'slash_command', filePath: fullPath })
    }
  } catch {
    // ignore read errors
  }
  return skills
}

/** Scan project-level agent skills from .claude/skills/{name}/SKILL.md */
function scanProjectSkills(dir: string): SkillFile[] {
  const skills: SkillFile[] = []
  if (!fs.existsSync(dir)) return skills

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const meta = parseSkillFrontMatter(content)
      const name = meta.name || entry.name
      const description = meta.description || `Skill: /${name}`

      skills.push({
        name,
        description,
        content,
        source: 'project',
        kind: 'agent_skill',
        filePath: skillMdPath,
      })
    }
  } catch {
    // ignore
  }
  return skills
}

type InstalledSource = 'agents' | 'claude'
type InstalledSkill = SkillFile & { installedSource: InstalledSource; contentHash: string }

/** Scan installed agent skills from a directory (e.g. ~/.agents/skills/) */
function scanInstalledSkills(dir: string, installedSource: InstalledSource): InstalledSkill[] {
  const skills: InstalledSkill[] = []
  if (!fs.existsSync(dir)) return skills

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const meta = parseSkillFrontMatter(content)
      const name = meta.name || entry.name
      const description = meta.description || `Installed skill: /${name}`
      const contentHash = computeContentHash(content)

      skills.push({
        name,
        description,
        content,
        source: 'installed',
        kind: 'agent_skill',
        installedSource,
        contentHash,
        filePath: skillMdPath,
      })
    }
  } catch {
    // ignore
  }
  return skills
}

/** Deduplicate installed skills from agents/ and claude/ sources */
function resolveInstalledSkills(
  agentsSkills: InstalledSkill[],
  claudeSkills: InstalledSkill[],
  preferredSource: InstalledSource,
): SkillFile[] {
  const all = [...agentsSkills, ...claudeSkills]
  const byName = new Map<string, InstalledSkill[]>()
  for (const skill of all) {
    const existing = byName.get(skill.name)
    if (existing) {
      existing.push(skill)
    } else {
      byName.set(skill.name, [skill])
    }
  }

  const resolved: InstalledSkill[] = []
  for (const group of byName.values()) {
    if (group.length === 1) {
      resolved.push(group[0])
      continue
    }
    const uniqueHashes = new Set(group.map((s) => s.contentHash))
    if (uniqueHashes.size === 1) {
      const preferred = group.find((s) => s.installedSource === preferredSource) || group[0]
      resolved.push(preferred)
      continue
    }
    resolved.push(...group)
  }

  return resolved.map(({ contentHash: _h, ...rest }) => rest)
}

// ==========================================
// Directory Helpers
// ==========================================

function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), '.claude', 'commands')
}

function getProjectCommandsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), '.claude', 'commands')
}

function getProjectSkillsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), '.claude', 'skills')
}

function getAgentsSkillsDir(): string {
  return path.join(os.homedir(), '.agents', 'skills')
}

function getClaudeSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills')
}

function getLegacySkillsDir(): string {
  return path.join(os.homedir(), '.miniclaw', 'skills')
}

// ==========================================
// Routes
// ==========================================

/** GET /skills — List all available skills */
skillsRoutes.get('/', (c) => {
  const cwd = c.req.query('cwd') || undefined

  // 1. Global slash commands
  const globalSkills = scanDirectory(getGlobalCommandsDir(), 'global')

  // 2. Project slash commands
  const projectSkills = scanDirectory(getProjectCommandsDir(cwd), 'project')

  // 3. Project agent skills (.claude/skills/*/SKILL.md)
  const projectAgentSkills = scanProjectSkills(getProjectSkillsDir(cwd))

  // Deduplicate: project commands take priority over project skills
  const projectCommandNames = new Set(projectSkills.map((s) => s.name))
  const dedupedProjectSkills = projectAgentSkills.filter((s) => !projectCommandNames.has(s.name))

  // 4. Installed agent skills (~/.agents/skills/ + ~/.claude/skills/)
  const agentsSkills = scanInstalledSkills(getAgentsSkillsDir(), 'agents')
  const claudeSkills = scanInstalledSkills(getClaudeSkillsDir(), 'claude')
  const preferredSource: InstalledSource =
    agentsSkills.length >= claudeSkills.length ? 'agents' : 'claude'
  const installedSkills = resolveInstalledSkills(agentsSkills, claudeSkills, preferredSource)

  // 5. Legacy miniclaw skills (scan as global slash commands)
  const legacySkills = scanDirectory(getLegacySkillsDir(), 'global')

  const all: SkillFile[] = [
    ...globalSkills,
    ...projectSkills,
    ...dedupedProjectSkills,
    ...installedSkills,
    ...legacySkills,
  ]

  return c.json({ skills: all })
})

/** GET /skills/:name — Get skill content */
skillsRoutes.get('/:name', (c) => {
  const name = c.req.param('name')
  const cwd = c.req.query('cwd') || undefined
  const source = c.req.query('source') // 'agents' | 'claude' for installed skills

  // Build a combined list to find the skill
  const globalSkills = scanDirectory(getGlobalCommandsDir(), 'global')
  const projectSkills = scanDirectory(getProjectCommandsDir(cwd), 'project')
  const projectAgentSkills = scanProjectSkills(getProjectSkillsDir(cwd))
  const agentsSkills = scanInstalledSkills(getAgentsSkillsDir(), 'agents')
  const claudeSkills = scanInstalledSkills(getClaudeSkillsDir(), 'claude')
  const legacySkills = scanDirectory(getLegacySkillsDir(), 'global')

  const all = [
    ...globalSkills,
    ...projectSkills,
    ...projectAgentSkills,
    ...agentsSkills,
    ...claudeSkills,
    ...legacySkills,
  ]

  const skill = all.find((s) => {
    if (s.name !== name) return false
    // If source is specified, match installedSource for installed skills
    if (source && s.source === 'installed') {
      return (s as InstalledSkill).installedSource === source
    }
    return true
  })

  if (!skill) {
    return c.json({ error: 'Skill not found' }, 404)
  }

  // Re-read content for freshness
  const content = fs.readFileSync(skill.filePath, 'utf-8')
  return c.json({ ...skill, content })
})

/** POST /skills — Create a new slash command skill */
skillsRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const { name, content, scope, cwd } = body as {
    name: string
    content: string
    scope: 'global' | 'project'
    cwd?: string
  }

  if (!name || typeof name !== 'string') {
    return c.json({ error: 'Skill name is required' }, 400)
  }

  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-')
  if (!safeName) {
    return c.json({ error: 'Invalid skill name' }, 400)
  }

  const dir = scope === 'project' ? getProjectCommandsDir(cwd) : getGlobalCommandsDir()

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const filePath = path.join(dir, `${safeName}.md`)
  if (fs.existsSync(filePath)) {
    return c.json({ error: 'A skill with this name already exists' }, 409)
  }

  fs.writeFileSync(filePath, content || '', 'utf-8')

  const firstLine = (content || '').split('\n')[0]?.trim() || ''
  const description = firstLine.startsWith('#')
    ? firstLine.replace(/^#+\s*/, '')
    : firstLine || `Skill: /${safeName}`

  return c.json(
    {
      skill: {
        name: safeName,
        description,
        content: content || '',
        source: scope || 'global',
        kind: 'slash_command' as SkillKind,
        filePath,
      },
    },
    201,
  )
})

/** PATCH /skills/:name — Update skill content */
skillsRoutes.patch('/:name', async (c) => {
  const name = c.req.param('name')
  const body = await c.req.json()
  const { content, cwd, source } = body as { content: string; cwd?: string; source?: string }

  // Find the skill file
  const globalSkills = scanDirectory(getGlobalCommandsDir(), 'global')
  const projectSkills = scanDirectory(getProjectCommandsDir(cwd), 'project')
  const agentsSkills = scanInstalledSkills(getAgentsSkillsDir(), 'agents')
  const claudeSkills = scanInstalledSkills(getClaudeSkillsDir(), 'claude')
  const projectAgentSkills = scanProjectSkills(getProjectSkillsDir(cwd))
  const legacySkills = scanDirectory(getLegacySkillsDir(), 'global')

  const all = [
    ...globalSkills,
    ...projectSkills,
    ...projectAgentSkills,
    ...agentsSkills,
    ...claudeSkills,
    ...legacySkills,
  ]

  const skill = all.find((s) => {
    if (s.name !== name) return false
    if (source && s.source === 'installed') {
      return (s as InstalledSkill).installedSource === source
    }
    return true
  })

  if (!skill || !skill.filePath) {
    return c.json({ error: 'Skill not found' }, 404)
  }

  fs.writeFileSync(skill.filePath, content, 'utf-8')
  return c.json({ success: true, skill: { ...skill, content } })
})

/** DELETE /skills/:name — Delete a skill */
skillsRoutes.delete('/:name', async (c) => {
  const name = c.req.param('name')
  const cwd = c.req.query('cwd') || undefined
  const globalSkills = scanDirectory(getGlobalCommandsDir(), 'global')
  const projectSkills = scanDirectory(getProjectCommandsDir(cwd), 'project')
  const legacySkills = scanDirectory(getLegacySkillsDir(), 'global')

  const all = [...globalSkills, ...projectSkills, ...legacySkills]

  const skill = all.find((s) => s.name === name)

  if (!skill || !skill.filePath) {
    return c.json({ error: 'Skill not found' }, 404)
  }

  // Only allow deleting slash commands, not installed agent skills
  if (skill.kind === 'agent_skill') {
    return c.json({ error: 'Cannot delete agent skills via API' }, 403)
  }

  fs.unlinkSync(skill.filePath)
  return c.json({ success: true })
})

export default skillsRoutes
