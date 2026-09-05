"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { calculateFirstMonthProration, isFirstMonthProrated } from "@/lib/payments/domain/proration"
import { formatMinorUnits } from "@/lib/payments/domain/money"

import { saveSubscriptionProgramme, type SubscriptionProgrammeSettings } from "./actions"

function equal(a: SubscriptionProgrammeSettings, b: SubscriptionProgrammeSettings) {
  return a.enabled === b.enabled && a.collectionDay === b.collectionDay && a.platformFeeMode === b.platformFeeMode && a.firstPaymentPolicy === b.firstPaymentPolicy
}

// A representative "joins mid-month" date for the illustrative example --
// the 16th of the current month. This is a CLIENT-SIDE illustration
// reacting instantly to an unsaved radio choice (calculateFirstMonthProration
// is numerically identical to the SQL function it mirrors) -- the
// authoritative, server-computed preview for a REAL enrolment is
// preview_first_payment(), used on the Parent Subscription page against
// the actually-saved policy.
function exampleStartDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-16`
}

/**
 * The Club's own first-payment policy choice -- never a Parent choice.
 * Both options are real, fully-implemented policies (not one enabled/one
 * placeholder) -- configure_subscription_programme() accepts exactly
 * PRORATE_CURRENT_MONTH or NEXT_COLLECTION_DAY and rejects anything else
 * server-side.
 */
export function SubscriptionSettingsForm({ clubId, monthlyAmountMinor, initial }: { clubId: string; monthlyAmountMinor: number | null; initial: SubscriptionProgrammeSettings }) {
  const [saved, setSaved] = useState(initial)
  const [form, setForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const dirty = !equal(form, saved)

  const example = useMemo(() => {
    if (monthlyAmountMinor === null) return null
    const startDate = exampleStartDate()
    if (form.firstPaymentPolicy === "PRORATE_CURRENT_MONTH") {
      const p = calculateFirstMonthProration(startDate, monthlyAmountMinor)
      return {
        firstAmount: p.proratedAmountMinor,
        coversLabel: `${startDate.slice(8, 10)}–${p.totalDaysInMonth} ${new Date(startDate).toLocaleDateString("en-GB", { month: "long" })}`,
        thenFrom: "1st of the following month",
        noCharge: false,
      }
    }
    return { firstAmount: monthlyAmountMinor, coversLabel: null, thenFrom: null, noCharge: isFirstMonthProrated(startDate) }
  }, [form.firstPaymentPolicy, monthlyAmountMinor])

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await saveSubscriptionProgramme(clubId, form)
    if (result.ok) {
      setSaved(form)
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  function handleDiscard() {
    setForm(saved)
    setStatus("idle")
    setError(null)
  }

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Enable Club Subscriptions</p>
          <p className="mt-1 text-xs text-ink/50">Turning this on does not immediately collect money -- GoCardless must also be connected and verified, and a price must be set. See the status panel above for what&rsquo;s still needed.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          aria-label="Enable Club Subscriptions"
          onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
          className={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${form.enabled ? "bg-pitch-600" : "bg-ink/15"}`}
        >
          <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${form.enabled ? "translate-x-5" : ""}`} />
        </button>
      </div>

      <div>
        <Label htmlFor="collection-day" className="text-ink/80">
          Collection day
        </Label>
        <p className="mt-1 text-xs text-ink/50">Members are shown &ldquo;Scheduled for collection on the {form.collectionDay === 1 ? "1st" : `${form.collectionDay}th`}&rdquo; -- Direct Debit is asynchronous, so this is when collection is submitted, not a guaranteed same-day payout.</p>
        <select id="collection-day" value={form.collectionDay} onChange={(e) => setForm((f) => ({ ...f, collectionDay: Number(e.target.value) }))} className="mt-2 h-11 w-full max-w-[10rem] rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-sm font-medium text-ink">First payment policy</p>
        <p className="mt-1 text-xs text-ink/50">When a player joins part-way through a month:</p>

        <div className="mt-3 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink/10 p-3 has-[:checked]:border-pitch-600 has-[:checked]:bg-pitch-50">
            <input type="radio" name="first-payment-policy" checked={form.firstPaymentPolicy === "PRORATE_CURRENT_MONTH"} onChange={() => setForm((f) => ({ ...f, firstPaymentPolicy: "PRORATE_CURRENT_MONTH" }))} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium text-ink">Charge a pro-rata amount</span>
              <span className="mt-0.5 block text-xs text-ink/55">Charge only for the remaining days of their first month. Full monthly payments then continue from the next 1st.</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink/10 p-3 has-[:checked]:border-pitch-600 has-[:checked]:bg-pitch-50">
            <input type="radio" name="first-payment-policy" checked={form.firstPaymentPolicy === "NEXT_COLLECTION_DAY"} onChange={() => setForm((f) => ({ ...f, firstPaymentPolicy: "NEXT_COLLECTION_DAY" }))} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium text-ink">Start payments next month</span>
              <span className="mt-0.5 block text-xs text-ink/55">No payment is due for the remaining part of the current month. The first full monthly payment is scheduled for the next 1st.</span>
            </span>
          </label>
        </div>

        {example && (
          <div className="mt-3 rounded-lg border border-ink/10 bg-chalk p-3 text-xs text-ink/70">
            <p className="font-medium text-ink">Example -- a player joining on the 16th of this month:</p>
            {form.firstPaymentPolicy === "PRORATE_CURRENT_MONTH" ? (
              <p className="mt-1">
                First payment <strong className="tabular-nums text-ink">{formatMinorUnits(example.firstAmount)}</strong>
                {example.coversLabel && <> (covers {example.coversLabel})</>}, then <strong className="tabular-nums text-ink">{formatMinorUnits(monthlyAmountMinor!)}</strong> per month from the following 1st.
              </p>
            ) : (
              <p className="mt-1">
                No payment due this month. First payment <strong className="tabular-nums text-ink">{formatMinorUnits(example.firstAmount)}</strong> on the following 1st, then every month.
              </p>
            )}
          </div>
        )}
        {!example && <p className="mt-3 text-xs text-ink/40">Set a monthly price below to see a worked example.</p>}

        <p className="mt-3 text-xs text-ink/40">Changing this applies to new memberships from now on -- it never alters payments already scheduled, collected, or owed.</p>
      </div>

      <div>
        <Label htmlFor="platform-fee-mode" className="text-ink/80">
          Platform fee model
        </Label>
        <p className="mt-1 text-xs text-ink/50">How Ovalball&rsquo;s own platform fee (if any) is applied. Only models confirmed compliant and commercially approved are offered -- see the Finance Dashboard for what this means for your club&rsquo;s payouts.</p>
        <select id="platform-fee-mode" value={form.platformFeeMode} onChange={(e) => setForm((f) => ({ ...f, platformFeeMode: e.target.value as SubscriptionProgrammeSettings["platformFeeMode"] }))} className="mt-2 h-11 w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600">
          <option value="NONE">No platform fee</option>
          <option value="PARTNER_REVENUE_SHARE">Partner revenue share (Ovalball is paid separately by GoCardless, not the club)</option>
        </select>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3 border-t border-ink/10 pt-4">
        <Button type="button" className="h-10" disabled={!dirty || status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        {dirty && status !== "saving" && (
          <Button type="button" variant="ghost" className="h-10" onClick={handleDiscard}>
            Discard
          </Button>
        )}
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
    </div>
  )
}
