"use server"

import { headers } from "next/headers"

import { safeNextPath } from "@/lib/auth/safe-next"
import { OAUTH_PROVIDERS } from "@/lib/auth/oauth-providers"
import { getSiteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"
import { TURNSTILE_FAILURE_MESSAGE, verifyTurnstileToken } from "@/lib/auth/turnstile"

export type StartOAuthResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * Begins a provider sign-in, server-side.
 *
 * The redirect URL is generated here rather than in the browser for one
 * reason: it lets the Turnstile token be verified BEFORE an OAuth flow is
 * started. A client-side signInWithOAuth would redirect first and leave the
 * abuse gate decorative.
 *
 * Three things are validated here and cannot be influenced by the caller
 * beyond what is checked:
 *
 *  - the provider must be one this build knows about AND has enabled, so a
 *    caller cannot start a flow for a provider that is not configured;
 *  - `next` goes through the shared same-origin guard, so the post-login
 *    landing cannot be pointed at another site;
 *  - the callback origin comes from getSiteUrl(), the canonical origin
 *    resolver, never from a request header a client controls.
 */
export async function startOAuthSignIn(
  providerId: string,
  next: string | null,
  turnstileToken: string | null
): Promise<StartOAuthResult> {
  const provider = OAUTH_PROVIDERS.find((p) => p.id === providerId)
  if (!provider || !provider.enabled) {
    return { ok: false, error: "That sign-in method isn't available right now." }
  }

  const headerList = await headers()
  const verification = await verifyTurnstileToken(turnstileToken, {
    remoteIp: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    expectedHostname: headerList.get("host")?.split(":")[0] ?? null,
  })
  if (!verification.ok) {
    return { ok: false, error: TURNSTILE_FAILURE_MESSAGE }
  }

  const supabase = await createClient()
  const redirectTo = `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.id,
    options: {
      redirectTo,
      // The browser does its own navigation with the returned URL, so the
      // server must not try to redirect.
      skipBrowserRedirect: true,
      ...(provider.scopes ? { scopes: provider.scopes } : {}),
    },
  })

  if (error || !data?.url) {
    // Provider/GoTrue detail stays server-side; the visitor gets something
    // they can act on.
    console.error("oauth start failed:", error?.message)
    return { ok: false, error: "We couldn't start that sign-in. Please try again." }
  }

  return { ok: true, url: data.url }
}
