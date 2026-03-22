/**
 * Git HTTP routes — status, log, branches, commit
 *
 * Uses Bun.spawnSync for git command execution (no child_process).
 */

import { Hono } from 'hono'

const gitRoutes = new Hono()

function git(args: string[], cwd: string): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  })
  if (!result.success) {
    const msg = result.stderr.toString().trim() || `exit code ${result.exitCode}`
    throw new Error(`Git command failed: ${msg}`)
  }
  return result.stdout.toString().trim()
}

/** GET /git/status?cwd=... */
gitRoutes.get('/status', (c) => {
  const cwd = c.req.query('cwd') || process.cwd()
  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    const statusOutput = git(['status', '--porcelain'], cwd)
    const files = statusOutput
      ? statusOutput.split('\n').map((line) => ({
          status: line.slice(0, 2).trim(),
          path: line.slice(3),
        }))
      : []
    return c.json({ branch, files, clean: files.length === 0 })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Not a git repo' }, 400)
  }
})

/** GET /git/log?cwd=...&limit=... */
gitRoutes.get('/log', (c) => {
  const cwd = c.req.query('cwd') || process.cwd()
  const limit = parseInt(c.req.query('limit') || '20', 10)
  try {
    const format = '%H|||%an|||%ae|||%aI|||%s'
    const output = git(['log', `--format=${format}`, `-${limit}`], cwd)
    const commits = output
      ? output.split('\n').map((line) => {
          const [hash, author, email, date, message] = line.split('|||')
          return { hash, author, email, date, message }
        })
      : []
    return c.json({ commits })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to read git log' }, 400)
  }
})

/** GET /git/branches?cwd=... */
gitRoutes.get('/branches', (c) => {
  const cwd = c.req.query('cwd') || process.cwd()
  try {
    const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    const output = git(['branch', '--list'], cwd)
    const branches = output
      ? output
          .split('\n')
          .map((b) => b.replace(/^\*?\s+/, '').trim())
          .filter(Boolean)
      : []
    return c.json({ current, branches })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list branches' }, 400)
  }
})

/** POST /git/commit — Stage and commit */
gitRoutes.post('/commit', async (c) => {
  const body = await c.req.json()
  const { cwd, message, files } = body as { cwd: string; message: string; files?: string[] }
  if (!cwd || !message) {
    return c.json({ error: 'cwd and message are required' }, 400)
  }
  try {
    if (files && files.length > 0) {
      for (const file of files) {
        git(['add', file], cwd)
      }
    } else {
      git(['add', '-A'], cwd)
    }
    git(['commit', '-m', message], cwd)
    const hash = git(['rev-parse', '--short', 'HEAD'], cwd)
    return c.json({ success: true, hash })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Commit failed' }, 500)
  }
})

/** POST /git/checkout — Switch branch */
gitRoutes.post('/checkout', async (c) => {
  const body = await c.req.json()
  const { cwd, branch } = body
  if (!cwd || !branch) {
    return c.json({ error: 'cwd and branch are required' }, 400)
  }
  try {
    git(['checkout', branch], cwd)
    return c.json({ success: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Checkout failed' }, 500)
  }
})

export default gitRoutes
