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
          "because doing so would send real users authorisation and invitation links pointing at their own machine. " +
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
        "Production requires an HTTPS, non-localhost origin so that authorisation emails resolve for real users."
    )
  }

  return withoutTrailingSlash
}

/** Build an absolute product URL from a root-relative path (e.g. "/auth/callback?next=/welcome"). */
export function absoluteUrl(path: string): string {
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * The same origin, for `metadata.metadataBase` only.
 *
 * getSiteUrl() fails closed, which is right for the thing it was written for:
 * a missing origin must never silently mail a real user a link to their own
 * machine. But Next evaluates root-layout metadata at BUILD time, so calling
 * the throwing version there converts "this deployment is misconfigured" into
 * "this build cannot be produced at all" -- including builds that legitimately
 * have no origin yet, such as a local production build for verification.
 *
 * metadataBase only resolves relative Open Graph URLs. Absence degrades: Next
 * warns and falls back. It cannot mail anyone anything, so it does not warrant
 * the fail-closed path -- and a genuinely misconfigured production deployment
 * still fails loudly the first time it tries to build an auth link, which is
 * where the guard belongs.
 *
 * This is deliberately in THIS file so there is still exactly one place that
 * knows how the product's origin is resolved.
 */
export function getSiteUrlForMetadata(): string | null {
  try {
    return getSiteUrl()
  } catch {
    return null
  }
}

/**
 * Where a Site Admin's OWN preview fetches an embedded email image from --
 * the brand logo, a club crest. Never used for a CTA destination, a link, or
 * a real send: those always resolve from {@link getSiteUrl}, unconditionally.
 *
 * THE PROBLEM THIS SOLVES
 * ------------------------
 * `NEXT_PUBLIC_SITE_URL` names one canonical deployment origin. A worktree
 * dev server that happens to be running on a different port than that value
 * (because the "usual" port was already taken by another checkout) still
 * serves `/email-assets/...` correctly -- just not at the URL the canonical
 * resolver names. Building the preview's `<img>` from `getSiteUrl()` in that
 * situation asks the BROWSER to fetch an image from a server that is not the
 * one rendering the page, which is a broken image icon that has nothing to do
 * with whether the asset route itself works.
 *
 * THE RULE THIS PRESERVES
 * ------------------------
 * Derived from the INCOMING REQUEST's own `Host` header, never from anything
 * a caller passes in -- so a Site Admin cannot supply an arbitrary preview
 * origin, and this function has no parameter for one to arrive through. The
 * value only ever answers "what origin am I, the server handling this
 * request, actually reachable at", which is the same trust level as the
 * request already carries by having reached a `requireActiveSiteAdmin()`
 * route at all. Falls back to {@link getSiteUrl} on any failure, so the worst
 * case is exactly today's behaviour, never something looser.
 */
export async function previewAssetOrigin(): Promise<string> {
  try {
    const { headers } = await import("next/headers")
    const requestHeaders = await headers()
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
    if (!host) return getSiteUrl()

    const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1")
    const proto = requestHeaders.get("x-forwarded-proto") ?? (isLocalHost ? "http" : "https")
    const origin = new URL(`${proto}://${host}`).origin
    return origin
  } catch {
    return getSiteUrl()
  }
}
