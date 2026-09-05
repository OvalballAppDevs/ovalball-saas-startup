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
