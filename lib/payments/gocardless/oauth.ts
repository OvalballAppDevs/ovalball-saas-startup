import { assertGoCardlessEnvironmentSafe, assertGoCardlessRedirectOriginSafe, getGoCardlessClientId, getGoCardlessClientSecret, getGoCardlessConnectBaseUrl, type GoCardlessEnvironment } from "./env"

/**
 * Server-side OAuth2 authorization-code flow ONLY. Ovalball never asks a
 * Club Admin to paste an access token, client secret, or API key -- the
 * flow is: build this URL server-side -> redirect the browser to
 * GoCardless -> GoCardless redirects back to our callback route with a
 * short-lived `code` -> the callback route (server-only, service-role
 * client) exchanges that code for an access token directly against
 * GoCardless, over a server-to-server request the browser never sees.
 */
export function buildGoCardlessAuthorizeUrl(params: { state: string; clubId: string }): { url: string; environment: GoCardlessEnvironment } {
  const environment = assertGoCardlessEnvironmentSafe()
  const redirectUri = `${assertGoCardlessRedirectOriginSafe()}/api/gocardless/oauth/callback`

  const search = new URLSearchParams({
    client_id: getGoCardlessClientId(),
    initial_view: "login",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read_write",
    state: params.state,
  })

  return { url: `${getGoCardlessConnectBaseUrl(environment)}/oauth/authorize?${search.toString()}`, environment }
}

interface GoCardlessTokenResponse {
  access_token: string
  token_type: string
  scope: string
  organisation_id?: string
}

/**
 * Server-only code-for-token exchange -- called exclusively from
 * app/api/gocardless/oauth/callback/route.ts, never from a client
 * component or a PostgREST-reachable RPC. Returns the merchant's
 * access_token, which the caller must pass straight to
 * store_gocardless_connection() and never log, echo to the browser, or
 * place in any client-visible response.
 */
export async function exchangeGoCardlessOAuthCode(code: string): Promise<GoCardlessTokenResponse> {
  const environment = assertGoCardlessEnvironmentSafe()
  const redirectUri = `${assertGoCardlessRedirectOriginSafe()}/api/gocardless/oauth/callback`

  const response = await fetch(`${getGoCardlessConnectBaseUrl(environment)}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: getGoCardlessClientId(),
      client_secret: getGoCardlessClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  })

  const text = await response.text()
  const parsed = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`GoCardless OAuth token exchange failed: ${response.status} ${JSON.stringify(parsed)}`)
  }
  return parsed as GoCardlessTokenResponse
}

/**
 * Revokes a club's access token at GoCardless -- what disconnecting means at the provider. A GoCardless OAuth
 * token is permanent until revoked and acts on the club's whole account, so a token Ovalball has let go of is
 * revoked, not merely forgotten (20270744000000 queues it; token-revocation.ts drains the queue). A
 * form-encoded POST to the connect host's /oauth/revoke with the partner app's credentials, per GoCardless's
 * OAuth documentation. The token is never logged, and an error never carries it.
 */
export async function revokeGoCardlessToken(params: { environment: GoCardlessEnvironment; token: string }): Promise<void> {
  const response = await fetch(`${getGoCardlessConnectBaseUrl(params.environment)}/oauth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: getGoCardlessClientId(), client_secret: getGoCardlessClientSecret(), token: params.token }).toString(),
  })
  if (!response.ok) {
    throw new Error(`GoCardless token revocation failed: ${response.status}`)
  }
}
