import Link from "next/link"
import { ArrowRight, Check, ChevronRight } from "lucide-react"
import {
  SETTLED_STANDINGS,
  exclusionsSentence,
  formatMoneyMinor,
  reasonShort,
  reminderExclusions,
  type ClubMembershipBoard,
  type MembershipRow,
} from "@ovalball/contracts/membership/board"
import { NEEDS_ACTION, teamBreakdown, type TeamStanding } from "@ovalball/contracts/membership/operate"
import { PROGRAMME_STATE_LABEL, feePercent, loadMembershipSetup, setupProgress, type MembershipSetupState, type ProgrammeState } from "@ovalball/contracts/membership/setup"
import { PAYMENT_REVIEW_REASONS, ordinalWord } from "@ovalball/contracts/club/finance"

import { ClubAvatar } from "@/components/club/club-avatar"
import {
  MemberInitials,
  MembershipPanel,
  StandingBar,
  StandingLegend,
  StandingPill,
  TeamStandingBar,
  memberName,
  monthName,
  needActionCount,
} from "@/components/membership/membership-board-parts"
import { buttonVariants } from "@/components/ui/button"
import { resolveClubLogoUrl } from "@/lib/app-context/club-logo"
import { cn } from "@/lib/utils"

import { loadMembershipsBoard, requireMembershipsAccess, type MembershipsAccess } from "./memberships-access"
import { MembershipsLoadProblem, MembershipsNotSetUp, MembershipsShell } from "./memberships-shell"

export const metadata = { title: "Memberships" }

const LINK = "font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-forest-800"
const ROW_LINK = "rounded-lg outline-none transition-colors hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-forest-800"

/** The setup journey: Club Settings > Club Memberships, which opens at a step when one is named (`?step=`). */
const SETUP_PATH = "/club/settings/subscriptions"

/**
 * THE CLUB'S MEMBERSHIPS -- OVERVIEW (Club Memberships Part 2; this route was the Finance Dashboard).
 *
 * What needs the club first, then the month's money, the club's memberships, who needs action and each team. Every
 * figure is the server's one board (`club_membership_board`): the standing per player, the counts, and the month's
 * money by the canonical definitions -- nothing here adds a figure up or decides who is paid. The month's ledger
 * (waive, retry, generate, export, review) moved, unchanged in what it does, to Payments.
 *
 * A club that has not switched memberships on -- no programme, or one never activated, which is the rule
 * `membership_setup_state` derives NOT_STARTED and SETTING_UP by -- is shown the way in instead: the setup, step by
 * step from the journey's own answer, with one button (the phone's Memberships home). A running club's page reads
 * nothing more than it did; and should the setup answer fail, the page says what the board alone can.
 */
export default async function MembershipsOverviewPage() {
  const access = await requireMembershipsAccess()
  const board = await loadMembershipsBoard()
  const notSwitchedOn = !!board && (!board.programme || (!board.programme.enabled && board.programme.activatedAt === null))
  const [setup, crestUrl] = notSwitchedOn ? await Promise.all([loadMembershipSetup(access.supabase, access.clubId).catch(() => null), clubCrestUrl(access)]) : [null, null]
  const settingUp = setup && (setup.state === "NOT_STARTED" || setup.state === "SETTING_UP") ? setup : null
  const reviewCount = board?.programme && !settingUp ? await membershipsNeedingReview(access) : 0

  return (
    <MembershipsShell access={access} board={board} active="overview" settingUp={!!settingUp}>
      {!board ? (
        <MembershipsLoadProblem />
      ) : settingUp ? (
        <MembershipsSetupHome setup={settingUp} clubName={access.clubName} crestUrl={crestUrl} />
      ) : !board.programme ? (
        <MembershipsNotSetUp canConfigure={access.can.configure} />
      ) : (
        <Overview board={board} programme={board.programme} reviewCount={reviewCount} access={access} />
      )}
    </MembershipsShell>
  )
}

/** The club's own crest (its upload, else the Club Directory's), never tinted or swapped: this is the club's money. */
async function clubCrestUrl({ supabase, clubId }: MembershipsAccess): Promise<string | null> {
  const { data } = await supabase.from("clubs").select("logo_storage_path, club_directory(logo_storage_path)").eq("id", clubId).maybeSingle()
  return resolveClubLogoUrl(supabase, data)
}

