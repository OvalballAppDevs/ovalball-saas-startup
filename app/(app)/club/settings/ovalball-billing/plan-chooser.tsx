"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { choosePlan } from "./actions"

export interface PlanCard {
  code: string
  name: string
  description: string | null
  priceLabel: string
  status: "available" | "coming_soon" | "retired"
  purchasable: boolean
  /**
   * True when this plan grants no entitlement the purchasable plan does not
   * already grant, and the name of that plan. Resolved from the database,
   * never asserted in copy: the sentence stops appearing the moment it stops
   * being true.
   */
  addsNothingYet: boolean
  comparedWithPlanName: string | null
}

/**
 * Choosing a plan.
 *
 * A plan that cannot be bought gets **no button at all** — not a greyed-out
 * one. A disabled "Choose Pro" reads as "you are being withheld from
 * something", which is unpleasant and, here, untrue: Pro includes nothing
 * Standard does not yet, and the honest sentence is better than a blocked
 * purchase.
 */
export function PlanChooser({
  plans,
  currentPlanCode,
  canManage,
}: {
  plans: PlanCard[]
  currentPlanCode: string | null
  canManage: boolean
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl text-ink">Plans</h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => (
          <PlanCardView
            key={plan.code}
            plan={plan}
            isCurrent={plan.code === currentPlanCode}
            canManage={canManage}
          />
        ))}
      </div>
    </section>
  )
}

function PlanCardView({
  plan,
  isCurrent,
  canManage,
}: {
  plan: PlanCard
  isCurrent: boolean
  canManage: boolean
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const unavailable = !plan.purchasable

  async function handleChoose() {
    setStatus("saving")
    setError(null)
    const result = await choosePlan(plan.code)
    if (result.ok) {
      setStatus("idle")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div
      className={`flex flex-col rounded-lg border bg-white p-5 ${
        isCurrent ? "border-forest-800" : "border-ink/10"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className={`font-display text-lg ${unavailable ? "text-ink/60" : "text-ink"}`}>{plan.name}</h3>
        <p className={`text-sm tabular-nums ${unavailable ? "text-ink/50" : "text-ink/80"}`}>{plan.priceLabel}</p>
      </div>

      {plan.status === "coming_soon" ? (
        <p className="mt-1 text-sm text-ink/55">Coming soon</p>
      ) : isCurrent ? (
        <p className="mt-1 text-sm font-medium text-forest-800">Your current plan</p>
      ) : null}

      {plan.description ? (
        <p className={`mt-3 text-sm leading-relaxed ${unavailable ? "text-ink/55" : "text-ink/70"}`}>
          {plan.description}
        </p>
      ) : null}

      {/* The honest sentence, in place of a disabled button. It is true, and
          the Phase E test suite fails the moment it stops being true. */}
      {unavailable && plan.addsNothingYet && plan.comparedWithPlanName ? (
        <p className="mt-3 text-sm leading-relaxed text-ink/55">
          {plan.name} doesn&rsquo;t include anything {plan.comparedWithPlanName} doesn&rsquo;t yet.
          When it does, you&rsquo;ll be able to switch.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {plan.purchasable && !isCurrent && canManage ? (
        <div className="mt-5">
          <Button type="button" className="h-9" disabled={status === "saving"} onClick={handleChoose}>
            {status === "saving" ? "Choosing…" : `Choose ${plan.name}`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
