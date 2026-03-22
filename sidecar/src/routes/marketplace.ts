/**
 * Skills Marketplace routes — proxy skills.sh search API,
 * install/remove via `npx skills` CLI, and fetch SKILL.md from GitHub.
 */

import { Hono } from 'hono'
import { readLockFile } from '../utils/skills-lock'
import { logger } from '../utils/logger'
import type { MarketplaceSkill } from '../../../shared/types'

const marketplace = new Hono()

// ==========================================
// GET /marketplace/search — Search skills.sh
// ==========================================

marketplace.get('/search', async (c) => {
  try {
    const q = c.req.query('q') || ''
    const limit = c.req.query('limit') || '20'

    // skills.sh requires query >= 2 chars; fallback for empty/short queries
    const query = q.length >= 2 ? q : 'claude'

    const url = new URL('https://skills.sh/api/search')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', limit)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    let res: Response
    try {
      res = await fetch(url.toString(), { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }

    if (!res.ok) {
      return c.json({ error: `Skills.sh API returned ${res.status}` }, 502)
    }

    const data = await res.json()
    const results: unknown[] = Array.isArray(data) ? data : data.results || data.skills || []

    // Read lock file to mark installed skills
    const lock = readLockFile()
    const installed = new Set(Object.values(lock.skills).map((e) => e.source))

    const skills: MarketplaceSkill[] = results.map((item: unknown) => {
      const r = item as Record<string, unknown>
      const source = String(r.source || r.slug || r.name || '')
      const entry = Object.values(lock.skills).find((e) => e.source === source)
      return {
        id: String(r.id || r.slug || r.name || ''),
        skillId: String(r.skillId || r.name || r.slug || ''),
        name: String(r.name || r.slug || ''),
        installs: Number(r.installs || r.downloads || 0),
        source,
        isInstalled: installed.has(source),
        installedAt: entry?.installedAt,
      }
    })

    return c.json({ skills })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return c.json({ error: 'Skills.sh API request timed out' }, 504)
    }
    logger.error('marketplace', 'Search failed', { error: String(err) })
    return c.json({ error: err instanceof Error ? err.message : 'Search failed' }, 502)
  }
})

// ==========================================
// POST /marketplace/install — Install a skill via CLI (SSE stream)
// ==========================================

marketplace.post('/install', async (c) => {
  try {
    const body = await c.req.json()
    const { source, global: isGlobal } = body as { source: string; global?: boolean }

    if (!source || typeof source !== 'string') {
      return c.json({ error: 'source is required' }, 400)
    }

    const args = ['skills', 'add', source, '-y', '--agent', 'claude-code']
    if (isGlobal !== false) args.splice(3, 0, '-g')

    logger.info('marketplace', 'Installing skill', { source, args })

    const proc = Bun.spawn(['npx', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env } as Record<string, string>,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: string) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        // Read stdout
        const readStream = async (readable: ReadableStream<Uint8Array>, label: string) => {
          const reader = readable.getReader()
          const decoder = new TextDecoder()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              send('output', decoder.decode(value, { stream: true }))
            }
          } catch (err) {
            logger.warn('marketplace', `${label} read error`, { error: String(err) })
          }
        }

        await Promise.all([
          readStream(proc.stdout as ReadableStream<Uint8Array>, 'stdout'),
          readStream(proc.stderr as ReadableStream<Uint8Array>, 'stderr'),
        ])

        const code = await proc.exited
        if (code === 0) {
          send('done', 'Install completed successfully')
        } else {
          send('error', `Process exited with code ${code}`)
        }
        controller.close()
      },
      cancel() {
        proc.kill()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    logger.error('marketplace', 'Install failed', { error: String(err) })
    return c.json({ error: err instanceof Error ? err.message : 'Install failed' }, 500)
  }
})

// ==========================================
// POST /marketplace/remove — Uninstall a skill via CLI (SSE stream)
// ==========================================

marketplace.post('/remove', async (c) => {
  try {
    const body = await c.req.json()
    const { skill, global: isGlobal } = body as { skill: string; global?: boolean }

    if (!skill || typeof skill !== 'string') {
      return c.json({ error: 'skill name is required' }, 400)
    }

    const args = ['skills', 'remove', skill, '-y', '--agent', 'claude-code']
    if (isGlobal !== false) args.splice(3, 0, '-g')

    logger.info('marketplace', 'Removing skill', { skill, args })

    const proc = Bun.spawn(['npx', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env } as Record<string, string>,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: string) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        const readStream = async (readable: ReadableStream<Uint8Array>) => {
          const reader = readable.getReader()
          const decoder = new TextDecoder()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              send('output', decoder.decode(value, { stream: true }))
            }
          } catch {
            // ignore
          }
        }

        await Promise.all([
          readStream(proc.stdout as ReadableStream<Uint8Array>),
          readStream(proc.stderr as ReadableStream<Uint8Array>),
        ])

        const code = await proc.exited
        if (code === 0) {
          send('done', 'Uninstall completed successfully')
        } else {
          send('error', `Process exited with code ${code}`)
        }
        controller.close()
      },
      cancel() {
        proc.kill()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    logger.error('marketplace', 'Remove failed', { error: String(err) })
    return c.json({ error: err instanceof Error ? err.message : 'Remove failed' }, 500)
  }
})

// ==========================================
// GET /marketplace/readme — Fetch SKILL.md from GitHub
// ==========================================

// In-memory cache: repo source → Map<skillId, path>
const treeCache = new Map<string, { paths: Map<string, string>; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function findSkillPath(
  source: string,
  skillId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const cached = treeCache.get(source)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.paths.get(skillId) ?? null
  }

  const url = `https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  })

  if (!res.ok) return null

  const data = await res.json()
  const tree: Array<{ path: string; type: string }> = data.tree || []

  // Index all SKILL.md files by their parent directory name (= skillId)
  const paths = new Map<string, string>()
  for (const item of tree) {
    if (item.type !== 'blob') continue
    if (!item.path.endsWith('/SKILL.md')) continue
    const parts = item.path.split('/')
    const folder = parts[parts.length - 2]
    if (folder) {
      // Prefer shorter paths (closer to root)
      if (!paths.has(folder) || item.path.length < (paths.get(folder)?.length ?? Infinity)) {
        paths.set(folder, item.path)
      }
    }
  }

  treeCache.set(source, { paths, ts: Date.now() })
  return paths.get(skillId) ?? null
}

marketplace.get('/readme', async (c) => {
  try {
    const source = c.req.query('source') || ''
    const skillId = c.req.query('skillId') || ''

    if (!source || !skillId) {
      return c.json({ error: 'source and skillId are required' }, 400)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const path = await findSkillPath(source, skillId, controller.signal)
      if (!path) return c.json({ content: null })

      const raw = `https://raw.githubusercontent.com/${source}/HEAD/${path}`
      const res = await fetch(raw, { signal: controller.signal })
      if (!res.ok) return c.json({ content: null })

      const content = await res.text()
      return c.json({ content })
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return c.json({ content: null })
  }
})

export default marketplace
