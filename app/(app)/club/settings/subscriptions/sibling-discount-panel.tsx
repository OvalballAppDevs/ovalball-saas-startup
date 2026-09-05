"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { formatMinorUnits, poundsToMinorUnits } from "@/lib/payments/domain/money"

import { saveSiblingDiscountRule } from "./actions"

export interface SiblingRuleRow {
  ordinal: number
  discountType: "NONE" | "PERCENTAGE" | "FIXED"
  discountValue: number
}

const ORDINAL_WORD: Record<number, string> = { 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th" }

/**
 * Sibling discount configuration, one row per ordinal. Ordinal-rule model
 * (not hardcoded to exactly 2nd/3rd) covers every realistic case for a
 * youth rugby club without an unbounded "add another rule" control. Each
 * rule saves immediately and independently, matching PricePanel's own
 * append-only/versioned save pattern -- a change affects only new
 * enrolments from the moment it's saved, never re-pricing an existing member.
 */
export function SiblingDiscountPanel({ programmeId, clubId, rules }: { programmeId: string; clubId: string; rules: SiblingRuleRow[] }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-sm font-medium text-ink">Sibling discounts</p>
      <p className="mt-1 text-xs text-ink/50">
        A discount for the 2nd, 3rd... child from the same paying family, based on how many of their children are already actively enrolled in this membership. Applies automatically at enrolment -- the Parent sees exactly why before they authorize anything. Changing a rule only
        affects NEW enrolments from today; it never re-prices an existing member.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {[2, 3, 4, 5, 6].map((ordinal) => (
          <SiblingRuleRow key={ordinal} programmeId={programmeId} clubId={clubId} ordinal={ordinal} current={rules.find((r) => r.ordinal === ordinal) ?? null} />
        ))}
      </div>
    </div>
  )
}

function SiblingRuleRow({ programmeId, clubId, ordinal, current }: { programmeId: string; clubId: string; ordinal: number; current: SiblingRuleRow | null }) {
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENTAGE" | "FIXED">(current?.discountType ?? "NONE")
  const [value, setValue] = useState(current ? String(current.discountType === "PERCENTAGE" ? current.discountValue : current.discountValue / 100) : "")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    let discountValue = 0
    if (discountType === "PERCENTAGE") {
      discountValue = Number(value)
      if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100) {
        setError("Percentage must be between 0 and 100.")
        return
      }
    } else if (discountType === "FIXED") {
      const pounds = Number(value)
      if (!Number.isFinite(pounds) || pounds < 0) {
        setError("Amount must be £0 or more.")
        return
      }
      discountValue = poundsToMinorUnits(pounds)
    }
    setStatus("saving")
    const result = await saveSiblingDiscountRule(programmeId, clubId, ordinal, discountType, discountValue)
    if (result.ok) {
      setStatus("idle")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-ink/10 p-3">
      <div className="min-w-[4rem]">
        <p className="text-sm font-medium text-ink">{ORDINAL_WORD[ordinal] ?? `${ordinal}th`} child</p>
        {current && (
          <p className="mt-0.5 text-xs text-ink/45">
            Current: {current.discountType === "NONE" ? "No discount" : current.discountType === "PERCENTAGE" ? `${current.discountValue}% off` : `${formatMinorUnits(current.discountValue)} off`}
          </p>
        )}
      </div>
      <div>
        <Label className="text-ink/80">Discount type</Label>
        <select
          value={discountType}
          onChange={(e) => setDiscountType(e.target.value as "NONE" | "PERCENTAGE" | "FIXED")}
          className="mt-1 h-9 rounded-lg border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          <option value="NONE">No discount</option>
          <option value="PERCENTAGE">Percentage</option>
          <option value="FIXED">Fixed £</option>
        </select>
      </div>
      {discountType !== "NONE" && (
        <div>
          <Label className="text-ink/80">{discountType === "PERCENTAGE" ? "Percent off" : "Amount off (£)"}</Label>
          <input
            type="number"
            min="0"
            max={discountType === "PERCENTAGE" ? "100" : undefined}
            step={discountType === "PERCENTAGE" ? "1" : "0.01"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 h-9 w-28 rounded-lg border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
        </div>
      )}
      <Button type="button" size="sm" className="h-9" disabled={status === "saving"} onClick={handleSave}>
        {status === "saving" ? "Saving…" : "Save"}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  )
}
