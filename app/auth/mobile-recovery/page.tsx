import { OvalballLogo } from "@/components/brand/ovalball-logo"

export const metadata = { title: "Open in Ovalball" }

/**
 * THE ONE HOP EXPO GO NEEDS, AND ONLY EXPO GO.
 *
 * MEASURED, NOT ASSUMED. Supabase will not honour a recovery `redirect_to` of `exp://<lan-ip>:8081/...`
 * — tried as `exp://**`, as `exp://**\/**`, as `exp://*\/--\/**` and as the exact URL, all four fell
 * back to `site_url`. Only a loopback `exp://127.0.0.1:8081` is accepted, which a phone cannot use,
 * and only a custom scheme (`ovalball://`, `ovalball-dev://`) is honoured with a host. Expo Go has no
 * custom scheme; a development build does.
 *
 * So in Expo Go the recovery email points at this page, which hands the code straight to the app. It
 * is NOT the dead browser page the brief rules out: it opens Ovalball by itself, and the button is
 * there only for the case where the automatic attempt is blocked.
 *
 * THIS IS A DEVELOPMENT AFFORDANCE AND SAYS SO. A development build needs none of it — the email goes
 * to `ovalball-dev://` directly — and production goes to `ovalball://` or a universal link. The page
 * renders nothing at all unless the app URL is configured, so it cannot become a live redirector by
 * accident.
 *
 * IT IS NOT AN OPEN REDIRECT. The destination comes from `MOBILE_RECOVERY_APP_URL`, set by whoever
 * runs the server; the only thing taken from the request is the `code`, which is appended as a query
 * parameter. A caller cannot choose where this page sends anybody.
 *
 * AND IT HOLDS NOTHING. No session is created here, nothing is read from the database, and the code is
 * single-use and bound by PKCE to the device that asked for it — a code lifted from this URL is
 * useless anywhere else.
 */
export default async function MobileRecoveryHandoff({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const { code } = await searchParams
  const appUrl = process.env.MOBILE_RECOVERY_APP_URL

  if (!appUrl) {
    return (
      <Shell title="Not configured">
        <p className="text-sm text-ink-muted">
          This page only exists for local mobile development. Set <code>MOBILE_RECOVERY_APP_URL</code> to
          the Expo Go URL for your machine — see <code>docs/mobile/DEVELOPMENT.md</code>.
        </p>
      </Shell>
    )
  }

  if (!code) {
    return (
      <Shell title="That link is incomplete">
        <p className="text-sm text-ink-muted">
          Ask for a new password reset from the Ovalball app and open the most recent email.
        </p>
      </Shell>
    )
  }

  const target = `${appUrl}${appUrl.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`

  return (
    <Shell title="Opening Ovalball">
      <p className="text-sm text-ink-muted">
        Taking you back to the app to set your new password.
      </p>
      <a
        href={target}
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-forest-800 px-5 text-sm font-medium text-white"
      >
        Open Ovalball
      </a>
      {/* The automatic attempt. A meta refresh rather than a script so it works with JavaScript off,
          and the button above stays as the fallback when a browser refuses to follow a custom scheme. */}
      <meta httpEquiv="refresh" content={`0;url=${target}`} />
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="brand-light-scope flex min-h-dvh flex-col items-center justify-center bg-chalk px-6 text-center">
      <OvalballLogo variant="dark" className="h-10 w-auto" />
      <h1 className="mt-8 font-display text-display-m text-ink">{title}</h1>
      {children}
    </main>
  )
}
