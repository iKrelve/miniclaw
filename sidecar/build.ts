/**
 * Build script for the sidecar.
 * Compiles the TypeScript sidecar into a single executable using Bun,
 * then renames it with the target triple suffix for Tauri.
 *
 * Uses Bun $ shell tag (no child_process).
 */
import { $ } from 'bun'
import fs from 'fs'
import path from 'path'

const ext = process.platform === 'win32' ? '.exe' : ''
const outDir = path.resolve(__dirname, '..', 'src-tauri', 'binaries')

// Get the Rust target triple
let targetTriple: string
try {
  targetTriple = (await $`rustc --print host-tuple`.text()).trim()
} catch {
  // Fallback for older Rust versions
  const info = await $`rustc -Vv`.text()
  const match = /host: (\S+)/.exec(info)
  if (!match) {
    console.error('Failed to determine target triple')
    process.exit(1)
  }
  targetTriple = match[1]
}

console.log(`[build] Target triple: ${targetTriple}`)

// Ensure output directory exists
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true })
}

const outFile = path.join(outDir, `sidecar-${targetTriple}${ext}`)

// Build using bun build --compile
console.log('[build] Compiling sidecar with bun build --compile...')
await $`bun build src/index.ts --compile --outfile ${outFile}`.cwd(__dirname)

console.log(`[build] Sidecar built: ${outFile}`)
