"use client"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Pencil, Users } from "lucide-react"
import {
  CLUB_MEMBERSHIP_TERMS_STATUS,
  clubMembershipTermsPoints,
  CONNECTION_STATE_LABEL,
  CONNECTION_STATE_TONE,
  feePercent,
  firstPaymentExampleSentences,
  GOCARDLESS_ACCESS_SENTENCE,
  groupTeams,
  membershipMoneyLine,
  readinessSentence,
  receiptAnnouncement,
  type ConnectionState,
  type ConnectionTone,
  type FeeBearer,
  type FirstPaymentExample,
  type MembershipTeam,
  type ReadinessItem,
  type SetupFirstPaymentPolicy,
  type SetupMembership,
} from "@ovalball/contracts/membership/setup"
import { formatFinanceDate, formatMinorUnits, ordinalWord } from "@ovalball/contracts/club/finance"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

import { disconnectGoCardless, firstPaymentExampleAction, getActiveSubscriptionImpact } from "./actions"

/**
 * CLUB MEMBERSHIPS ON THE WEBSITE -- the pieces the setup journey and Membership Settings share (Part 1).
 *
 * The same server answer and the same words as the phone (`@ovalball/contracts/membership/setup`); laid out for a
 * desk. Every figure is the server's: the receipt draws what `membership_first_payment_example` worked out and does
 * no fee arithmetic of its own.
 */

const CHIP: Record<ConnectionTone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-chalk text-ink-muted border-ink/15", dot: "bg-ink-muted" },
  moving: { chip: "bg-white text-rugby-700 border-mint-300", dot: "border-[1.5px] border-rugby-700 bg-transparent" },
  attention: { chip: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-700" },
  settled: { chip: "bg-mint-100 text-forest-800 border-mint-100", dot: "bg-pitch-600" },
}

/**
 * A primary button that is unavailable but says why (its reason is wired by aria-describedby) stays in the tab order:
 * it is rendered with `focusableWhenDisabled`, so it carries aria-disabled and does nothing when pressed. `disabled:`
 * no longer matches a button without the attribute, so the unavailable look is drawn from aria-disabled instead.
 */
export const ARIA_DISABLED_LOOK = "aria-disabled:pointer-events-none aria-disabled:opacity-50"

