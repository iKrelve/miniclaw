/**
 * Upload HTTP route — handles file uploads for chat attachments.
 */

import { Hono } from 'hono'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const uploadRoutes = new Hono()

const UPLOAD_DIR = path.join(os.homedir(), '.miniclaw', 'uploads')

/** POST /uploads — Upload a file, return its server-side path */
uploadRoutes.post('/', async (c) => {
  // Ensure upload directory exists
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }

  const body = await c.req.json()
  const { name, data, type } = body as { name: string; data: string; type: string }

  if (!name || !data) {
    return c.json({ error: 'name and data (base64) are required' }, 400)
  }

  const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')
  const id = crypto.randomUUID()
  const fileName = `${id}-${safeName}`
  const filePath = path.join(UPLOAD_DIR, fileName)

  const buffer = Buffer.from(data, 'base64')
  fs.writeFileSync(filePath, buffer)

  return c.json(
    {
      id,
      name: safeName,
      path: filePath,
      size: buffer.length,
      type,
    },
    201,
  )
})

/** GET /uploads/serve?path=... — Serve a file from uploads directory (for image preview) */
uploadRoutes.get('/serve', (c) => {
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path is required' }, 400)

  // Security: only serve files from the uploads directory
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(UPLOAD_DIR)) {
    return c.json({ error: 'Access denied' }, 403)
  }

  if (!fs.existsSync(resolved)) return c.json({ error: 'File not found' }, 404)

  const buffer = fs.readFileSync(resolved)
  const ext = path.extname(resolved).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
  }
  const contentType = mimeMap[ext] || 'application/octet-stream'

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'max-age=86400',
    },
  })
})

export default uploadRoutes
