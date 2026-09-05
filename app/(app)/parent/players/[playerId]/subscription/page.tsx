import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { getSessionContext } from "@/lib/app-context/session-context"
import { formatMinorUnits } from "@/lib/payments/domain/money"
import { reconcileGoCardlessBillingRequest } from "@/lib/payments/gocardless/reconcile"
import { createClient } from "@/lib/supabase/server"

import { ActivateMembershipButton } from "./activate-membership-button"
import { CancelOwnMembershipButton } from "./cancel-own-membership-button"
import { SetupDirectDebitButton } from "./setup-direct-debit-button"

const MANDATE_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Submitted to your bank, not yet active",
  submitted: "Submitted to your bank, not yet active",
  active: "Active",
  failed: "Setup failed",
  cancelled: "Cancelled",
  expired: "Expired",
  consumed: "Replaced by a newer mandate",
}

// GoCardless Payment statuses -- never collapsed to a bare "Paid"/"Failed"
// label: "confirmed" and "paid_out" are genuinely different provider
// facts (collected from the payer vs. later included in a payout to the
// club), and neither may be implied by mere creation.
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Scheduled, not yet submitted to your bank",
  submitted: "Submitted to your bank, awaiting confirmation",
  confirmed: "Collected from your account",
  paid_out: "Collected and paid out to the club",
  failed: "Collection failed",
  cancelled: "Cancelled",
  charged_back: "Charged back",
}

const GC_SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  pending: "Set up, first collection not yet due",
  active: "Active",
  finished: "Finished",
  cancelled: "Cancelled",
  paused: "Paused",
}

/**
 * The Parent Subscription page -- Player / Club / Membership amount /
 * Collection day / Total shown clearly before authorization / status.
 * Never shows a bank account number, sort code, or GoCardless secret --
 * only safe status metadata. A Guardian or the adult Player themselves
 * may view/act here; anyone else gets "not found" rather than a leaked
 * existence signal.
 */
