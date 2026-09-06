"use client"

import Link from "next/link"
import { useId } from "react"

import { cn } from "@/lib/utils"
import { REQUIRED_CONSENTS, type ConsentId } from "@/lib/legal/required-consents"

/**
 * The required policy acceptances, as three separate ticks.
 *
 * Deliberately not one bundled "I agree to everything": each policy is
 * confirmed, versioned and auditable on its own, so a later question about
 * which version of the Safeguarding Policy someone read has an answer.
 *
 * The three are not the same legal event. Terms is an AGREEMENT (a
 * contract, recorded in terms_acceptances); Privacy and Safeguarding are
 * ACKNOWLEDGEMENTS that a published document was read (recorded in
 * policy_acknowledgements, and explicitly not consent to processing). The
 * wording of each tick follows its own kind -- see
 * lib/legal/required-consents.ts.
 *
 * Every box starts unchecked and stays unchecked until the person acts.
 * Nothing here is pre-ticked, nothing is hidden in small grey type, and no
 * optional marketing consent is smuggled into the group -- there is no
 * marketing consent in this product at all.
 *
 * The policy name is a real link that opens in a new tab, so reading a
 * policy never destroys a partly-completed form. The link sits inside the
 * label but stops the click from toggling the box, which is the one place
 * a nested interactive element needs handling rather than avoiding.
 */
export function PolicyConsent({
  accepted,
  onChange,
  className,
}: {
  accepted: Record<string, boolean>
  onChange: (id: ConsentId, value: boolean) => void
  className?: string
}) {
  const groupId = useId()

  return (
    <fieldset className={cn("rounded-xl border border-ink/10 bg-white p-4", className)}>
      <legend className="px-1 text-xs font-medium tracking-[0.08em] text-forest-800 uppercase">
        Before you continue
      </legend>
      <p className="mt-1 text-sm text-ink/60">
        Please review each of these to create your account.
      </p>

      <div className="mt-3.5 flex flex-col gap-3">
        {REQUIRED_CONSENTS.map((consent) => {
          const id = `${groupId}-${consent.id}`
          return (
            <div key={consent.id} className="flex items-start gap-3">
              <input
                id={id}
                type="checkbox"
                checked={accepted[consent.id] === true}
                onChange={(event) => onChange(consent.id, event.target.checked)}
                className="mt-0.5 size-[18px] shrink-0 rounded border-ink/30 text-pitch-600 accent-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
              />
              <label htmlFor={id} className="text-sm leading-relaxed text-ink/80">
                {/* Wording follows the legal event: you AGREE to a contract,
                    you have READ a notice. Saying "accept" for the Privacy
                    Notice would imply consent to processing that Ovalball
                    does not rely on consent for. */}
                {consent.statement}{" "}
                <Link
                  href={consent.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  // The link is inside the label, so a click would otherwise
                  // toggle the checkbox as well as open the policy.
                  onClick={(event) => event.stopPropagation()}
                  className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                >
                  {consent.label}
                </Link>
                <span className="sr-only"> (opens in a new tab)</span>
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
