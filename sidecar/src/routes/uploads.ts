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

export default uploadRoutes
