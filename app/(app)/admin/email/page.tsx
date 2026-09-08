import Link from "next/link"
import { redirect } from "next/navigation"
import { Mail } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { EMAIL_TEMPLATE_CONTRACTS, CONTRACTED_EVENT_KEYS } from "@/lib/email/contracts"
import { WIRED_EVENT_KEYS } from "@/lib/email/wiring"
import { createClient } from "@/lib/supabase/server"

import type { EmailEventKey } from "@/lib/email/catalogue"

export const metadata = { title: "Email Configuration" }

/**
 * EMAIL CONFIGURATION -- the catalogue.
 *
 * Every email Ovalball is capable of sending, in one list, whether or not it
 * is currently wired to anything. An email that exists in code but has no
 * trigger yet is shown saying exactly that, because the alternative is an
 * administrator carefully rewording a message nobody will ever receive.
 *
 * This page shows configuration, never implementation. No file paths, no SQL,
 * no environment variable values, no template source -- a Site Admin manages
 * the product here, they do not read the repository.
 */
export default async function EmailConfigurationPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  // Email wording is site-wide and goes to people outside Ovalball, so it is
  // Full Site Admin only -- the same authority the registry's own write
  // functions enforce. A narrow Site Admin sees the page and can read it.
  const canEdit = activeSiteAdmin.ctx.siteAdminRole === "full"

  const { data: settings } = await supabase
    .from("email_template_settings")
    .select("event_key, active_version_id, updated_at")

  const { data: versions } = await supabase
    .from("email_template_versions")
    .select("id, event_key, revision, status")

  const settingsByKey = new Map((settings ?? []).map((s) => [s.event_key, s]))
  const draftKeys = new Set((versions ?? []).filter((v) => v.status === "draft").map((v) => v.event_key))
  const revisionById = new Map((versions ?? []).map((v) => [v.id, v.revision]))

  const rows = CONTRACTED_EVENT_KEYS.map((key) => {
    const contract = EMAIL_TEMPLATE_CONTRACTS[key]
    const setting = settingsByKey.get(key)
    const activeRevision = setting?.active_version_id ? revisionById.get(setting.active_version_id) : undefined
    return {
      key,
      name: contract.name,
      category: contract.category,
      trigger: contract.trigger,
      wired: (WIRED_EVENT_KEYS as readonly string[]).includes(key),
      wording: activeRevision ? `Customised (version ${activeRevision})` : "Ovalball default",
      hasDraft: draftKeys.has(key),
      updatedAt: setting?.updated_at ?? null,
    }
  })

  const categories = [...new Set(rows.map((r) => r.category))]

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <Mail className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Email Configuration</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        The wording of every email Ovalball sends. You can change what an email says; when it is sent, who receives it
        and where its button goes are part of the product and are not editable here.
      </p>

      {!canEdit && (
        <p className="mt-4 max-w-xl rounded-lg border border-amber-500/25 bg-amber-50/60 px-4 py-3 text-sm text-ink">
          You can read this configuration. Changing an email&apos;s wording is restricted to a Full Site Admin.
        </p>
      )}

      {categories.map((category) => (
        <section key={category} className="mt-8">
          <h2 className="font-display text-lg text-ink">{category}</h2>
          <ul className="mt-3 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            {rows
              .filter((r) => r.category === category)
              .map((row) => (
                <li key={row.key}>
                  <Link
                    href={`/admin/email/${row.key}`}
                    className="flex min-h-11 flex-col gap-1 px-5 py-3.5 outline-none hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-pitch-400 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{row.name}</span>
                      <span className="mt-0.5 block text-sm text-ink-muted">{row.trigger}</span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      {row.hasDraft && <Chip tone="amber">Unpublished draft</Chip>}
                      <Chip tone={row.wording === "Ovalball default" ? "quiet" : "forest"}>{row.wording}</Chip>
                      {!row.wired && <Chip tone="quiet">Not yet sent by anything</Chip>}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * Status is never colour alone: each chip reads as a complete phrase, so the
 * same information survives greyscale, a screen reader, and a printout.
 */
function Chip({ tone, children }: { tone: "quiet" | "forest" | "amber"; children: React.ReactNode }) {
  const tones = {
    quiet: "border-ink/15 text-ink/55",
    forest: "border-forest-800/30 text-forest-800",
    amber: "border-amber-500/40 text-ink",
  } as const
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap ${tones[tone]}`}>{children}</span>
  )
}

export type EmailCatalogueKey = EmailEventKey
