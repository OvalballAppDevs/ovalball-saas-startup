import { MobileHandoffShell as Shell } from "@/components/auth/mobile-handoff-shell"

export const metadata = { title: "Open in Ovalball" }

/**
 * THE SAME ONE HOP `/auth/mobile-recovery` ALREADY NEEDS, FOR A SOCIAL SIGN-IN INSTEAD OF A PASSWORD
 * RESET (CA-M11.3).
 *
 * MEASURED FOR RECOVERY, TRUE HERE FOR THE SAME REASON: Supabase will not honour a redirect_to of
 * `exp://<lan-ip>:8081/...` -- only a loopback `exp://127.0.0.1` (which a phone cannot use) or a custom
 * scheme (`ovalball://`, `ovalball-dev://`) is accepted. Expo Go has no custom scheme; a development or
 * production build does, and the app's own `oauthRedirectFor()` sends those straight to the provider
 * without this page at all.
 *
 * So in Expo Go, `signInWithOAuth`'s `redirectTo` points here instead, and this page hands the code (or
 * an `error`) straight to the app at `/auth/callback` -- the sibling path `resolveIntent` treats as
 * `AUTH_OAUTH`, never `/auth/recovery`'s `AUTH_RECOVERY`, so the two flows are never conflated.
 *
 * NOT AN OPEN REDIRECT, for the same reason the recovery page is not one: the destination is
 * `MOBILE_OAUTH_APP_URL`, set by whoever runs the server, never anything read from the request beyond
 * the `code`/`error` it forwards unchanged.
 *
 * HOLDS NOTHING. No session is created here; the code is single-use and PKCE-bound to the device that
 * started the flow, so a code lifted from this URL is worthless anywhere else.
 */
export default async function MobileOAuthHandoff({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; error_description?: string }>
}) {
  const { code, error, error_description: errorDescription } = await searchParams
  const appUrl = process.env.MOBILE_OAUTH_APP_URL

  if (!appUrl) {
    return (
      <Shell title="Not configured">
        <p className="text-sm text-ink-muted">
          This page only exists for local mobile development. Set <code>MOBILE_OAUTH_APP_URL</code> to
          the Expo Go URL for your machine — see <code>docs/mobile/DEVELOPMENT.md</code>.
        </p>
      </Shell>
    )
  }

  if (!code && !error) {
    return (
      <Shell title="That link is incomplete">
        <p className="text-sm text-ink-muted">Go back to the Ovalball app and try that sign-in again.</p>
      </Shell>
    )
  }

  const params = new URLSearchParams()
  if (code) params.set("code", code)
  if (error) params.set("error", error)
  if (errorDescription) params.set("error_description", errorDescription)
  const target = `${appUrl}${appUrl.includes("?") ? "&" : "?"}${params.toString()}`

  return (
    <Shell title="Opening Ovalball">
      <p className="text-sm text-ink-muted">Taking you back to the app.</p>
      <a
        href={target}
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-forest-800 px-5 text-sm font-medium text-white"
      >
        Open Ovalball
      </a>
      <meta httpEquiv="refresh" content={`0;url=${target}`} />
    </Shell>
  )
}
