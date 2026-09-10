import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import {
  allowedVariables,
  CONTRACTED_EVENT_KEYS,
  recommendedDataFor,
  sampleVariables,
  structuredBlocksFor,
  templateContract,
} from "@/lib/email/contracts"
import { dynamicDataItem } from "@/lib/email/dynamic-data/catalogue"
import { listEmailEventPolicies } from "@/lib/email/delivery-policy"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"
import { fetchEmailUsageSummary, fetchRecentDeliveries } from "@/lib/email/usage"
import { WIRED_EVENT_KEYS } from "@/lib/email/wiring"
import { getSiteUrl, previewAssetOrigin } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"

import { EmailDeliveryHistory } from "../email-delivery-history"
import { EmailEnabledSwitch } from "../email-enabled-switch"
import { EmailOperationalStatus } from "../email-operational-status"
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

  // ONE merge of scalar variables and renderer-owned structured/image
  // entries, both resolved from the same canonical catalogue -- the Dynamic
  // Data panel draws its whole library from this, never a second list.
  const dynamicData = [
    ...allowedVariables(key).map((v) => ({
      key: v.name,
      label: v.label,
      group: v.category,
      kind: "scalar" as const,
      description: v.description,
      sample: v.sample,
      source: v.source,
      availability: dynamicDataItem(v.name)?.availability ?? "",
    })),
    ...structuredBlocksFor(key).map((b) => ({
      key: b.key,
      label: b.label,
      group: b.group,
      kind: b.kind,
      description: b.description,
      sample: b.sample,
      source: b.source,
      availability: b.availability,
    })),
  ]
  const recommendedKeys = recommendedDataFor(key).map((r) => r.key)

  const { data: settings } = await supabase
    .from("email_template_settings")
    .select("active_version_id, lock_version, updated_at")
    .eq("event_key", key)
    .maybeSingle()

  const [policies, usageThisMonth, usageAllTime, recentDeliveries] = canEdit
    ? await Promise.all([
        listEmailEventPolicies(supabase),
        fetchEmailUsageSummary(supabase, new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
        fetchEmailUsageSummary(supabase),
        fetchRecentDeliveries(supabase, key, 20),
      ])
    : ([{}, {}, {}, []] as [
        Awaited<ReturnType<typeof listEmailEventPolicies>>,
        Awaited<ReturnType<typeof fetchEmailUsageSummary>>,
        Awaited<ReturnType<typeof fetchEmailUsageSummary>>,
        Awaited<ReturnType<typeof fetchRecentDeliveries>>,
      ])
  const policy = policies[key] ?? null

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
    },
    // The embedded logo only: CTA destinations above still resolve from
    // getSiteUrl(), unconditionally. See previewAssetOrigin()'s own comment.
    await previewAssetOrigin()
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

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-display-l text-ink">{contract.name}</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-muted">{contract.trigger}</p>
        </div>
        {policy && canEdit && (
          <EmailEnabledSwitch
            eventKey={key}
            eventName={contract.name}
            active={policy.active}
            wired={policy.wired}
            classification={policy.classification}
            lockVersion={policy.lockVersion}
          />
        )}
      </div>

      {!(WIRED_EVENT_KEYS as readonly string[]).includes(key) && (
        <p className="mt-4 max-w-xl rounded-lg border border-amber-500/25 bg-amber-50/60 px-4 py-3 text-sm text-ink">
          Nothing in Ovalball sends this email yet (Not Wired). You can write it now and it will gain the normal
          On/Off control as soon as the feature it belongs to is switched on.
        </p>
      )}

      {policy && canEdit && (
        <EmailOperationalStatus
          active={policy.active}
          wired={policy.wired}
          templateStatus={active ? `Published v${active.revision}` : "Ovalball default"}
          thisMonthRecipientDeliveries={usageThisMonth[key]?.recipientDeliveries ?? 0}
          allTimeRecipientDeliveries={usageAllTime[key]?.recipientDeliveries ?? 0}
          lastSentAt={usageAllTime[key]?.lastSentAt ?? null}
          providerAccepted={usageThisMonth[key]?.providerAccepted ?? 0}
          failed={usageThisMonth[key]?.failed ?? 0}
        />
      )}

      <TemplateEditor
        eventKey={key}
        canEdit={canEdit}
        initial={initial}
        hasCta={contract.hasCta}
        dynamicData={dynamicData}
        recommendedKeys={recommendedKeys}
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

      {canEdit && <EmailDeliveryHistory deliveries={recentDeliveries} />}
    </div>
  )
}
