"use client"

import { useId, useState } from "react"
import { describeSiblingRule, SIBLING_ORDINALS, siblingRuleInput, type SiblingDiscountType } from "@ovalball/contracts/club/finance"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import { saveSiblingDiscountRule } from "./actions"
import { ARIA_DISABLED_LOOK, SectionNotice, useWarnBeforeLeaving, type SectionNoticeValue } from "./membership-parts"

export interface SiblingRuleRow {
  ordinal: number
  discountType: "NONE" | "PERCENTAGE" | "FIXED"
  discountValue: number
}

const ORDINAL_WORD: Record<number, string> = { 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th" }

type RuleDraft = { type: SiblingDiscountType; value: string }

function draftFor(rule: SiblingRuleRow | null): RuleDraft {
  return { type: rule?.discountType ?? "NONE", value: rule ? String(rule.discountType === "PERCENTAGE" ? rule.discountValue : rule.discountValue / 100) : "" }
}

/** Whether a rule's draft says something other than what is saved. An amount that cannot be read is a change. */
function changed(draft: RuleDraft, saved: SiblingRuleRow | null): boolean {
  if (draft.type !== (saved?.discountType ?? "NONE")) return true
  if (draft.type === "NONE") return false
  const read = siblingRuleInput(draft.type, draft.value)
  return !read.ok || read.discountValue !== (saved?.discountValue ?? 0)
}

/**
 * Sibling discount configuration, one row per ordinal. Ordinal-rule model (not hardcoded to exactly 2nd/3rd) covers
 * every realistic case for a youth rugby club without an unbounded "add another rule" control.
 *
 * ONE dirty-tracked Save Changes / Discard for all five rules (the owner's standing preference), with a warning
 * before leaving while anything is unsaved. Save checks every changed rule with the same rules as before and saves
 * nothing while one cannot be read; then each changed rule -- and only a changed one -- goes through the same
 * `saveSiblingDiscountRule` door, one call per rule, which re-checks authority on the server. A rule's change is
 * still append-only/versioned there: it affects only new enrolments from the moment it is saved, never re-pricing an
 * existing member. What the save did is said once, beside the buttons.
 */
export function SiblingDiscountPanel({ programmeId, clubId, rules }: { programmeId: string; clubId: string; rules: SiblingRuleRow[] }) {
  const titleId = useId()
  const idBase = useId()
  const savedFor = (ordinal: number) => rules.find((r) => r.ordinal === ordinal) ?? null
  const [drafts, setDrafts] = useState<Record<number, RuleDraft>>(() => Object.fromEntries(SIBLING_ORDINALS.map((o) => [o, draftFor(rules.find((r) => r.ordinal === o) ?? null)])))
  const [problems, setProblems] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<SectionNoticeValue | null>(null)

  // When the server's rules change (after a save), a rule that now matches them takes the saved form; a rule still
  // different -- one that could not be saved, or an edit not yet saved -- stays the person's. Adjusted while
  // rendering (React's pattern for state that follows a prop), not in an effect.
  const [seenRules, setSeenRules] = useState(rules)
  if (rules !== seenRules) {
    setSeenRules(rules)
    setDrafts((current) =>
      Object.fromEntries(
        SIBLING_ORDINALS.map((o) => {
          const saved = rules.find((r) => r.ordinal === o) ?? null
          const mine = current[o] ?? draftFor(saved)
          return [o, changed(mine, saved) ? mine : draftFor(saved)]
        })
      )
    )
  }

  const changedOrdinals = SIBLING_ORDINALS.filter((o) => changed(drafts[o] ?? draftFor(null), savedFor(o)))
  const dirty = changedOrdinals.length > 0
  useWarnBeforeLeaving(dirty)

  function edit(ordinal: number, next: RuleDraft) {
    setDrafts((d) => ({ ...d, [ordinal]: next }))
    setProblems((p) => {
      const rest = { ...p }
      delete rest[ordinal]
      return rest
    })
    setNotice(null)
  }

  function discard() {
    setDrafts(Object.fromEntries(SIBLING_ORDINALS.map((o) => [o, draftFor(savedFor(o))])))
    setProblems({})
    setNotice(null)
  }

  async function save() {
    if (!dirty || saving) return
    setNotice(null)
    // Every changed rule is checked first, with the same rules as before; nothing is saved while one cannot be.
    const checked = changedOrdinals.map((o) => ({ ordinal: o, type: drafts[o]!.type, read: siblingRuleInput(drafts[o]!.type, drafts[o]!.value) }))
    const unreadable: Record<number, string> = {}
    for (const c of checked) if (!c.read.ok) unreadable[c.ordinal] = c.read.problem
    setProblems(unreadable)
    const firstUnreadable = checked.find((c) => !c.read.ok)
    if (firstUnreadable) {
      document.getElementById(`${idBase}-${firstUnreadable.ordinal}-value`)?.focus()
      return
    }

    setSaving(true)
    const refused: Record<number, string> = {}
    for (const c of checked) {
      if (!c.read.ok) continue
      const result = await saveSiblingDiscountRule(programmeId, clubId, c.ordinal, c.type, c.read.discountValue)
      if (!result.ok) refused[c.ordinal] = result.error
    }
    setSaving(false)

    const failed = Object.keys(refused).length
    setProblems(refused)
    if (failed === 0) {
      setNotice({ tone: "ok", text: checked.length === 1 ? "Sibling discount saved. It applies to new enrolments from today." : "Sibling discounts saved. They apply to new enrolments from today." })
    } else if (failed < checked.length) {
      setNotice({ tone: "error", text: "Some changes could not be saved. The reason is shown beside each one; the other changes are saved." })
    } else {
      setNotice({ tone: "error", text: failed === 1 ? "The change could not be saved. The reason is shown beside it." : "The changes could not be saved. The reason is shown beside each one." })
    }
  }

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-ink/10 bg-white p-5 md:p-6">
      <h2 id={titleId} className="text-base font-semibold text-ink">
        Sibling Discounts
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">
        A discount for the 2nd, 3rd… child from the same paying family, based on how many of their children are already enrolled. It applies automatically at enrolment, and the family sees why before they agree to anything. A change reaches new enrolments from today; it never
        re-prices an existing member.
      </p>
      <ul className="mt-4 divide-y divide-ink/10 border-y border-ink/10">
        {SIBLING_ORDINALS.map((ordinal) => (
          <SiblingRule
            key={ordinal}
            idBase={`${idBase}-${ordinal}`}
            ordinal={ordinal}
            draft={drafts[ordinal] ?? draftFor(null)}
            saved={savedFor(ordinal)}
            problem={problems[ordinal] ?? null}
            disabled={saving}
            onChange={(next) => edit(ordinal, next)}
          />
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button className={`h-11 px-5 sm:h-9 ${ARIA_DISABLED_LOOK}`} focusableWhenDisabled disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        {dirty && (
          <Button variant="outline" className="h-11 sm:h-9" disabled={saving} onClick={discard}>
            Discard
          </Button>
        )}
      </div>
      <SectionNotice notice={notice} />
    </section>
  )
}

const CONTROL = "mt-1.5 h-11 rounded-lg border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-3 focus-visible:ring-pitch-400/40 disabled:opacity-60 sm:h-9"

/**
 * One rule as a divided row. Every control is bound to its visible label, and its accessible name also carries the
 * row's own name ("2nd Child Discount Type"), so five rows never read as five identical fields.
 */
function SiblingRule({
  idBase,
  ordinal,
  draft,
  saved,
  problem,
  disabled,
  onChange,
}: {
  idBase: string
  ordinal: number
  draft: RuleDraft
  saved: SiblingRuleRow | null
  problem: string | null
  disabled: boolean
  onChange: (next: RuleDraft) => void
}) {
  const nameId = `${idBase}-name`
  const typeId = `${idBase}-type`
  const valueId = `${idBase}-value`
  const problemId = `${idBase}-problem`
  return (
    <li className="flex flex-wrap items-end gap-x-4 gap-y-3 py-3">
      <div className="min-w-[6rem]">
        <p id={nameId} className="text-sm font-medium text-ink">{`${ORDINAL_WORD[ordinal] ?? `${ordinal}th`} Child`}</p>
        {saved && <p className="mt-0.5 text-xs text-ink-muted">{`Current: ${describeSiblingRule(saved)}`}</p>}
      </div>
      <div>
        <Label id={`${typeId}-label`} htmlFor={typeId} className="text-ink/80">
          Discount Type
        </Label>
        <select
          id={typeId}
          aria-labelledby={`${nameId} ${typeId}-label`}
          value={draft.type}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, type: e.target.value as SiblingDiscountType })}
          className={`block ${CONTROL}`}
        >
          <option value="NONE">No discount</option>
          <option value="PERCENTAGE">Percentage</option>
          <option value="FIXED">Fixed £</option>
        </select>
      </div>
      {draft.type !== "NONE" && (
        <div>
          <Label id={`${valueId}-label`} htmlFor={valueId} className="text-ink/80">
            {draft.type === "PERCENTAGE" ? "Percent Off" : "Amount Off (£)"}
          </Label>
          <input
            id={valueId}
            aria-labelledby={`${nameId} ${valueId}-label`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            type="number"
            min="0"
            max={draft.type === "PERCENTAGE" ? "100" : undefined}
            step={draft.type === "PERCENTAGE" ? "1" : "0.01"}
            value={draft.value}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
            className={`block w-28 tabular-nums aria-[invalid=true]:border-destructive ${CONTROL}`}
          />
        </div>
      )}
      {problem && (
        <p id={problemId} className="w-full text-xs text-destructive-text">
          {problem}
        </p>
      )}
    </li>
  )
}
