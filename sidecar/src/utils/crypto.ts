/**
 * Credential encryption — AES-256-GCM with machine-derived key.
 *
 * The encryption key is derived from a stable machine fingerprint
 * (homedir + platform + arch + username) using PBKDF2. This ensures:
 *   - API keys are never stored in plaintext in the SQLite database
 *   - Keys are decryptable only on the same machine
 *   - No external keychain dependency (works cross-platform)
 *
 * Encrypted format: "enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */

import crypto from 'crypto'
import os from 'os'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16
const SALT = 'miniclaw-credential-salt-v1'
const PREFIX = 'enc:v1:'

/** Derive a stable encryption key from machine identity. */
function deriveKey(): Buffer {
  // Use only truly stable attributes — hostname is excluded because macOS
  // often derives it from DHCP (e.g. "192.168.0.103") which changes per network.
  const fingerprint = [os.homedir(), os.platform(), os.arch(), os.userInfo().username].join(':')
  return crypto.pbkdf2Sync(fingerprint, SALT, 100_000, KEY_LENGTH, 'sha256')
}

let cachedKey: Buffer | null = null
function getKey(): Buffer {
  if (!cachedKey) cachedKey = deriveKey()
  return cachedKey
}

/**
 * Encrypt a plaintext string. Returns the encrypted format string.
 * Empty/null values pass through unchanged.
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext

  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypt an encrypted string. If the value is not encrypted
 * (no prefix), returns it as-is (transparent migration for existing data).
 * If decryption fails (e.g. key mismatch between dev/compiled builds),
 * returns empty string instead of crashing — caller will re-encrypt fresh data.
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext
  // Not encrypted — return as-is (supports existing plaintext data)
  if (!ciphertext.startsWith(PREFIX)) return ciphertext

  const payload = ciphertext.slice(PREFIX.length)
  const parts = payload.split(':')
  if (parts.length !== 3) return ciphertext

  try {
    const [ivHex, authTagHex, encryptedHex] = parts
    const key = getKey()
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    // Key mismatch (e.g. dev vs compiled binary derive different keys) — return
    // empty so the caller can re-encrypt with the current key on next upsert.
    return ''
  }
}