/**
 * Memberships the relationship engine says need review (a Direct Debit problem, a payer who is no longer the
 * guardian...). The list itself lives on Payments, beside the ledger; the overview says how many, so nothing that
 * needs the club is out of sight from the front page.
 */
async function membershipsNeedingReview({ supabase, clubId }: MembershipsAccess): Promise<number> {
  const { data } = await supabase.rpc("get_finance_action_required", { p_club_id: clubId })
  return new Set((data ?? []).filter((r) => !PAYMENT_REVIEW_REASONS.has(r.reason)).map((r) => r.payer_subscription_id)).size
}

// ---------------------------------------------------------------------------------------------------------------------
// NOT SWITCHED ON YET -- the way in
// ---------------------------------------------------------------------------------------------------------------------

type StepStatus = "done" | "next" | "to do"

/** A step's status in words, for a screen reader (a sighted person reads it from the step's mark). */
const STEP_STATUS_SPOKEN: Record<StepStatus, string> = { done: ". Done.", next: ". Next.", "to do": ". To do." }

/**
 * THE WAY IN, said once (the phone's Memberships home, on a desk): the club, what Club Memberships does, the four things
 * the club sets up with where each one stands -- the server's own readiness (`setupProgress`), never this page's guess --
 * Ovalball's fee in plain words, and ONE button that carries on from wherever the club is. Each step opens that step of
 * the journey. Somebody who can neither set memberships up nor connect GoCardless sees where it stands and is offered
 * nothing to press; the journey's own doors ask authority again whatever this page offered.
 */
