import { notFound, redirect } from "next/navigation"
import Link from "next/link"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { EMAIL_EVENT_KEYS, emailEventDefinition, type EmailEventKey } from "@/lib/email/catalogue"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export const metadata = { title: "Email Preview" }

/**
 * Developer email preview.
 *
 * WHAT THIS DELIBERATELY IS NOT
 *
 * There is no send button, no recipient field, and no way to pass data in.
 * It renders fixed fixtures from lib/email/preview-fixtures.ts and nothing
 * else. A "preview and send to..." screen is an authenticated arbitrary
 * recipient relay wearing a developer-tool costume, which is exactly the
 * class of bug this whole foundation exists to remove.
 *
 * It is also not reachable in production: the route 404s outside
 * development, so it cannot become an accidental surface on a live site.
 */
export default async function EmailPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; variant?: string; view?: string }>
}) {
  if (process.env.NODE_ENV === "production") notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  const params = await searchParams
  const eventKey = (EMAIL_EVENT_KEYS.includes(params.event as EmailEventKey)
    ? params.event
    : EMAIL_EVENT_KEYS[0]) as EmailEventKey

  const variants = PREVIEW_FIXTURES[eventKey]
  const variantIndex = Math.min(Math.max(Number(params.variant ?? 0) || 0, 0), variants.length - 1)
  const variant = variants[variantIndex]
  const view = params.view === "text" ? "text" : params.view === "mobile" ? "mobile" : "desktop"

  const definition = emailEventDefinition(eventKey)
  const rendered = renderEmail(eventKey, variant.data as never)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <h1 className="font-display text-display-l text-ink">Email Preview</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink/70">
        Fixed fixture data only. This page cannot send anything and is not reachable in production.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {EMAIL_EVENT_KEYS.map((key) => (
          <Link
            key={key}
            href={`/admin/email-preview?event=${key}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              key === eventKey
                ? "border-forest-800 bg-forest-800 text-white"
                : "border-ink/15 bg-white text-ink/70 hover:border-forest-800/40"
            }`}
          >
            {key}
          </Link>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink/60">Classification</dt>
            <dd className="mt-0.5 font-mono text-ink">{definition.classification}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink/60">Topic</dt>
            <dd className="mt-0.5 font-mono text-ink">{definition.topicKey ?? "— (identity)"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink/60">Recipient resolver</dt>
            <dd className="mt-0.5 font-mono text-ink">{definition.recipientKind}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-ink/70">
          <span className="text-ink/60">Subject:</span> {rendered.subject}
        </p>
        <p className="mt-1 text-sm text-ink/70">
          <span className="text-ink/60">Preheader:</span> {rendered.preheader}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {variants.map((v, i) => (
          <Link
            key={v.label}
            href={`/admin/email-preview?event=${eventKey}&variant=${i}&view=${view}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              i === variantIndex ? "border-forest-800 text-forest-950" : "border-ink/15 text-ink/70"
            }`}
          >
            {v.label}
          </Link>
        ))}
        <span className="mx-2 h-4 w-px bg-ink/15" />
        {(["desktop", "mobile", "text"] as const).map((v) => (
          <Link
            key={v}
            href={`/admin/email-preview?event=${eventKey}&variant=${variantIndex}&view=${v}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize ${
              v === view ? "border-forest-800 text-forest-950" : "border-ink/15 text-ink/70"
            }`}
          >
            {v}
          </Link>
        ))}
      </div>

      <div className="mt-5">
        {view === "text" ? (
          <pre className="overflow-x-auto rounded-lg border border-ink/10 bg-white p-5 font-mono text-xs whitespace-pre-wrap text-ink">
            {rendered.text}
          </pre>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink/10 bg-ink/5 p-4">
            <iframe
              title={`${eventKey} preview`}
              srcDoc={rendered.html}
              sandbox=""
              className="mx-auto block h-[900px] rounded border border-ink/10 bg-white"
              style={{ width: view === "mobile" ? 390 : 700 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
