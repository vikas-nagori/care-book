import crypto from 'node:crypto'

type TokenKind = 'at' | 'rt' | 'code' | 'selection'

export function generateToken(kind: TokenKind): string {
  return `cbk_${kind}_${crypto.randomBytes(32).toString('base64url')}`
}

export function generateClientId(): string {
  return `cbk_client_${crypto.randomBytes(16).toString('base64url')}`
}

export function hashToken(token: string): string {
  const pepper = process.env.MCP_TOKEN_PEPPER ?? ''
  return crypto.createHash('sha256').update(`${pepper}:${token}`).digest('hex')
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
