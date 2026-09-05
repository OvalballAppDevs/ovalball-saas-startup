/**
 * The single canonical origin resolver for this application.
 *
 * Every absolute URL the product emits -- Supabase auth `emailRedirectTo`
 * links (signup confirmation, magic link, password recovery), invitation
 * links, and the GoCardless OAuth `redirect_uri` -- must be built from here.
 *
 * WHY THIS EXISTS
 * ---------------
 * This helper previously existed as ten separate copies, each written as
 * `process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`. That shape is
 * convenient locally and dangerous in production: if the environment variable
 * is ever missing from a production deployment, every copy silently degrades
 * to localhost and the product mails real users confirmation links pointing at
 * their own machine. There is no error, no log, and nothing fails -- the links
 * simply do not work. Consolidating to one resolver means that behaviour is
 * decided in exactly one place.
 *
 * THE RULE
 * --------
 * Development may fall back to http://localhost:3000.
 * Production must never fall back -- it fails closed instead.
 *
 * Note that `NEXT_PUBLIC_*` values are inlined by Next.js at BUILD time, so a
 * production build performed without this variable present bakes in the
 * fallback permanently. The production guard below turns that silent
 * misconfiguration into a loud one.
 */

/** True when this build/runtime is a real production deployment. */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production"
}

/**
 * The canonical absolute origin for this deployment, with no trailing slash.
 *
 * @throws in production when NEXT_PUBLIC_SITE_URL is missing, or is not an
 * absolute HTTPS non-localhost origin. Never throws in development.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()

  if (!configured) {
    if (isProductionRuntime()) {
      throw new Error(
        "NEXT_PUBLIC_SITE_URL is not set. Production refuses to fall back to http://localhost:3000, " +
          "because doing so would send real users authorization and invitation links pointing at their own machine. " +
          "Set NEXT_PUBLIC_SITE_URL to the deployment's real HTTPS origin."
      )
    }
    return "http://localhost:3000"
  }

  const withoutTrailingSlash = configured.replace(/\/+$/, "")

  if (!isProductionRuntime()) return withoutTrailingSlash

  let parsed: URL
  try {
    parsed = new URL(withoutTrailingSlash)
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL is not a valid absolute URL. Production requires the real HTTPS origin, e.g. https://ovalball.co.uk")
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname.endsWith(".local")
  if (isLocal || parsed.protocol !== "https:") {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL is "${parsed.origin}", which is not a production origin. ` +
        "Production requires an HTTPS, non-localhost origin so that authorization emails resolve for real users."
    )
  }

  return withoutTrailingSlash
}

/** Build an absolute product URL from a root-relative path (e.g. "/auth/callback?next=/welcome"). */
export function absoluteUrl(path: string): string {
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`
}
