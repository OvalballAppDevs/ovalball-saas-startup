import { assertGoCardlessEnvironmentSafe, getGoCardlessApiBaseUrl, type GoCardlessEnvironment } from "./env"

// GoCardless-Version pins the REST API's date-versioned response shape.
// Not independently re-verified against a primary GoCardless page this
// session -- carried from Side Project 1's own research pass, which
// flagged the same caveat. Verify against
// https://developer.gocardless.com/api-reference before any real sandbox
// call is made.
const GOCARDLESS_API_VERSION = "2015-07-06"

export class GoCardlessApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message)
    this.name = "GoCardlessApiError"
  }
}

/**
 * The one canonical GoCardless API client for the whole app -- one
 * adapter, never scattered fetch calls through pages/components. Every
 * money-creating call (billing requests, subscriptions, payments,
 * retries) MUST pass idempotencyKey so a repeated server request never
 * duplicates a collection.
 *
 * `accessToken` is always the CONNECTED CLUB'S merchant token, never a
 * platform-wide credential -- callers must resolve it per-club
 * immediately before use and never cache/reuse it across clubs.
 */
export async function gcRequest<T = unknown>(params: {
  environment: GoCardlessEnvironment
  accessToken: string
  method: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  body?: Record<string, unknown>
  idempotencyKey?: string
}): Promise<T> {
  const environment = assertGoCardlessEnvironmentSafe()
  if (environment !== params.environment) {
    throw new Error(`GoCardless environment mismatch: connection is scoped to "${params.environment}" but the server is configured for "${environment}". Refusing to call the API.`)
  }

  const url = `${getGoCardlessApiBaseUrl(environment)}${params.path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    "GoCardless-Version": GOCARDLESS_API_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  if (params.idempotencyKey) {
    headers["Idempotency-Key"] = params.idempotencyKey
  }

  const response = await fetch(url, {
    method: params.method,
    headers,
    body: params.body ? JSON.stringify(params.body) : undefined,
  })

  const text = await response.text()
  const parsed = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new GoCardlessApiError(`GoCardless API request failed: ${params.method} ${params.path} -> ${response.status}`, response.status, parsed)
  }
  return parsed as T
}
