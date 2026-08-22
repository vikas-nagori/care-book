import crypto from 'node:crypto'

type EncryptedSecret = { ciphertext: string; nonce: string }

function keyBytes(): Buffer {
  const raw = process.env.MCP_SESSION_ENCRYPTION_KEY
  if (!raw) throw new Error('MCP_SESSION_ENCRYPTION_KEY is required for the Supabase refresh-token fallback')
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  try {
    const decoded = Buffer.from(raw, 'base64')
    if (decoded.length === 32) return decoded
  } catch {
    // Fall through to the explicit length error below.
  }
  const utf8 = Buffer.from(raw)
  if (utf8.length === 32) return utf8
  throw new Error('MCP_SESSION_ENCRYPTION_KEY must encode exactly 32 bytes')
}

export function encryptSecret(value: string): EncryptedSecret {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), nonce)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { ciphertext: ciphertext.toString('base64url'), nonce: nonce.toString('base64url') }
}

export function decryptSecret(input: EncryptedSecret): string {
  const ciphertext = Buffer.from(input.ciphertext, 'base64url')
  const nonce = Buffer.from(input.nonce, 'base64url')
  if (ciphertext.length < 16 || nonce.length !== 12) throw new Error('Invalid encrypted secret')
  const body = ciphertext.subarray(0, -16)
  const authTag = ciphertext.subarray(-16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
