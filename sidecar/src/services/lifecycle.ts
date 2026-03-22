/**
 * Lifecycle — auto-install CLI + skills on sidecar startup.
 *
 * On startup:
 * 1. Write sidecar port to ~/.miniclaw/sidecar.port (for CLI discovery)
 * 2. Install miniclaw-desk CLI to ~/.miniclaw/bin/
 * 3. Inject ~/.miniclaw/bin into user's shell PATH
 * 4. Install built-in skills to ~/.claude/skills/
 *
 * Modeled after Jarvis's installCli.ts — same patterns, adapted for
 * MiniClaw's Bun sidecar architecture (no Electron dependency).
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { logger } from '../utils/logger'

const DATA_DIR = process.env.MINICLAW_DATA_DIR || path.join(os.homedir(), '.miniclaw')
const BIN_DIR = path.join(DATA_DIR, 'bin')
const PORT_FILE = path.join(DATA_DIR, 'sidecar.port')
const CLI_PATH = path.join(BIN_DIR, 'miniclaw-desk')
const SKILLS_TARGET = path.join(os.homedir(), '.claude', 'skills')

const PATH_MARKER = '# Added by MiniClaw'
const PATH_EXPORT = `export PATH="$HOME/.miniclaw/bin:$PATH" ${PATH_MARKER}`

const BUILTIN_SKILLS = ['miniclaw-browser']

// ── Port file ──────────────────────────────────────────────────────────

export function writePortFile(port: number): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(PORT_FILE, String(port))
    logger.info('lifecycle', 'Port file written', { path: PORT_FILE, port })
  } catch (err) {
    logger.warn('lifecycle', 'Failed to write port file', { error: String(err) })
  }
}

export function removePortFile(): void {
  try {
    if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE)
  } catch {
    /* best effort */
  }
}

// ── CLI installation ───────────────────────────────────────────────────

/**
 * Install the miniclaw-desk CLI wrapper to ~/.miniclaw/bin/.
 * Source: resources/bin/miniclaw-desk (bundled with the app).
 */
export function installCli(): void {
  try {
    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true })

    const srcScript = findCliSource()
    if (!srcScript) {
      logger.warn('lifecycle', 'CLI source not found, skipping install')
      return
    }

    const srcContent = fs.readFileSync(srcScript, 'utf-8')

    // Check if already up-to-date
    if (fs.existsSync(CLI_PATH)) {
      const existing = fs.readFileSync(CLI_PATH, 'utf-8')
      if (existing === srcContent) return // Already current
    }

    fs.writeFileSync(CLI_PATH, srcContent, { mode: 0o755 })
    logger.info('lifecycle', 'CLI installed', { path: CLI_PATH })
  } catch (err) {
    logger.warn('lifecycle', 'Failed to install CLI', { error: String(err) })
  }
}

function findCliSource(): string | null {
  // Dev mode: resources/bin/miniclaw-desk relative to project root
  const candidates = [
    // Relative to sidecar/src/services/ → project root
    path.resolve(__dirname, '../../../resources/bin/miniclaw-desk'),
    // Relative to sidecar/ → project root
    path.resolve(process.cwd(), 'resources/bin/miniclaw-desk'),
    path.resolve(process.cwd(), '../resources/bin/miniclaw-desk'),
    // import.meta.url based
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../../../resources/bin/miniclaw-desk',
    ),
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// ── PATH injection ─────────────────────────────────────────────────────

export function ensurePathInjection(): void {
  if (process.platform === 'win32') return // Skip on Windows for now

  try {
    const home = os.homedir()
    const shell = process.env.SHELL || '/bin/zsh'

    const profiles = [
      path.join(home, '.zshrc'),
      path.join(home, '.bashrc'),
      path.join(home, '.bash_profile'),
      path.join(home, '.profile'),
    ]

    // Check if already injected
    for (const p of profiles) {
      if (profileHasPath(p)) return
    }

    // Determine target profile
    const target = shell.endsWith('/zsh')
      ? path.join(home, '.zshrc')
      : shell.endsWith('/bash')
        ? process.platform === 'darwin'
          ? path.join(home, '.bash_profile')
          : path.join(home, '.bashrc')
        : path.join(home, '.profile')

    const content = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : ''
    const sep = content.length > 0 && !content.endsWith('\n') ? '\n\n' : '\n'
    fs.appendFileSync(target, `${sep}${PATH_EXPORT}\n`)
    logger.info('lifecycle', 'PATH injected', { profile: target })
  } catch (err) {
    logger.warn('lifecycle', 'Failed to inject PATH', { error: String(err) })
  }
}

function profileHasPath(profilePath: string): boolean {
  try {
    if (!fs.existsSync(profilePath)) return false
    const content = fs.readFileSync(profilePath, 'utf-8')
    return content.includes(PATH_MARKER) || content.includes('.miniclaw/bin')
  } catch {
    return false
  }
}

// ── Skill installation ─────────────────────────────────────────────────

/**
 * Install built-in skills to ~/.claude/skills/.
 * Skills are sourced from resources/skills/ in the project.
 */
export function installBuiltinSkills(): void {
  const srcDir = findSkillsSource()
  if (!srcDir) {
    logger.warn('lifecycle', 'Skills source directory not found, skipping install')
    return
  }

  if (!fs.existsSync(SKILLS_TARGET)) {
    fs.mkdirSync(SKILLS_TARGET, { recursive: true })
  }

  for (const name of BUILTIN_SKILLS) {
    try {
      const srcSkill = path.join(srcDir, name)
      const dstSkill = path.join(SKILLS_TARGET, name)
      const srcMd = path.join(srcSkill, 'SKILL.md')

      if (!fs.existsSync(srcMd)) {
        logger.warn('lifecycle', `Skill source not found: ${srcMd}`)
        continue
      }

      const srcContent = fs.readFileSync(srcMd, 'utf-8')

      // Check if already up-to-date
      const dstMd = path.join(dstSkill, 'SKILL.md')
      if (fs.existsSync(dstMd)) {
        const existing = fs.readFileSync(dstMd, 'utf-8')
        if (existing === srcContent) continue
      }

      // Copy entire skill directory
      copyDirSync(srcSkill, dstSkill)
      logger.info('lifecycle', `Installed skill: ${name}`, { dst: dstSkill })
    } catch (err) {
      logger.warn('lifecycle', `Failed to install skill ${name}`, { error: String(err) })
    }
  }
}

function findSkillsSource(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../../resources/skills'),
    path.resolve(process.cwd(), 'resources/skills'),
    path.resolve(process.cwd(), '../resources/skills'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../resources/skills'),
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function copyDirSync(src: string, dst: string): void {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(s, d)
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

// ── Combined startup ───────────────────────────────────────────────────

/**
 * Run all lifecycle tasks. Called once at sidecar startup.
 */
export function runLifecycle(port: number): void {
  writePortFile(port)
  installCli()
  ensurePathInjection()
  installBuiltinSkills()
  logger.info('lifecycle', 'Lifecycle tasks completed')
}
