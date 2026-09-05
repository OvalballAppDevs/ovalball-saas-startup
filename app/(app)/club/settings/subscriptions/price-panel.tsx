"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { formatMinorUnits, poundsToMinorUnits } from "@/lib/payments/domain/money"

import { setSubscriptionPrice } from "./actions"

interface PricingRow {
  id: string
  amount_minor: number
  effective_from: string
}

/**
 * Pricing is append-only and effective-dated -- there is no "edit the
 * current price" control, only "schedule a new price from a future
 * date." Shows current + full history so a price change's consequence
 * (existing obligations keep their historical amount) is visible, not
 * hidden.
 */
export function PricePanel({ programmeId, clubId, currentAmountMinor, priceHistory }: { programmeId: string; clubId: string; currentAmountMinor: number | null; priceHistory: PricingRow[] }) {
  const [showForm, setShowForm] = useState(false)
  const [newAmount, setNewAmount] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const pounds = Number(newAmount)
    if (!Number.isFinite(pounds) || pounds <= 0) {
      setError("Enter a valid amount greater than £0.")
      return
    }
    if (!effectiveFrom) {
      setError("Choose an effective-from date.")
      return
    }
    setStatus("saving")
    setError(null)
    const result = await setSubscriptionPrice(programmeId, clubId, poundsToMinorUnits(pounds), effectiveFrom)
    if (result.ok) {
      setShowForm(false)
      setNewAmount("")
      setEffectiveFrom("")
      setStatus("idle")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink/50">Current monthly amount</p>
          <p className="mt-0.5 text-2xl font-medium tabular-nums text-ink">{currentAmountMinor !== null ? formatMinorUnits(currentAmountMinor) : "Not set"}</p>
        </div>
        {!showForm && (
          <Button type="button" variant="outline" className="h-9" onClick={() => setShowForm(true)}>
            {currentAmountMinor !== null ? "Schedule a price change" : "Set price"}
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mt-4 rounded-lg border border-ink/10 bg-chalk p-3">
          <p className="text-xs text-ink/55">
            Existing subscribers keep paying their current price -- historical months already billed never change, and this does not alter any already-live Direct Debit Subscription. Only new enrolments (created on or after this date) use the new price. Migrating an existing
            subscriber to a new price is a separate, deliberate action, not an automatic consequence of this change.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new-amount" className="text-ink/80">
                New monthly amount (£)
              </Label>
              <input id="new-amount" type="number" min="0.01" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600" />
            </div>
            <div>
              <Label htmlFor="effective-from" className="text-ink/80">
                Effective from
              </Label>
              <input id="effective-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600" />
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button type="button" className="h-9" disabled={status === "saving"} onClick={handleSubmit}>
              {status === "saving" ? "Saving…" : "Apply price change"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {priceHistory.length > 0 && (
        <div className="mt-4 border-t border-ink/10 pt-3">
          <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Price history</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {priceHistory.map((row) => (
              <li key={row.id} className="flex justify-between tabular-nums text-ink/70">
                <span>From {new Date(row.effective_from).toLocaleDateString("en-GB")}</span>
                <span>{formatMinorUnits(row.amount_minor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
