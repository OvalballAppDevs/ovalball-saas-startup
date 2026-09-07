import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/**
 * R-5 drill-through detail. Shows the canonical lifecycle for one referral
 * and legitimate links to the entities that actually exist -- never
 * internal implementation noise, never a fabricated field.
 */
export default async function ReferralDetailPage({ params }: { params: Promise<{ referralId: string }> }) {
  const { referralId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  if (!(await hasCapability(supabase, "site.commercial.view", "site"))) redirect("/dashboard")

  const { data: r, error } = await supabase
    .from("admin_referral_overview")
    .select("*")
    .eq("referral_id", referralId)
    .maybeSingle()
  // A failed read is not a missing referral. Rendering 404 for a broken query
  // tells a Site Admin the record does not exist, which is a different -- and
  // actionable -- claim from "the read fell over".
  if (error) throw new Error(`Referral could not be loaded: ${error.message}`)
  if (!r) notFound()

  const { data: auditRows, error: auditError } = await supabase
    .from("audit_log")
    .select("id, action, changed_at, changed_by, before, after")
    .eq("table_name", "platform_referrals")
    .eq("record_id", referralId)
    .order("changed_at", { ascending: false })
    .limit(20)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/commercial/referrals" className="inline-flex items-center gap-1.5 text-sm text-ink/55 hover:text-ink/80">
        <ArrowLeft className="size-3.5" /> Referral Administration
      </Link>
      <h1 className="mt-2 font-display text-display-l text-ink">
        {r.referring_club_name} → {r.referred_club_name ?? "(no club yet)"}
      </h1>
      <p className="mt-2 text-sm text-ink/55">Referral id {r.referral_id}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Status" value={r.status ?? "—"} />
        <Field label="Attribution source" value={r.attribution_source ?? "—"} />
        <Field label="Referring club" value={r.referring_club_name ?? "—"} link={r.referring_club_id ? `/admin/clubs/${r.referring_club_id}` : undefined} />
        <Field label="Referred club" value={r.referred_club_name ?? "Not yet activated"} link={r.referred_club_id ? `/admin/clubs/${r.referred_club_id}` : undefined} />
        <Field label="Invitation status" value={r.invitation_status ?? "—"} />
        <Field label="Invitation contact" value={r.invitation_contact_email ?? "—"} />
        <Field label="Referred club activated" value={r.referred_club_activated_at ? formatDate(r.referred_club_activated_at) : "Not yet"} />
        <Field label="Qualifying payment" value={r.qualifying_payment_status ? `${r.qualifying_payment_status} (${r.qualifying_payment_charge_date ? formatDate(r.qualifying_payment_charge_date) : "—"})` : "None yet"} />
        <Field label="Reward earned" value={r.reward_amount_pence ? formatMoney(r.reward_amount_pence) : "None yet"} />
        <Field label="Reward reversed" value={r.reward_reversed ? "Yes" : "No"} />
        {r.rejection_reason && <Field label="Rejection reason" value={r.rejection_reason} />}
      </div>

      {r.reward_credit_id && (
        <p className="mt-4 text-xs text-ink/50">
          Ovalball&rsquo;s credit ledger is pooled per club, not earmarked per referral, so &ldquo;applied&rdquo; vs
          &ldquo;outstanding&rdquo; cannot be attributed to this one reward without assuming an allocation order the
          product does not define. &ldquo;Reversed&rdquo; above is the one fact this schema can answer honestly per
          referral.
        </p>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg text-ink">Audit history</h2>
        {auditError ? (
          /* "No changes recorded yet." on a failed audit read would assert an
             absence of history that was never actually established. */
          <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-950">Audit history could not be loaded</p>
            <p className="mt-1 text-sm text-amber-900">
              This is a read failure, not an empty history.
            </p>
            <p className="mt-1.5 font-mono text-xs break-words text-amber-900/80">{auditError.message}</p>
          </div>
        ) : !auditRows || auditRows.length === 0 ? (
          <p className="mt-2 text-sm text-ink/55">No changes recorded yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {auditRows.map((a) => (
              <li key={a.id} className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm">
                <p className="text-ink">
                  {a.action} &middot; <span className="tabular-nums text-ink/55">{new Date(a.changed_at).toLocaleString("en-GB")}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{label}</p>
      {link ? (
        <Link href={link} className="mt-1 block text-sm text-forest-800 underline underline-offset-2">
          {value}
        </Link>
      ) : (
        <p className="mt-1 text-sm text-ink capitalize">{value}</p>
      )}
    </div>
  )
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(pence / 100)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
