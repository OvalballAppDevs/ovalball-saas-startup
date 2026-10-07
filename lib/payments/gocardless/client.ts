import { assertGoCardlessEnvironmentSafe, getGoCardlessApiBaseUrl, type GoCardlessEnvironment } from "./env"

// GoCardless-Version pins the REST API's date-versioned response shape.
// Not independently re-verified against a primary GoCardless page this
// session -- carried from Side Project 1's own research pass, which
// flagged the same caveat. Verify against
// https://developer.gocardless.com/api-reference before any real sandbox
// call is made.
const GOCARDLESS_API_VERSION = "2015-07-06"

export class GoCardlessApiError extends Error {
  // Declared fields rather than constructor parameter properties: the same class, in a form Node's own
  // TypeScript stripping can load, so the client runs under the repository's test runner unchanged.
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = "GoCardlessApiError"
    this.status = status
    this.body = body
  }
}

/** How long to wait before retrying a rate-limited request: GoCardless's own reset hint when it gives one. */
function backoffMs(response: Response, attempt: number): number {
  const reset = response.headers.get("ratelimit-reset")
  const resetAt = reset ? Date.parse(reset) : NaN
  if (!Number.isNaN(resetAt)) return Math.min(Math.max(resetAt - Date.now(), 250), 10_000)
  return Math.min(500 * 2 ** attempt, 4_000)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Create endpoints whose created resource can be fetched back at <path>/<id>. */
const RECOVERABLE_CREATE = /^\/(payments|subscriptions|billing_requests|refunds|mandates|customers|customer_bank_accounts)\/?$/

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
 *
 * TWO PROVIDER ANSWERS ARE HANDLED HERE, ONCE, FOR EVERY CALLER (GoCardless partner audit, 6 October 2026):
 *   - 429 (rate limited) is "safe to retry" (https://docs.gocardless.com/docs/api-reference/limits). A read,
 *     or a create carrying its idempotency key, is retried up to three times, waiting for GoCardless's own
 *     reset time where it gives one. A create WITHOUT a key is never retried: it could create twice.
 *   - 409 idempotent_creation_conflict means an earlier attempt with the same key already created the
 *     resource -- the create succeeded at GoCardless but was never recorded here. The answer names it
 *     (`links.conflicting_resource_id`), so it is fetched and returned exactly as a successful create would
 *     have been, instead of failing for the 30+ days the key is honoured.
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
  const retryable = params.method === "GET" || Boolean(params.idempotencyKey)

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: params.method,
      headers,
      body: params.body ? JSON.stringify(params.body) : undefined,
    })

    const text = await response.text()
    const parsed = text ? JSON.parse(text) : null

    if (response.status === 429 && retryable && attempt < 3) {
      await sleep(backoffMs(response, attempt))
      continue
    }

    // Only a plain create (POST /payments, /subscriptions, ...) names a resource that can be fetched back at
    // <path>/<id>; an action endpoint or a billing request flow does not, so a 409 there stays an error.
    if (response.status === 409 && params.method === "POST" && params.idempotencyKey && RECOVERABLE_CREATE.test(params.path)) {
      const conflict = conflictingResource(parsed)
      if (conflict) {
        return gcRequest<T>({
          environment: params.environment,
          accessToken: params.accessToken,
          method: "GET",
          path: `${params.path.replace(/\/+$/, "")}/${encodeURIComponent(conflict)}`,
        })
      }
    }

    if (!response.ok) {
      throw new GoCardlessApiError(`GoCardless API request failed: ${params.method} ${params.path} -> ${response.status}`, response.status, parsed)
    }
    return parsed as T
  }
}

/** The id GoCardless names in an `idempotent_creation_conflict`, or null for any other 409. */
function conflictingResource(body: unknown): string | null {
  const error = (body as { error?: { errors?: { reason?: string; links?: { conflicting_resource_id?: string } }[] } } | null)?.error
  for (const e of error?.errors ?? []) {
    if (e.reason === "idempotent_creation_conflict" && typeof e.links?.conflicting_resource_id === "string") {
      return e.links.conflicting_resource_id
    }
  }
  return null
}
