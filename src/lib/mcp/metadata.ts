import { MCP_SCOPES, mcpIssuer, mcpOrigin, mcpResourceUrl } from './config.ts'

export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [mcpIssuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
  }
}

export function authorizationServerMetadata() {
  const origin = mcpOrigin()
  return {
    issuer: mcpIssuer(),
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  }
}
