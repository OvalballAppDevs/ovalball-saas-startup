/**
 * TRANSPORT SECURITY HEADERS AND THE CONTENT SECURITY POLICY (Slice 6b.2d, S6-17).
 *
 * Phase 2 §H asks for security headers, a CSP and a `secure` session cookie. The
 * 6b.2 requirement matrix recorded the finding plainly: **none present at all**
 * -- no `next.config` headers, no CSP anywhere. This is the one place they are
 * built, so a route cannot quietly opt out of them and two copies cannot drift.
 *
 * WHY A NONCE RATHER THAN `'unsafe-inline'`. Next.js injects its own inline
 * bootstrap and flight scripts on every page, so a policy without either a nonce
 * or `'unsafe-inline'` produces a blank application -- "a wrong CSP breaks the
 * product silently" is exactly the risk the staging note called out. Allowing
 * all inline script would make `script-src` decorative: an injected `<script>`
 * would run, which is the attack the directive exists to stop. So the proxy
 * mints one nonce per request, hands it to Next through `x-nonce`, and names it
 * in the policy. `'strict-dynamic'` lets the scripts Next itself loads through
 * without the policy having to list every chunk URL.
 *
 * `'unsafe-inline'` remains for STYLE only. Tailwind and Next both emit inline
 * style attributes and `<style>` blocks during hydration, there is no nonce path
 * for the attribute form, and inline CSS is not script execution. It is a real
 * weakening, it is bounded, and it is written down rather than hidden.
 *
 * Every other origin below is one Ovalball actually uses, and nothing is a
 * wildcard:
 *
 *   - Supabase, from `NEXT_PUBLIC_SUPABASE_URL`, for the API, storage images and
 *     the realtime socket. The socket is `wss:`, which is a different scheme
 *     from the one in that variable, so both are derived rather than guessed.
 *   - Cloudflare Turnstile, which loads a script and renders in an iframe, so it
 *     needs `script-src` and `frame-src`.
 *   - `data:` and `blob:` images, for inline SVG favicons, generated QR codes and
 *     object URLs used while uploading.
 */

const TURNSTILE = "https://challenges.cloudflare.com"

/** The Supabase origins this deployment actually talks to, http and websocket. */
function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return []
  try {
    const url = new URL(raw)
    const ws = url.protocol === "https:" ? "wss:" : "ws:"
    return [url.origin, `${ws}//${url.host}`]
  } catch {
    return []
  }
}

export function contentSecurityPolicy(
  nonce: string,
  isProduction = process.env.NODE_ENV === "production",
  /** Report-only ignores `upgrade-insecure-requests` and says so in the console. */
  enforced = false
): string {
  const supabase = supabaseOrigins()
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    // A form cannot be made to post somewhere else, which is the other half of
    // the open-redirect story `safe-next.ts` closes for navigations.
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", TURNSTILE]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...supabase]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...supabase, TURNSTILE]],
    ["frame-src", ["'self'", TURNSTILE]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
  ]
  // Production only, for the same reason HSTS is: on a local http origin this
  // upgrades the Supabase calls to https and the whole stack stops answering.
  // Only when the policy is actually enforced: a report-only policy cannot
  // upgrade anything, and the browser logs a notice about it on every page.
  if (isProduction && enforced) directives.push(["upgrade-insecure-requests", []])
  return directives.map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name)).join("; ")
}

/**
 * The headers that do not depend on the request.
 *
 * HSTS is emitted only in production: sending it from a local http origin would
 * pin `localhost` to https in the developer's browser and lock them out of their
 * own machine, which is a real and unpleasant way to learn this.
 */
export function staticSecurityHeaders(isProduction: boolean): [string, string][] {
  const headers: [string, string][] = [
    ["X-Content-Type-Options", "nosniff"],
    // Belt and braces with frame-ancestors, for anything that predates CSP.
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    // Ovalball asks for none of these, and saying so stops an embedded third
    // party asking on its behalf.
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=()"],
  ]
  if (isProduction) {
    headers.push(["Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"])
  }
  return headers
}
