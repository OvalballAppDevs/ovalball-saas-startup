import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { CONTRACTED_EVENT_KEYS, sampleVariables, templateContract } from "@/lib/email/contracts"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"
import { WIRED_EVENT_KEYS } from "@/lib/email/wiring"
import { getSiteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"

import { TemplateEditor } from "./template-editor"

import type { EmailEventKey } from "@/lib/email/catalogue"

export async function generateMetadata({ params }: { params: Promise<{ eventKey: string }> }) {
  const { eventKey } = await params
  if (!(CONTRACTED_EVENT_KEYS as readonly string[]).includes(eventKey)) return { title: "Email Configuration" }
  return { title: templateContract(eventKey as EmailEventKey).name }
}

/**
 * One email's wording, its version history, and what it looks like.
 *
 * The preview is rendered by the SAME renderer that sends -- see
 * lib/email/resolve-content.ts. A preview produced by a second, friendlier
 * code path is a picture of a system that does not exist, and the first time
 * anybody finds out is when a real recipient sees something else.
 */
export default async function EmailTemplatePage({ params }: { params: Promise<{ eventKey: string }> }) {
  const { eventKey } = await params
  if (!(CONTRACTED_EVENT_KEYS as readonly string[]).includes(eventKey)) notFound()
  const key = eventKey as EmailEventKey

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const canEdit = activeSiteAdmin.ctx.siteAdminRole === "full"

  const contract = templateContract(key)

  const { data: settings } = await supabase
    .from("email_template_settings")
    .select("active_version_id, lock_version, updated_at")
    .eq("event_key", key)
    .maybeSingle()

  const { data: versionRows } = await supabase
    .from("email_template_versions")
    .select("id, revision, subject, preheader, heading, body, cta_label, status, created_at, from_registered_default, restored_from_revision")
    .eq("event_key", key)
    .order("revision", { ascending: false })

  const versions = versionRows ?? []
  const draft = versions.find((v) => v.status === "draft") ?? null
  const active = settings?.active_version_id ? versions.find((v) => v.id === settings.active_version_id) ?? null : null

  // What the editor opens on: the unpublished draft if there is one, then the
  // published wording, then Ovalball's own. An administrator returning to a
  // half-finished edit finds their own words, not the ones they were changing.
  const opening = draft ?? active
  const initial = opening
    ? {
        subject: opening.subject,
        preheader: opening.preheader,
        heading: opening.heading,
        body: opening.body,
        ctaLabel: opening.cta_label ?? "",
      }
    : {
        subject: contract.default.subject,
        preheader: contract.default.preheader,
        heading: contract.default.heading,
        body: contract.default.body,
        ctaLabel: contract.default.ctaLabel ?? "",
      }

  // The preview uses the controlled fixture for this event -- obviously fake
  // names, deliberately awkward lengths. No real person or club appears in a
  // preview, and no live record is read to build one.
  const fixture = PREVIEW_FIXTURES[key][0]
  const previewHtml = renderEmail(
    key,
    // The fixture is this event's own typed data; the cast reunites the key
    // with its data after the lookup, which TypeScript cannot narrow across a
    // dynamic route parameter.
    fixture.data as never,
    getSiteUrl(),
    {
      subject: initial.subject,
      preheader: initial.preheader,
      heading: initial.heading,
      body: initial.body,
      ctaLabel: initial.ctaLabel || null,
    }
  ).html

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link
        href="/admin/email"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Email Configuration
      </Link>

      <h1 className="mt-2 font-display text-display-l text-ink">{contract.name}</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">{contract.trigger}</p>

      {!(WIRED_EVENT_KEYS as readonly string[]).includes(key) && (
        <p className="mt-4 max-w-xl rounded-lg border border-amber-500/25 bg-amber-50/60 px-4 py-3 text-sm text-ink">
          Nothing in Ovalball sends this email yet. You can write it now and it will be used as soon as the feature it
          belongs to is switched on.
        </p>
      )}

      <TemplateEditor
        eventKey={key}
        canEdit={canEdit}
        initial={initial}
        hasCta={contract.hasCta}
        variables={contract.variables}
        expectedLock={settings?.lock_version ?? 0}
        hasDraft={draft !== null}
        isCustomised={active !== null}
        previewHtml={previewHtml}
        sampleValues={sampleVariables(key)}
        versions={versions.map((v) => ({
          revision: v.revision,
          status: v.status,
          createdAt: v.created_at,
          isActive: v.id === settings?.active_version_id,
          subject: v.subject,
        }))}
      />
    </div>
  )
}
