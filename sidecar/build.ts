/**
 * Build script for the sidecar.
 * Compiles the TypeScript sidecar into a single executable using Bun,
 * then renames it with the target triple suffix for Tauri.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ext = process.platform === 'win32' ? '.exe' : '';
const outDir = path.resolve(__dirname, '..', 'src-tauri', 'binaries');

// Get the Rust target triple
let targetTriple: string;
try {
  targetTriple = execSync('rustc --print host-tuple').toString().trim();
} catch {
  // Fallback for older Rust versions
  const rustInfo = execSync('rustc -Vv').toString();
  const match = /host: (\S+)/.exec(rustInfo);
  if (!match) {
    console.error('Failed to determine target triple');
    process.exit(1);
  }
  targetTriple = match[1];
}

console.log(`[build] Target triple: ${targetTriple}`);

// Ensure output directory exists
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outFile = path.join(outDir, `sidecar-${targetTriple}${ext}`);

// Build using bun build --compile
console.log('[build] Compiling sidecar with bun build --compile...');
execSync(
  `bun build src/index.ts --compile --outfile "${outFile}"`,
  { cwd: __dirname, stdio: 'inherit' }
);

console.log(`[build] Sidecar built: ${outFile}`);