export default async function PlayerSubscriptionPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)

  const guardianRel = ctx.guardianRelationships.find((g) => g.playerId === playerId)
  const linkedSelf = ctx.linkedPlayerTeams.find((p) => p.playerId === playerId)
  const relation = guardianRel ?? linkedSelf
  if (!relation) notFound()

  const { data: player } = await supabase.from("players").select("id, first_name, surname").eq("id", playerId).maybeSingle()
  if (!player) notFound()

  const { data: eligibility } = await supabase.rpc("get_enrolment_eligibility", { p_player_id: playerId, p_club_id: relation.clubId }).maybeSingle()

  if (!eligibility || !eligibility.programme_id) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
        <BackLink playerId={playerId} />
        <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Subscription</p>
        <h1 className="mt-2 font-display text-display-l text-ink">
          {player.first_name} {player.surname}
        </h1>
        <p className="mt-4 max-w-md text-sm text-ink/55">{relation.clubName} does not have Club Subscriptions set up yet.</p>
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  // Sibling-discount policy: ONE canonical pricing pipeline -- this
  // already-server-computed preview carries the sibling-adjusted monthly
  // amount, never independently recalculated here or in React.
  const { data: preview } = await supabase.rpc("preview_first_payment", { p_programme_id: eligibility.programme_id, p_player_id: playerId, p_membership_start_date: today }).maybeSingle()
  const { data: payerRow } = eligibility.existing_payer_subscription_id
    ? await supabase.from("player_subscription_payers").select("id, relationship, payer_user_id").eq("id", eligibility.existing_payer_subscription_id).maybeSingle()
    : { data: null }
  // Only the genuine payer may see the cancel action -- a non-payer
  // guardian of the same player (who CAN view this page via
  // is_own_linked_player/guardianRelationships) must never see it,
  // matching the exact server-side check cancelOwnMembershipAction
  // itself enforces.
  const isOwnPayer = payerRow?.payer_user_id === user.id

  // Once a real payer row exists, `preview` (always computed fresh "as
  // if joining today") is no longer the truthful figure -- a
  // price/policy change since real enrolment, or an older sibling later
  // leaving, would make it silently drift from what this Parent
  // actually committed to and is really being charged (exactly the
  // "sibling leaving doesn't re-price remaining sibling" policy this
  // domain locks and tests). The real, permanent snapshot on
  // player_subscription_payers is the one canonical source once
  // enrolment is real -- `preview` remains correct and necessary only
  // for the pre-commitment case (no payerRow yet).
  const { data: payerSnapshot } = payerRow
    ? await supabase.from("player_subscription_payers").select("sibling_ordinal, sibling_discount_type, sibling_discount_value, final_amount_minor").eq("id", payerRow.id).maybeSingle()
    : { data: null }

  const { data: billingRequest } = payerRow
    ? await supabase.from("gocardless_billing_requests").select("id, status, gc_billing_request_id, created_at").eq("payer_subscription_id", payerRow.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null }

  let localMandate: { status: string; scheme: string | null; next_possible_charge_date: string | null } | null = null
  if (billingRequest) {
    const { data: existingMandate } = await supabase.from("gocardless_mandates").select("status, scheme, next_possible_charge_date").eq("billing_request_id", billingRequest.id).maybeSingle()
    localMandate = existingMandate

    // The Parent shouldn't have to wait for a webhook just for Ovalball
    // to know what GoCardless already knows -- if we haven't reconciled
    // this billing request (no local mandate yet, or GoCardless hasn't
    // confirmed "fulfilled" locally), re-fetch provider truth now,
    // server-side, using a token scoped to THIS payer subscription
    // (get_gocardless_token_for_payer_subscription itself proves the
    // current user owns it -- never a client-supplied club/programme pair).
    if (!existingMandate || billingRequest.status !== "fulfilled") {
      const { data: tokenRow } = await supabase.rpc("get_gocardless_token_for_payer_subscription", { p_payer_subscription_id: payerRow!.id }).maybeSingle()
      if (tokenRow) {
        try {
          await reconcileGoCardlessBillingRequest({
            environment: tokenRow.environment as "sandbox" | "production",
            accessToken: tokenRow.access_token,
            billingRequestLocalId: billingRequest.id,
            gcBillingRequestId: billingRequest.gc_billing_request_id,
          })
          const { data: refreshedMandate } = await supabase.from("gocardless_mandates").select("status, scheme, next_possible_charge_date").eq("billing_request_id", billingRequest.id).maybeSingle()
          localMandate = refreshedMandate
        } catch {
          // Reconciliation failure never destroys or falsifies existing
          // state -- the page just falls back to whatever was already
          // known locally (a provider read failure must not falsely
          // mark setup complete).
        }
      }
    }
  }

  let obligation: { id: string; amount_due_minor: number; is_prorated: boolean; gocardless_payment_id: string | null } | null = null
  let localPayment: { status: string; gross_amount_minor: number; charge_date: string | null } | null = null
  let localSubscription: { status: string; amount_minor: number } | null = null
  if (payerRow && localMandate) {
    const billingPeriod = `${today.slice(0, 7)}-01`
    const { data: obligationRow } = await supabase
      .from("membership_obligations")
      .select("id, amount_due_minor, is_prorated, gocardless_payment_id")
      .eq("payer_subscription_id", payerRow.id)
      .eq("billing_period", billingPeriod)
      .maybeSingle()
    obligation = obligationRow

    if (obligationRow?.gocardless_payment_id) {
      const { data: paymentRow } = await supabase.from("gocardless_payments").select("status, gross_amount_minor, charge_date").eq("id", obligationRow.gocardless_payment_id).maybeSingle()
      localPayment = paymentRow
    }

    const { data: subscriptionRow } = await supabase.from("gocardless_subscriptions").select("status, amount_minor").eq("payer_subscription_id", payerRow.id).in("status", ["pending", "active"]).maybeSingle()
    localSubscription = subscriptionRow
  }

  const canSetUp = eligibility.programme_enabled && eligibility.has_pricing && eligibility.merchant_verified && eligibility.player_has_active_membership

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <BackLink playerId={playerId} />
      <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Subscription</p>
      <h1 className="mt-2 font-display text-display-l text-ink">
        {player.first_name} {player.surname}
      </h1>

      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
        <dl className="flex flex-col gap-3 text-sm">
          <Row label="Player" value={`${player.first_name} ${player.surname}`} />
          <Row label="Club" value={relation.clubName} />
          <Row label="Membership" value={payerSnapshot?.final_amount_minor != null ? `${formatMinorUnits(payerSnapshot.final_amount_minor)} / month` : preview ? `${formatMinorUnits(preview.monthly_amount_minor)} / month` : "Not yet priced"} />
        </dl>

        {payerSnapshot
          ? (payerSnapshot.sibling_ordinal ?? 0) >= 2 &&
            payerSnapshot.sibling_discount_type !== "NONE" && (
              <div className="mt-4 rounded-md bg-mint-50 px-3 py-2 text-xs text-forest-800">
                This is your {ordinalWord(payerSnapshot.sibling_ordinal ?? 0)} child registered for this membership at {relation.clubName}. {relation.clubName} gives{" "}
                {payerSnapshot.sibling_discount_type === "PERCENTAGE" ? `a ${payerSnapshot.sibling_discount_value}% sibling discount` : `a ${formatMinorUnits(payerSnapshot.sibling_discount_value ?? 0)} sibling discount`}.
              </div>
            )
          : preview &&
            preview.sibling_ordinal >= 2 &&
            preview.sibling_discount_type !== "NONE" && (
              <div className="mt-4 rounded-md bg-mint-50 px-3 py-2 text-xs text-forest-800">
                This is your {ordinalWord(preview.sibling_ordinal)} child registered for this membership at {relation.clubName}. {relation.clubName} gives{" "}
                {preview.sibling_discount_type === "PERCENTAGE" ? `a ${preview.sibling_discount_value}% sibling discount` : `a ${formatMinorUnits(preview.sibling_discount_value)} sibling discount`}.
              </div>
            )}

        {/* This whole block is a PRE-COMMITMENT preview ("if you joined
            today") -- once a real payer row exists, the real
            obligation/payment further below is the truthful figure, and
            this speculative recompute would otherwise show a different,
            contradictory number on the same page for an already-active
            member. */}
        {!payerRow && preview && (
          <div className="mt-4 border-t border-ink/10 pt-4">
            {preview.is_prorated ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">First membership charge</span>
                  <span className="text-lg font-medium tabular-nums text-ink">{formatMinorUnits(preview.first_charge_amount_minor)}</span>
                </div>
                <p className="mt-1 text-xs text-ink/50">
                  Covers {new Date(preview.covers_from).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}&ndash;{new Date(preview.covers_to).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Then{" "}
                  {formatMinorUnits(preview.monthly_amount_minor)} per month from the 1st.
                </p>
              </>
            ) : preview.first_charge_billing_period !== `${today.slice(0, 7)}-01` ? (
              <>
                <p className="text-sm font-medium text-ink">Nothing due for {new Date(today).toLocaleDateString("en-GB", { month: "long" })}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">First membership charge</span>
                  <span className="text-lg font-medium tabular-nums text-ink">{formatMinorUnits(preview.first_charge_amount_minor)}</span>
                </div>
                <p className="mt-1 text-xs text-ink/50">Billing period {new Date(preview.first_charge_billing_period).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}. Normal collection date: 1st of each month.</p>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">Total charged to you</span>
                <span className="text-lg font-medium tabular-nums text-ink">{formatMinorUnits(preview.first_charge_amount_minor)}</span>
              </div>
            )}
            <p className="mt-2 text-xs text-ink/40">Shown in full before you authorize anything. The actual first collection date is confirmed by GoCardless once your Direct Debit is set up -- this is not a promise of same-day collection.</p>
          </div>
        )}
      </div>

      {/* mb-16: whichever branch below renders last on the page, without
          extra clearance the fixed-position "Ask Ovie" chat widget
          overlaps it at the bottom of a short page on mobile (found live
          in the mobile responsive check) -- same fix already applied to
          CancelOwnMembershipButton for the branch that renders it. */}
      <div className="mt-6 mb-16">
        {!payerRow ? (
          canSetUp ? (
            <>
              <p className="mb-3 text-sm text-ink/60">Direct Debit not set up.</p>
              <SetupDirectDebitButton playerId={playerId} programmeId={eligibility.programme_id} clubId={relation.clubId} />
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-4 text-center text-sm text-ink/55">This club is still setting up subscriptions. Check back soon.</p>
          )
        ) : localMandate ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-pitch-600/30 bg-pitch-50 p-4">
              <p className="text-sm font-medium text-forest-800">Direct Debit: {MANDATE_STATUS_LABEL[localMandate.status] ?? localMandate.status}</p>
              <p className="mt-1 text-xs text-ink/60">{localMandate.status === "active" ? "Your bank has confirmed this Direct Debit mandate." : "This is your bank mandate only -- it authorizes future collections but does not itself collect any money."}</p>
            </div>

            {obligation && obligation.is_prorated && (
              <div className="rounded-lg border border-ink/10 bg-white p-4">
                <p className="text-sm font-medium text-ink">First payment: {formatMinorUnits(obligation.amount_due_minor)}</p>
                <p className="mt-1 text-xs text-ink/60">Pro-rata first month.</p>
                {localPayment ? (
                  <>
                    <p className="mt-2 text-xs font-medium text-ink/70">Status: {PAYMENT_STATUS_LABEL[localPayment.status] ?? localPayment.status}</p>
                    {localPayment.charge_date && <p className="mt-1 text-xs text-ink/50">Expected collection date: {new Date(localPayment.charge_date).toLocaleDateString("en-GB")}</p>}
                  </>
                ) : (
                  <p className="mt-2 text-xs text-ink/50">Not yet submitted to GoCardless.</p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-ink/10 bg-white p-4">
              <p className="text-sm font-medium text-ink">
                {/* Once a real Subscription exists, its own committed amount_minor is the truthful figure -- not the (possibly-since-changed) preview. */}
                Ongoing membership:{" "}
                {(() => {
                  const amount = localSubscription?.amount_minor ?? preview?.monthly_amount_minor
                  return amount != null ? `${formatMinorUnits(amount)} / month` : "—"
                })()}
              </p>
              <p className="mt-1 text-xs text-ink/60">Collected on the 1st of each month.</p>
              <p className="mt-2 text-xs font-medium text-ink/70">{localSubscription ? `Status: ${GC_SUBSCRIPTION_STATUS_LABEL[localSubscription.status] ?? localSubscription.status}` : "Not yet set up."}</p>
            </div>

            {!localSubscription && <ActivateMembershipButton playerId={playerId} />}
            {localSubscription && isOwnPayer && payerRow?.id && <CancelOwnMembershipButton playerId={playerId} playerName={`${player.first_name} ${player.surname}`} />}
          </div>
        ) : billingRequest ? (
          <div className="rounded-lg border border-amber-600/30 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">Direct Debit setup started</p>
            <p className="mt-1 text-xs text-ink/70">GoCardless hasn&rsquo;t confirmed your mandate yet. Refresh this page once you&rsquo;ve completed their secure setup page.</p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-4 text-center text-sm text-ink/55">You&rsquo;re set as the responsible payer for {player.first_name}. Set up Direct Debit below to activate the subscription.</p>
        )}
      </div>
    </div>
  )
}

function BackLink({ playerId }: { playerId: string }) {
  return (
    <Link href={`/parent/players/${playerId}/access`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
      <ChevronLeft className="size-4" />
      Back
    </Link>
  )
}

/** Ordinal wording for the truthful declaration -- never exposes another child's own financial details, just the ordinal and discount. */
function ordinalWord(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"
  return `${n}${suffix}`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink/50">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  )
}
