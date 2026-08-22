import crypto from 'node:crypto'

export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
  return expected.length === challenge.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(challenge))
}
