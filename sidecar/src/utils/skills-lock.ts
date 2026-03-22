/**
 * Read the skills lock file (~/.agents/.skill-lock.json) managed by the
 * `npx skills` CLI. Used to determine which marketplace skills are installed.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { SkillLockFile } from '../../../shared/types'

const LOCK_PATH = path.join(os.homedir(), '.agents', '.skill-lock.json')

export function readLockFile(): SkillLockFile {
  try {
    if (!fs.existsSync(LOCK_PATH)) return { version: 0, skills: {} }
    const raw = fs.readFileSync(LOCK_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return { version: parsed.version ?? 0, skills: parsed.skills ?? {} }
  } catch {
    return { version: 0, skills: {} }
  }
}