export function ToneChip({ label, tone, srLabel }: { label: string; tone: ConnectionTone; srLabel?: string }) {
  const shade = CHIP[tone]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${shade.chip}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${shade.dot}`} />
      {srLabel ? (
        <>
          <span className="sr-only">{srLabel}</span>
          <span aria-hidden="true">{label}</span>
        </>
      ) : (
        label
      )}
    </span>
  )
}

export function ConnectionChip({ state }: { state: ConnectionState }) {
  return <ToneChip label={CONNECTION_STATE_LABEL[state]} tone={CONNECTION_STATE_TONE[state]} srLabel={`GoCardless: ${CONNECTION_STATE_LABEL[state]}`} />
}

/** A white panel: the one surface every section of these pages sits on. */
export function Panel({ id, title, action, description, children, className = "" }: { id?: string; title?: string; action?: ReactNode; description?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`rounded-2xl border border-ink/10 bg-white p-5 md:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * What an action just did, said beside the section that did it. A success is polite and an error is said at once;
 * both regions are always in the page, so what appears in them is announced rather than merely drawn.
 */
export type SectionNoticeValue = { tone: "ok" | "error"; text: string }

export function SectionNotice({ notice, className = "mt-4" }: { notice: SectionNoticeValue | null; className?: string }) {
  return (
    <>
      <div role="status" aria-live="polite">
        {notice?.tone === "ok" && (
          <p className={`flex max-w-prose items-start gap-2 text-sm text-forest-800 ${className}`}>
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-pitch-600" />
            <span>{notice.text}</span>
          </p>
        )}
      </div>
      <div role="alert">
        {notice?.tone === "error" && (
          <p className={`flex max-w-prose items-start gap-2 text-sm text-destructive-text ${className}`}>
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{notice.text}</span>
          </p>
        )}
      </div>
    </>
  )
}

/** The owner's standing preference: one Save, one Discard, and a warning before leaving with changes unsaved. */
export function useWarnBeforeLeaving(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
}

// ---------------------------------------------------------------------------------------------------------------------
// THE MONEY RECEIPT -- what one month's money does, top to bottom.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The receipt is the one tinted thing on these pages: a background, no border. `caveat` is its own "Before
 * GoCardless's own fee." line; a caller that already says GoCardless's fees right beside it turns it off, so the
 * caveat is said once.
 */
export function MoneyReceipt({ example, bps, currency = "GBP", title, caveat = true }: { example: FirstPaymentExample; bps: number; currency?: string; title?: string; caveat?: boolean }) {
  const money = (minor: number) => formatMinorUnits(minor, currency)
  const pct = feePercent(bps)
  return (
    <figure className="rounded-xl bg-forest-800/[0.05] px-4 py-3">
      <figcaption className="text-xs text-ink-muted">{title ?? `On a ${money(example.monthlyAmountMinor)} monthly membership`}</figcaption>
      <dl className="mt-1 text-sm tabular-nums">
        <div className="flex items-baseline justify-between gap-4 py-1">
          <dt className="text-ink">Member pays</dt>
          <dd className="font-medium text-ink">{money(example.monthlyCollectMinor)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-1">
          <dt className="text-ink-muted">{`Ovalball's fee (${pct})`}</dt>
          <dd className="text-ink-muted">{`−${money(example.monthlyFeeMinor)}`}</dd>
        </div>
        <div className="my-1.5 border-t border-dashed border-ink/20" />
        <div className="flex items-baseline justify-between gap-4 py-1">
          <dt className="font-semibold text-ink">The club receives</dt>
          <dd className="text-lg font-semibold text-ink">{money(example.clubReceivesMonthlyBeforeGoCardlessMinor)}</dd>
        </div>
      </dl>
      {caveat && <p className="mt-0.5 text-xs text-ink-muted">Before GoCardless&rsquo;s own fee.</p>}
    </figure>
  )
}

/** The receipt's own shape while the server works it out: never a sentence that might be untrue. */
export function ReceiptPlaceholder() {
  return (
    <div aria-busy="true" aria-label="Working out the monthly figures" className="space-y-2 rounded-xl bg-forest-800/[0.05] px-4 py-3">
      <div className="h-3 w-2/3 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
      <div className="h-4 w-full animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
      <div className="h-4 w-full animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
      <div className="h-5 w-full animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
    </div>
  )
}

/**
 * The receipt's figures said once, politely, for a screen reader. It stays quiet about the figures the page opened
 * with (they are on screen to be read) and starts speaking once the person has changed something; it keeps the last
 * figures while a new answer is on its way, so the same figures are never said twice in a row.
 */
export function ReceiptAnnouncer({ example, announce }: { example: FirstPaymentExample | null | undefined; announce: boolean }) {
  const [said, setSaid] = useState("")
  const text = example
    ? receiptAnnouncement({ memberPaysMinor: example.monthlyCollectMinor, feeMinor: example.monthlyFeeMinor, clubReceivesMinor: example.clubReceivesMonthlyBeforeGoCardlessMinor })
    : null
  // Adjusted while rendering, not in an effect: the region takes new figures in the same pass that draws them.
  if (announce && text && text !== said) setSaid(text)
  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {said}
    </p>
  )
}

/**
 * The server's worked example for a draft, re-asked whenever the draft changes.
 *
 * An answer is kept with the inputs it was asked for, and only ever returned for the inputs on screen: while a
 * changed draft's answer is on its way the example is `undefined` (draw the placeholder), never the previous draft's
 * figures. `null` is the server having no example to give. `changedSinceOpening` turns true the first time the
 * inputs differ from the ones the page opened with, and stays true.
 */
export function useFirstPaymentExample(input: { clubId: string; monthlyAmountMinor: number; collectionDay: number; firstPaymentPolicy: SetupFirstPaymentPolicy; feeBearer: FeeBearer | null }): {
  example: FirstPaymentExample | null | undefined
  changedSinceOpening: boolean
} {
  const { clubId, monthlyAmountMinor, collectionDay, firstPaymentPolicy, feeBearer } = input
  const key = `${clubId}|${monthlyAmountMinor}|${collectionDay}|${firstPaymentPolicy}|${feeBearer ?? "-"}`
  const [answer, setAnswer] = useState<{ key: string; example: FirstPaymentExample | null } | null>(null)
  const [openingKey] = useState(key)
  const [changedSinceOpening, setChangedSinceOpening] = useState(false)
  if (!changedSinceOpening && key !== openingKey) setChangedSinceOpening(true)

  useEffect(() => {
    let current = true
    firstPaymentExampleAction({ clubId, monthlyAmountMinor, joinDate: localIso(new Date()), collectionDay, firstPaymentPolicy, feeBearer })
      .then((next) => {
        if (current) setAnswer({ key, example: next })
      })
      .catch(() => {
        if (current) setAnswer({ key, example: null })
      })
    return () => {
      current = false
    }
  }, [key, clubId, monthlyAmountMinor, collectionDay, firstPaymentPolicy, feeBearer])

  return { example: answer?.key === key ? answer.example : undefined, changedSinceOpening }
}

/**
 * The amount the examples use: the club's first priced membership, or a stated £10.00. In the setup journey, where
 * the club's own prices are the next step, the stated amount says so.
 */
export function exampleBasis(memberships: SetupMembership[], options: { pricesNext?: boolean } = {}): { amountMinor: number; heading: string } {
  const priced = memberships.find((m) => m.monthlyAmountMinor !== null && m.teams.length > 0) ?? memberships.find((m) => m.monthlyAmountMinor !== null)
  if (priced && priced.monthlyAmountMinor !== null) return { amountMinor: priced.monthlyAmountMinor, heading: `For example, on ${priced.name}` }
  return { amountMinor: 1000, heading: options.pricesNext ? "For example, on a £10.00 monthly membership (you set your own prices next)" : "For example, on a £10.00 monthly membership" }
}

/** The worked example in words: a plain block under the choice it explains, its sentences only once they are this draft's. */
export function FirstPaymentExampleBlock({ heading, example }: { heading: string; example: FirstPaymentExample | null | undefined }) {
  if (example === null) return null
  return (
    <div className="mt-4 max-w-prose border-l-2 border-ink/15 pl-4">
      <p className="text-sm font-medium text-ink">{heading}</p>
      {example ? (
        firstPaymentExampleSentences(example).map((line) => (
          <p key={line} className="text-sm text-ink-muted">
            {line}
          </p>
        ))
      ) : (
        <div aria-busy="true" aria-label="Working out the example" className="mt-1.5 space-y-1.5">
          <div className="h-3.5 w-11/12 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// CHOICES -- real radio inputs and checkboxes, drawn as cards.
// ---------------------------------------------------------------------------------------------------------------------

export function ChoiceCards<T extends string>({
  legend,
  options,
  value,
  onChange,
  disabled = false,
  columns = 1,
}: {
  legend: string
  options: { value: T; label: string; body: string }[]
  value: T | null
  onChange: (next: T) => void
  disabled?: boolean
  columns?: 1 | 2
}) {
  const name = useId()
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className={`grid gap-3 ${columns === 2 ? "md:grid-cols-2" : ""}`}>
        {options.map((option) => {
          const on = value === option.value
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-pitch-400/50 ${on ? "border-forest-800 bg-forest-800/[0.04]" : "border-ink/10 bg-white hover:border-ink/25"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input type="radio" name={name} value={option.value} checked={on} onChange={() => onChange(option.value)} className="peer sr-only" />
              <span aria-hidden="true" className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-forest-800" : "border-ink/30"}`}>
                {on && <span className="size-2.5 rounded-full bg-forest-800" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{option.label}</span>
                <span className="mt-0.5 block text-sm text-ink-muted">{option.body}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function CheckRow({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; description?: string | null; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-pitch-400/50 ${checked ? "border-forest-800 bg-forest-800/[0.04]" : "border-ink/10 bg-white hover:border-ink/25"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span aria-hidden="true" className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] ${checked ? "border-forest-800 bg-forest-800 text-white" : "border-ink/30"}`}>
        {checked && (
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.6">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  )
}

/** The 28 days every month has: on a desk, a plain select. */
export function CollectionDaySelect({ value, onChange, disabled = false, labelHidden = false }: { value: number; onChange: (day: number) => void; disabled?: boolean; labelHidden?: boolean }) {
  const id = useId()
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Hidden where a heading above already says "Collection Day": the select keeps its name for a screen reader. */}
      <label htmlFor={id} className={labelHidden ? "sr-only" : "text-sm font-medium text-ink"}>
        Collection Day
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-3 focus-visible:ring-pitch-400/40 sm:h-9"
      >
        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{`${ordinalWord(d)} of each month`}</option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// TERMS
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What the club agrees to. The point titles are always shown and their detail on request; the access Ovalball is
 * given to the club's GoCardless account is never folded away, and it is the last thing read before agreeing. The
 * wording's own status is a quiet last line of the detail, never between the terms and the agreement. `after` sits
 * with the agreement (Membership Settings puts its Agree button and what it said there). `agreeBelow` is for a page
 * that puts the box to tick beside the button it unlocks (the setup journey's Connect step): the panel then only
 * points to it, so the box and its button are always seen together.
 */
export function TermsPanel({
  title,
  bps,
  terms,
  clubName,
  agreed,
  onAgreedChange,
  canAgree,
  agreeBelow = false,
  after,
}: {
  title: string
  bps: number
  terms: { accepted: boolean; acceptedAt: string | null; acceptedByName: string | null }
  clubName: string
  agreed: boolean
  onAgreedChange: (next: boolean) => void
  canAgree: boolean
  agreeBelow?: boolean
  after?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const points = clubMembershipTermsPoints(bps)
  return (
    <Panel title={title} description={`What ${clubName} agrees to by collecting memberships through Ovalball.`}>
      <div id={detailsId}>
        <ul className="space-y-2">
          {points.map((point) => (
            <li key={point.title} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-forest-800" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{point.title}</span>
                {open && <span className="mt-0.5 block max-w-prose text-sm text-ink-muted">{point.body}</span>}
              </span>
            </li>
          ))}
        </ul>
        {open && <p className="mt-3 pl-4 text-xs text-ink-muted">{CLUB_MEMBERSHIP_TERMS_STATUS}</p>}
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-forest-800 hover:text-forest-950 focus-visible:ring-3 focus-visible:ring-pitch-400/50 focus-visible:outline-none sm:min-h-8"
      >
        {open ? "Show Less" : "Read the Details"}
        {open ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
      </button>
      <p className="mt-3 max-w-prose border-l-2 border-forest-800 pl-3 text-sm text-ink">{GOCARDLESS_ACCESS_SENTENCE}</p>
      <div className="mt-4 border-t border-ink/10 pt-4">
        {terms.accepted ? (
          <p className="flex items-center gap-2 text-sm text-ink">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-pitch-600" />
            {`Agreed by ${terms.acceptedByName ?? "the club"}${terms.acceptedAt ? ` on ${formatFinanceDate(terms.acceptedAt, "long")}` : ""}.`}
          </p>
        ) : canAgree ? (
          <CheckRow checked={agreed} onChange={onAgreedChange} label={`I agree on behalf of ${clubName}`} />
        ) : agreeBelow ? (
          <p className="max-w-prose text-sm text-ink-muted">{`Tick the box below, beside the button, to agree for ${clubName}.`}</p>
        ) : (
          <p className="max-w-prose text-sm text-ink-muted">Someone who can connect GoCardless or set up memberships agrees to these for the club.</p>
        )}
        {after}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// DISCONNECTING GOCARDLESS
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What a disconnect would leave running, as the clause the dialog adds to its description: the club's live figures
 * when this person may read them, and nothing otherwise. Read before the dialog opens, so its description is whole
 * when it is announced.
 */
export async function disconnectImpactClause(clubId: string): Promise<string> {
  const figures = await getActiveSubscriptionImpact(clubId)
  return figures
    ? ` Right now: ${figures.activeGoCardlessSubscriptions} live Direct Debit ${figures.activeGoCardlessSubscriptions === 1 ? "subscription" : "subscriptions"}, ${figures.activePayers} active ${figures.activePayers === 1 ? "payer" : "payers"}, ${figures.pendingObligations} pending ${figures.pendingObligations === 1 ? "payment" : "payments"}.`
    : ""
}

/**
 * DISCONNECT GOCARDLESS? -- the website's one disconnect, wherever it is offered: Membership Settings' words, a reason
 * recorded with the change, and its server action (`disconnectGoCardless`), which asks the GoCardless permission again
 * and revokes the club's token at GoCardless straight away. The reason starts empty each time the dialog opens.
 */
export function DisconnectGoCardlessDialog({
  clubId,
  open,
  impact,
  onClose,
  onDisconnected,
}: {
  clubId: string
  open: boolean
  /** From `disconnectImpactClause`. */
  impact: string
  onClose: () => void
  onDisconnected: () => void
}) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const reasonId = useId()

  function close() {
    setReason("")
    setProblem(null)
    onClose()
  }

  async function confirm() {
    setBusy(true)
    setProblem(null)
    const result = await disconnectGoCardless(clubId, reason.trim())
    setBusy(false)
    if (!result.ok) return setProblem(result.error)
    setReason("")
    onDisconnected()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect GoCardless?</DialogTitle>
          <DialogDescription>{`Ovalball stops using the club's GoCardless account straight away, and no new memberships or collections can be set up until it is connected again. Payment history stays. GoCardless may still collect payments it has already scheduled; cancel those in GoCardless if they should stop.${impact}`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="text-sm font-medium text-ink">
            Reason <span className="text-destructive-text">*</span>
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Recorded with the change"
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-3 focus-visible:ring-pitch-400/40"
          />
        </div>
        {problem && (
          <p role="alert" className="text-sm text-destructive-text">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-11 sm:h-9" onClick={close}>
            Keep Connected
          </Button>
          <Button variant="destructive" className="h-11 sm:h-9" disabled={busy || reason.trim().length === 0} onClick={() => void confirm()}>
            {busy ? "Disconnecting…" : "Disconnect GoCardless"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// WHAT ACTIVATE IS WAITING FOR
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What is left before Activate. An item opens the step that finishes it -- except waiting for GoCardless to verify,
 * which the club cannot hurry: that is plain text unless GoCardless has asked the club for something. `bare` is the
 * list alone, for a host that already says what it is (Review's Action Required panel).
 */
export function StillToDo({ missing, connection, onOpen, bare = false }: { missing: ReadinessItem[]; connection: ConnectionState; onOpen?: (item: ReadinessItem) => void; bare?: boolean }) {
  if (missing.length === 0) return null
  const list = (
    <ul className={bare ? "space-y-1" : "mt-2 space-y-1"}>
      {missing.map((item) => {
        const opens = onOpen && (item !== "VERIFY" || connection === "ACTION_REQUIRED")
        return (
          <li key={item}>
            {opens ? (
              <button type="button" onClick={() => onOpen(item)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left text-sm text-ink hover:text-forest-950 sm:min-h-8">
                <span>{readinessSentence(item, connection)}</span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-amber-800" />
              </button>
            ) : (
              <span className="flex min-h-8 items-center text-sm text-ink">{readinessSentence(item, connection)}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
  if (bare) return list
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
        <AlertTriangle aria-hidden="true" className="size-4" />
        Still to Do
      </p>
      {list}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// MEMBERSHIPS
// ---------------------------------------------------------------------------------------------------------------------

export function teamsSentence(teams: MembershipTeam[], limit = 4): string {
  if (teams.length === 0) return "No teams yet"
  const names = teams.map((t) => t.name)
  if (names.length <= limit) return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`
}

/**
 * One membership. A `card` where memberships sit in a grid of their own (the setup journey); a `row` inside a
 * section that already is the card (Membership Settings, where rows are divided rather than boxed). Its money line
 * is the server's figures under the club's saved fee arrangement, so pass the saved bearer, not a draft; likewise
 * `collection` is the club's SAVED collection settings, so the card says how and when it is collected, never a guess.
 */
export function MembershipCard({
  membership,
  currency = "GBP",
  feeBearer = null,
  onEdit,
  showHolders = false,
  history,
  variant = "card",
  collection = null,
}: {
  membership: SetupMembership
  currency?: string
  feeBearer?: FeeBearer | null
  onEdit?: () => void
  showHolders?: boolean
  history?: { id: string; amountMinor: number; effectiveFrom: string }[]
  variant?: "card" | "row"
  collection?: { day: number; firstPayment: string | null } | null
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const unpriced = membership.monthlyAmountMinor === null
  const moneyLine = membershipMoneyLine(membership, feeBearer)
  return (
    <article className={variant === "card" ? "flex h-full flex-col rounded-2xl border border-ink/10 bg-white p-5" : "flex flex-col"}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
          <Users className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink">{membership.name}</h3>
          <p className={`text-sm tabular-nums ${unpriced ? "text-amber-800" : "text-ink"}`}>{unpriced ? "No monthly price yet" : `${formatMinorUnits(membership.monthlyAmountMinor!, currency)} a month`}</p>
          {moneyLine && <p className="mt-0.5 text-xs text-ink-muted tabular-nums">{moneyLine}</p>}
        </div>
        {onEdit && (
          <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={onEdit} aria-label={`Edit ${membership.name}`}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        )}
      </div>
      {/* The label column is as wide as its longest label ("Joining Part-Way"), so no label breaks over two lines. */}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-muted">Applies To</dt>
        <dd className={membership.teams.length === 0 ? "text-amber-800" : "text-ink"}>{teamsSentence(membership.teams, 6)}</dd>
        {collection && (
          <>
            <dt className="text-ink-muted">Collected</dt>
            <dd className="text-ink">{`Monthly by Direct Debit, on the ${ordinalWord(collection.day)}`}</dd>
          </>
        )}
        {collection?.firstPayment && (
          <>
            <dt className="text-ink-muted">Joining Part-Way</dt>
            <dd className="text-ink">{collection.firstPayment}</dd>
          </>
        )}
        {membership.nextPrice && (
          <>
            <dt className="text-ink-muted">Next Price</dt>
            <dd className="text-ink tabular-nums">{`${formatMinorUnits(membership.nextPrice.amountMinor, currency)} a month from ${formatFinanceDate(membership.nextPrice.effectiveFrom, "long")}`}</dd>
          </>
        )}
        {showHolders && (
          <>
            <dt className="text-ink-muted">Members</dt>
            <dd className="text-ink">{membership.activeMemberships === 0 ? "Nobody yet" : `${membership.activeMemberships} paying`}</dd>
          </>
        )}
      </dl>
      {history && history.length > 0 && (
        <div className={variant === "card" ? "mt-auto border-t border-ink/10 pt-2" : "mt-2"}>
          <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)} className="mt-2 inline-flex min-h-11 w-full items-center justify-between text-sm font-medium text-forest-800 sm:min-h-8">
            Price History
            {historyOpen ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
          </button>
          {historyOpen && (
            <ul className="mt-1 space-y-1 text-sm tabular-nums">
              {history.map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span className="text-ink-muted">{`From ${formatFinanceDate(row.effectiveFrom, "long")}`}</span>
                  <span className="text-ink">{formatMinorUnits(row.amountMinor, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  )
}

export interface MembershipDraft {
  name: string
  monthlyAmountMinor: number
  teamIds: string[]
  priceFrom: string | null
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** "16", "16.5", "£16.50" → 1650; anything else → null. */
export function parsePounds(input: string): number | null {
  const cleaned = input.replace(/[£,\s]/g, "")
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

export function MembershipDialog({
  open,
  membership,
  teams,
  memberships,
  askPriceStart,
  saving,
  problem,
  onClose,
  onSave,
  onArchive,
}: {
  open: boolean
  membership: SetupMembership | null
  teams: (MembershipTeam & { productId: string | null })[]
  memberships: SetupMembership[]
  askPriceStart: boolean
  saving: boolean
  problem: string | null
  onClose: () => void
  onSave: (draft: MembershipDraft) => void
  onArchive?: () => void
}) {
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [start, setStart] = useState<"today" | "next" | "date">("today")
  const [startDate, setStartDate] = useState(localIso(new Date()))
  const [tried, setTried] = useState(false)
  const nameId = useId()
  const priceId = useId()
  const groupId = useId()

  // The fields start from the membership each time the dialog opens, or is opened on another one -- set while
  // rendering rather than in an effect, so its first frame already shows them. Nothing is reset while it stays open
  // on the same membership, so a refusal keeps what the person typed.
  const [filledFor, setFilledFor] = useState<{ open: boolean; membership: SetupMembership | null }>({ open: false, membership: null })
  if (filledFor.open !== open || filledFor.membership !== membership) {
    setFilledFor({ open, membership })
    if (open) {
      setName(membership?.name ?? "")
      const minor = membership?.monthlyAmountMinor ?? null
      setPrice(minor === null ? "" : minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2))
      setPicked(new Set(membership?.teams.map((t) => t.id) ?? []))
      setStart("today")
      setStartDate(localIso(new Date()))
      setTried(false)
    }
  }

  const owner = useMemo(() => new Map(memberships.map((m) => [m.id, m.name])), [memberships])
  // The Team Directory's groups, in its order; within a group, the server's order.
  const groups = useMemo(() => groupTeams(teams), [teams])
  const amount = parsePounds(price)
  const today = localIso(new Date())
  const nextMonth = (() => {
    const d = new Date()
    return localIso(new Date(d.getFullYear(), d.getMonth() + 1, 1))
  })()
  const priceChanged = membership !== null && amount !== null && amount !== membership.monthlyAmountMinor
  const nameProblem = name.trim().length === 0 ? "Give the membership a name." : name.trim().length > 60 ? "Keep the name to 60 characters or fewer." : null
  const priceProblem = amount === null || amount < 100 ? "A monthly price must be at least £1.00." : null
  const teamProblem = picked.size === 0 ? "Choose at least one team." : null
  const dateProblem = askPriceStart && priceChanged && start === "date" && startDate < today ? "A new price can start today or later, never in the past." : null

  function save() {
    setTried(true)
    if (nameProblem || priceProblem || teamProblem || dateProblem || amount === null) return
    const from = !askPriceStart || start === "today" ? today : start === "next" ? nextMonth : startDate
    onSave({ name: name.trim(), monthlyAmountMinor: amount, teamIds: [...picked], priceFrom: membership === null || priceChanged ? from : null })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{membership ? `Edit ${membership.name}` : "Add a Membership"}</DialogTitle>
          <DialogDescription>Each team has one membership. A player in teams with different memberships pays the higher price.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="text-sm font-medium text-ink">
              Name
            </label>
            <Input id={nameId} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Junior Membership" aria-invalid={tried && !!nameProblem} aria-describedby={tried && nameProblem ? `${nameId}-p` : undefined} />
            {tried && nameProblem && (
              <p id={`${nameId}-p`} role="alert" className="text-xs text-destructive-text">
                {nameProblem}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={priceId} className="text-sm font-medium text-ink">
              Monthly Price
            </label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted">
                £
              </span>
              <Input id={priceId} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="pl-7 tabular-nums" aria-invalid={tried && !!priceProblem} aria-describedby={`${priceId}-h`} />
            </div>
            <p id={`${priceId}-h`} role={tried && priceProblem ? "alert" : undefined} className={`text-xs ${tried && priceProblem ? "text-destructive-text" : "text-ink-muted"}`}>
              {tried && priceProblem ? priceProblem : "Collected every month by Direct Debit. At least £1.00."}
            </p>
          </div>

          {askPriceStart && priceChanged && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">New Price Starts</legend>
              <ChoiceCards
                legend="When the new price starts"
                value={start}
                onChange={setStart}
                options={[
                  { value: "today", label: "Today", body: "For anyone who joins from today." },
                  { value: "next", label: `On ${formatFinanceDate(nextMonth, "long")}`, body: "For anyone who joins from the 1st of next month." },
                  { value: "date", label: "On Another Date", body: "Choose the day it starts." },
                ]}
              />
              {start === "date" && <Input type="date" aria-label="New price starts" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-auto" />}
              {tried && dateProblem && (
                <p role="alert" className="text-xs text-destructive-text">
                  {dateProblem}
                </p>
              )}
              <p className="text-xs text-ink-muted">Members already enrolled keep paying their current price.</p>
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Teams</legend>
            {teams.length === 0 && <p className="text-sm text-ink-muted">The club has no teams yet.</p>}
            <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
              {groups.map((group) => {
                // Select All takes the group's teams that are free or already here. A team in another membership is
                // left as it is: moving it stays an individual decision, made on its own row.
                const free = group.teams.filter((t) => !t.productId || t.productId === membership?.id)
                const allPicked = free.every((t) => picked.has(t.id))
                const headingId = `${groupId}-${group.key}`
                return (
                  <div key={group.key} role="group" aria-labelledby={headingId}>
                    <div className="flex min-h-9 items-center justify-between gap-3">
                      <h3 id={headingId} className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
                        {group.title}
                      </h3>
                      {free.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={`h-11 sm:h-7 ${ARIA_DISABLED_LOOK}`}
                          focusableWhenDisabled
                          disabled={allPicked}
                          onClick={() => setPicked(new Set([...picked, ...free.map((t) => t.id)]))}
                        >
                          Select All
                          <span className="sr-only">{` ${group.title}`}</span>
                        </Button>
                      )}
                    </div>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      {group.teams.map((team) => {
                        const on = picked.has(team.id)
                        const elsewhere = team.productId && team.productId !== membership?.id ? owner.get(team.productId) : null
                        return (
                          <CheckRow
                            key={team.id}
                            checked={on}
                            label={team.name}
                            description={elsewhere ? (on ? `Moves here from ${elsewhere}.` : `In ${elsewhere}.`) : null}
                            onChange={(next) => {
                              const set = new Set(picked)
                              if (next) set.add(team.id)
                              else set.delete(team.id)
                              setPicked(set)
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            {tried && teamProblem && (
              <p role="alert" className="text-xs text-destructive-text">
                {teamProblem}
              </p>
            )}
          </fieldset>

          {problem && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">
              {problem}
            </p>
          )}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {membership && onArchive && membership.activeMemberships === 0 ? (
              <Button type="button" variant="ghost" className="h-11 text-destructive-text sm:h-9" onClick={onArchive}>
                Remove This Membership
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="h-11 sm:h-9" disabled={saving}>
                {saving ? "Saving…" : membership ? "Save Membership" : "Add Membership"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