function MembershipsSetupHome({ setup, clubName, crestUrl }: { setup: MembershipSetupState; clubName: string; crestUrl: string | null }) {
  const steps = setupProgress(setup)
  const next = steps.findIndex((x) => !x.done)
  const pct = feePercent(setup.feeBps)
  const canAct = setup.canConfigure || setup.canConnect
  const started = setup.state !== "NOT_STARTED" || steps.some((x) => x.done)
  const cta = !started ? "Get Started" : setup.readiness.canActivate ? "Review and Activate" : "Continue Setting Up"
  return (
    <section aria-labelledby="memberships-setup" className="rounded-2xl border border-ink/10 bg-white p-5 md:p-8">
      <div className="grid gap-x-10 gap-y-6 @4xl:grid-cols-12">
        <div className="min-w-0 @4xl:col-span-5">
          {/* The club's own crest, never tinted or swapped. */}
          <ClubAvatar logoUrl={crestUrl} name={clubName} size="md" />
          <h2 id="memberships-setup" className="mt-4 text-2xl font-semibold text-ink">
            Club Memberships
          </h2>
          <p className="mt-1 max-w-prose text-base text-ink-muted">Collect membership payments by Direct Debit, and always know who is up to date.</p>
        </div>
        <ol className="min-w-0 divide-y divide-ink/10 border-y border-ink/10 @4xl:col-span-7">
          {steps.map((x, i) => {
            const status: StepStatus = x.done ? "done" : i === next ? "next" : "to do"
            const body = (
              <>
                <StepMark index={i} status={status} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">
                    <span className="sr-only">{`Step ${i + 1} of ${steps.length}, `}</span>
                    {x.title}
                    <span className="sr-only">: </span>
                  </span>
                  <span className={`block text-sm ${x.done ? "text-rugby-700" : "text-ink-muted"}`}>
                    {x.detail}
                    <span className="sr-only">{STEP_STATUS_SPOKEN[status]}</span>
                  </span>
                </span>
              </>
            )
            return (
              <li key={x.key}>
                {canAct ? (
                  <Link href={`${SETUP_PATH}?step=${x.key}`} className={`flex min-h-16 items-center gap-4 px-2 py-3 ${ROW_LINK}`}>
                    {body}
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                  </Link>
                ) : (
                  <div className="flex min-h-16 items-center gap-4 px-2 py-3">{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      </div>
      <div className="mt-6 flex flex-col items-start gap-4 border-t border-ink/10 pt-6 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        {/* Ovalball's fee before anything is asked of the club: never only in the terms. */}
        <p className="max-w-prose rounded-xl bg-mint-100/60 px-4 py-3 text-sm text-forest-800">
          <span className="font-medium">{`Ovalball's fee: ${pct} of each membership payment`}</span>
          {" — you choose whether the club or its members pay it. GoCardless's own fees are separate."}
        </p>
        {canAct ? (
          <Link href={SETUP_PATH} className={cn(buttonVariants({ variant: "default" }), "h-11 shrink-0 px-5 font-semibold sm:h-10")}>
            {cta}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        ) : (
          <p className="max-w-prose text-sm text-ink-muted">Somebody who manages the club&rsquo;s memberships sets them up.</p>
        )}
      </div>
    </section>
  )
}

/** A step's mark: a tick when it is done, its number filled when it is next, and outlined while it is still to come. */
function StepMark({ index, status }: { index: number; status: StepStatus }) {
  if (status === "done") {
    return (
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mint-100 text-rugby-700">
        <Check className="size-4" strokeWidth={2.6} />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${status === "next" ? "bg-forest-800 text-white" : "border-[1.5px] border-ink/25 text-ink-muted"}`}
    >
      {index + 1}
    </span>
  )
}

function Overview({
  board,
  programme,
  reviewCount,
  access,
}: {
  board: ClubMembershipBoard
  programme: NonNullable<ClubMembershipBoard["programme"]>
  reviewCount: number
  access: MembershipsAccess
}) {
  const month = monthName(board.asOf)
  const needRows = board.rows.filter((r) => NEEDS_ACTION.has(r.standing))
  // Reading order is working order: the standing, then the people to chase, then the money, the teams, and the
  // club's memberships last (reference, not a task). On a desk, two columns that each flow at their own height --
  // standing over who needs action, money over teams -- never a row of cards stretched to the tallest, which drew
  // blank space inside the shorter one. On a phone they stack in reading order.
  return (
    <div className="grid items-start gap-5 @2xl:grid-cols-2 @4xl:grid-cols-12">
      <div className="grid gap-5 @4xl:col-span-7">
        <StandingPanel board={board} month={month} className="" />
        <NeedsActionPanel rows={needRows} reviewCount={reviewCount} className="" />
      </div>
      <div className="grid gap-5 @4xl:col-span-5">
        <MoneyPanel board={board} month={month} className="" />
        <TeamsPanel teams={teamBreakdown(board)} className="" />
      </div>
      <MembershipsRow board={board} programme={programme} canConfigure={access.can.configure} className="@2xl:col-span-2 @4xl:col-span-12" />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// STANDING -- the one bold element
// ---------------------------------------------------------------------------------------------------------------------

function StandingPanel({ board, month, className }: { board: ClubMembershipBoard; month: string; className: string }) {
  const c = board.counts
  const needs = needActionCount(c)
  // Who a bulk reminder would leave out, and why: reminded in the last 3 days, or the club's to sort out.
  const left = exclusionsSentence(reminderExclusions(board.rows.filter((r) => !SETTLED_STANDINGS.has(r.standing))), "club")
  return (
    <MembershipPanel id="memberships-standing" title="Standing" description={`${month}, ${c.total} ${c.total === 1 ? "member" : "members"}`} className={`@4xl:flex @4xl:flex-col ${className}`}>
      <p className="flex items-end gap-3">
        <span className={`font-display text-7xl leading-[0.82] tabular-nums ${needs > 0 ? "text-amber-700" : "text-forest-800"}`}>{needs}</span>
        <span className="pb-0.5 text-base font-medium text-ink">{needs === 1 ? "needs action" : "need action"}</span>
      </p>
      <StandingBar counts={c} className="mt-5" />
      <StandingLegend counts={c} hrefFor={(s) => `/club/finance/members?status=${s}`} className="mt-3" />
      {/* Sits at the foot of the panel when the row beside it makes the panel taller. */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-ink/10 pt-4 @4xl:mt-auto">
        <div className="min-w-0 space-y-0.5 text-sm text-ink-muted">
          {c.directDebitInPlace !== undefined && <p>{`${c.directDebitInPlace} ${c.directDebitInPlace === 1 ? "Direct Debit" : "Direct Debits"} in place.`}</p>}
          {left && <p>{left}</p>}
        </div>
      </div>
    </MembershipPanel>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// THE MONTH'S MONEY
// ---------------------------------------------------------------------------------------------------------------------

function MoneyPanel({ board, month, className }: { board: ClubMembershipBoard; month: string; className: string }) {
  const m = board.money
  const money = (minor: number) => formatMoneyMinor(minor, m.currency)
  // Three tiers, as the figures relate: the month's three headline sums; the three parts of Outstanding beneath it;
  // and what sits beside the month (refunds, what the club let go, the next collection).
  const headline: { term: string; minor: number }[] = [
    { term: "Expected", minor: m.expectedMinor },
    { term: "Collected", minor: m.collectedMinor },
    { term: "Outstanding", minor: m.outstandingMinor },
  ]
  const outstandingParts: { term: string; minor: number }[] = [
    { term: "With the bank", minor: m.collectingMinor },
    { term: "Overdue", minor: m.overdueMinor },
    { term: "Failed", minor: m.failedMinor },
  ]
  const beside: { term: string; minor: number }[] = [
    { term: "Refunded", minor: m.refundedMinor },
    { term: "Waived or exempt", minor: m.waivedMinor },
    { term: "Next collection", minor: m.nextCollectionMinor },
  ]
  const meanings: { term: string; meaning: string }[] = [
    { term: "Expected", meaning: "What this month's memberships come to, leaving out anything exempt, waived, refunded or cancelled." },
    {
      term: "Collected",
      meaning:
        "Payments GoCardless has confirmed for this month, less refunds it has confirmed. Confirmed means the payer's bank has paid; GoCardless pays it out to the club a few working days later.",
    },
    { term: "With the bank", meaning: "Part of Outstanding: payments with the bank now, not counted as collected until GoCardless confirms them." },
    { term: "Outstanding", meaning: "Owed for this month and not yet collected. It includes With the bank, Overdue and Failed." },
    { term: "Overdue", meaning: "Part of Outstanding: owed, not with the bank, and more than five days late." },
    { term: "Failed", meaning: "Part of Outstanding: payments that didn't go through, or were reclaimed through the bank." },
    { term: "Refunded", meaning: "Money given back for this month." },
    { term: "Waived or exempt", meaning: "What the club chose not to collect this month." },
    { term: "Next collection", meaning: "What the Direct Debits in place will collect on the next collection day." },
    { term: "Ovalball's fee", meaning: "Ovalball's share of the payments collected this month. Where members pay it, it was added to their payment rather than taken from the club's." },
    ...(m.feeOnRefundsMinor > 0
      ? [{ term: "Fee on refunded payments", meaning: "Ovalball's fee on payments later refunded. Whether GoCardless returns it isn't settled, so it is neither counted as Ovalball's nor left in what the club receives." }]
      : []),
    {
      term: "Club receives",
      meaning:
        "Collected, less the part of Ovalball's fee the club pays. It is before GoCardless's own fee, which is only known once GoCardless pays the club out, so it is not shown or estimated here.",
    },
  ]
  return (
    <MembershipPanel
      id="memberships-money"
      title={`${month}'s Money`}
      action={
        <Link href="/club/finance/payments" className={`text-sm ${LINK}`}>
          See Payments
        </Link>
      }
      className={className}
    >
      <dl className="grid grid-cols-3 gap-x-4">
        {headline.map((f) => (
          <div key={f.term} className="min-w-0">
            <dt className="text-xs text-ink-muted">{f.term}</dt>
            <dd className={`mt-0.5 text-lg font-semibold tabular-nums @md:text-xl ${f.minor === 0 ? "text-ink-muted" : "text-ink"}`}>{money(f.minor)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 border-l-2 border-ink/10 pl-3">
        <p className="text-xs text-ink-muted">Of what is outstanding</p>
        <dl className="mt-1 grid grid-cols-3 gap-x-4 text-sm tabular-nums">
          {outstandingParts.map((f) => (
            <div key={f.term} className="min-w-0">
              <dt className="text-xs text-ink-muted">{f.term}</dt>
              <dd className={f.minor === 0 ? "text-ink-muted" : "font-medium text-ink"}>{money(f.minor)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-x-4 border-t border-ink/10 pt-3 text-sm tabular-nums">
        {beside.map((f) => (
          <div key={f.term} className="min-w-0">
            <dt className="text-xs text-ink-muted">{f.term}</dt>
            <dd className={f.minor === 0 ? "text-ink-muted" : "font-medium text-ink"}>{money(f.minor)}</dd>
          </div>
        ))}
      </dl>

      {/* Where the month's collected money goes, top to bottom: the one tinted thing in the panel. */}
      <figure className="mt-5 rounded-xl bg-forest-800/[0.05] px-4 py-3">
        <figcaption className="text-xs text-ink-muted">What reaches the club from this month&rsquo;s collected payments</figcaption>
        <dl className="mt-1 text-sm tabular-nums">
          <div className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-ink">Collected</dt>
            <dd className="font-medium text-ink">{money(m.collectedMinor)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-ink-muted">Ovalball&rsquo;s fee{board.programme && board.programme.feeBps > 0 ? ` (${feePercent(board.programme.feeBps)})` : ""}</dt>
            <dd className="text-ink-muted">{money(m.ovalballFeeMinor)}</dd>
          </div>
          {m.membersFeeMinor > 0 && (
            <div className="flex items-baseline justify-between gap-4 py-1 pl-3">
              <dt className="text-ink-muted">Of which members paid on top</dt>
              <dd className="text-ink-muted">{money(m.membersFeeMinor)}</dd>
            </div>
          )}
          {m.feeOnRefundsMinor > 0 && (
            <div className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-ink-muted">Fee on refunded payments</dt>
              <dd className="text-ink-muted">{money(m.feeOnRefundsMinor)}</dd>
            </div>
          )}
          {/* The rule above the total sits on the total's own row: a definition list holds term and value groups only. */}
          <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-dashed border-ink/20 pt-2.5 pb-1">
            <dt className="font-semibold text-ink">Club receives</dt>
            <dd className="text-lg font-semibold text-ink">{money(m.clubReceivesMinor)}</dd>
          </div>
        </dl>
        <p className="mt-0.5 text-xs text-ink-muted">Before GoCardless&rsquo;s own fee.</p>
      </figure>

      <details className="mt-3 text-sm text-ink-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-md font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-8">
          What These Mean
        </summary>
        <dl className="mt-1 space-y-1.5">
          {meanings.map((item) => (
            <div key={item.term}>
              <dt className="inline font-medium text-ink">{item.term}.</dt> <dd className="inline">{item.meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </MembershipPanel>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// THE CLUB'S MEMBERSHIPS
// ---------------------------------------------------------------------------------------------------------------------

const STATE_CHIP: Record<ProgrammeState, string> = {
  ACTIVE: "bg-mint-100 text-forest-800 border-mint-100",
  PAUSED: "bg-amber-50 text-amber-800 border-amber-200",
  SETTING_UP: "bg-chalk text-ink-muted border-ink/15",
  NOT_STARTED: "bg-chalk text-ink-muted border-ink/15",
}

function MembershipsRow({
  board,
  programme,
  canConfigure,
  className,
}: {
  board: ClubMembershipBoard
  programme: NonNullable<ClubMembershipBoard["programme"]>
  canConfigure: boolean
  className: string
}) {
  // Memberships are monthly and continuous (owner-locked, 6 October 2026): there is no season to show.
  const state: ProgrammeState = programme.enabled ? "ACTIVE" : programme.activatedAt ? "PAUSED" : "SETTING_UP"
  const fee =
    programme.feeBearer === "CLUB" ? " The club pays Ovalball's fee." : programme.feeBearer === "PAYER" ? " Members pay Ovalball's fee on top of the price." : ""
  return (
    <MembershipPanel
      id="memberships-list"
      title="Club Memberships"
      description={`Collected on the ${ordinalWord(programme.collectionDay)} of each month.${fee}`}
      action={
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_CHIP[state]}`}>
            <span className="sr-only">Club Memberships: </span>
            {PROGRAMME_STATE_LABEL[state]}
          </span>
          {canConfigure && (
            <Link href="/club/settings/subscriptions" className={`text-sm ${LINK}`}>
              Manage Memberships
            </Link>
          )}
        </div>
      }
      className={className}
    >
      {state === "PAUSED" && <p className="mb-4 max-w-prose text-sm text-ink">New memberships are paused. Members already paying carry on.</p>}
      {board.memberships.length === 0 ? (
        <p className="text-sm text-ink-muted">The club has no memberships yet.</p>
      ) : (
        <div className="@container/ms">
          {/* The columns follow the number of memberships, so two never leave an empty third column beside them. */}
          <ul className={`grid gap-3 ${board.memberships.length >= 3 ? "@lg/ms:grid-cols-2 @3xl/ms:grid-cols-3" : board.memberships.length === 2 ? "@lg/ms:grid-cols-2" : "max-w-md"}`}>
            {board.memberships.map((m) => (
              <li key={m.id} className="flex flex-col rounded-xl bg-chalk px-4 py-3.5">
                <h3 className="text-sm font-semibold text-ink">{m.name}</h3>
                <p className={`mt-0.5 text-sm tabular-nums ${m.priceMinor === null ? "text-amber-800" : "text-ink"}`}>
                  {m.priceMinor === null ? "No monthly price yet" : `${formatMoneyMinor(m.priceMinor, programme.currency)} a month`}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {`${m.teams} ${m.teams === 1 ? "team" : "teams"}, ${m.members === 0 ? "nobody paying yet" : `${m.members} paying`}`}
                </p>
                <Link href={`/club/finance/members?membership=${encodeURIComponent(m.id)}`} className={`mt-2 self-start text-sm ${LINK}`}>
                  See Members<span className="sr-only">{` of ${m.name}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </MembershipPanel>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// NEEDS ACTION and TEAMS
// ---------------------------------------------------------------------------------------------------------------------

const NEEDS_SHOWN = 8

function NeedsActionPanel({ rows, reviewCount, className }: { rows: MembershipRow[]; reviewCount: number; className: string }) {
  return (
    <MembershipPanel
      id="memberships-needs"
      title="Need Action"
      action={
        rows.length > 0 ? (
          <Link href="/club/finance/members?segment=needs_action" className={`text-sm ${LINK}`}>
            See All in Members
          </Link>
        ) : undefined
      }
      className={className}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Nobody needs action this month.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-ink/10">
          {rows.slice(0, NEEDS_SHOWN).map((row) => (
            <li key={row.playerId}>
              <Link href={`/club/finance/members/${encodeURIComponent(row.playerId)}`} className={`flex items-center gap-3 px-2 py-2.5 ${ROW_LINK}`}>
                <MemberInitials firstName={row.firstName} surname={row.surname} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{memberName(row)}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {[(row.teams ?? []).map((t) => t.name).join(", "), reasonShort(row.reason)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <StandingPill standing={row.standing} />
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > NEEDS_SHOWN && <p className="mt-3 text-sm text-ink-muted">{`And ${rows.length - NEEDS_SHOWN} more in Members.`}</p>}
      {reviewCount > 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {`${reviewCount} ${reviewCount === 1 ? "membership needs" : "memberships need"} review, for example a Direct Debit problem or a payer who is no longer a guardian. `}
          <Link href="/club/finance/payments" className="font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800">
            Review in Payments
          </Link>
        </p>
      )}
    </MembershipPanel>
  )
}

function TeamsPanel({ teams, className }: { teams: TeamStanding[]; className: string }) {
  return (
    <MembershipPanel id="memberships-teams" title="Teams" className={className}>
      {teams.length === 0 ? (
        <p className="text-sm text-ink-muted">No team has anybody with a membership yet.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {teams.map((t) => (
            <li key={t.team.id}>
              <Link href={`/club/finance/members?team=${encodeURIComponent(t.team.id)}`} className={`block px-2 py-2 ${ROW_LINK}`}>
                <span className="block truncate text-sm font-medium text-ink">{t.team.name}</span>
                <TeamStandingBar team={t} className="mt-1.5" />
                <span className="mt-1 block text-xs text-ink-muted tabular-nums">
                  {[`${t.total} ${t.total === 1 ? "member" : "members"}`, `${t.upToDate} up to date`, t.needsAction > 0 ? `${t.needsAction} need action` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MembershipPanel>
  )
}
