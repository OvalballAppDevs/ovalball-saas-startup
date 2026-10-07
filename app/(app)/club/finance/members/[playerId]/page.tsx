import { notFound } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, ChevronLeft, Clock, Mail, MinusCircle, Phone, RefreshCw } from "lucide-react"
import { formatMoneyMinor } from "@ovalball/contracts/membership/board"
import { askableSentence, feePositionLabel, loadClubMemberMembership, type ClubMemberMembership, type MemberPaymentMonth } from "@ovalball/contracts/membership/member"
import { standingGuidance, type StandingGuidance } from "@ovalball/contracts/membership/operate"
import { firstPaymentPolicyOptions } from "@ovalball/contracts/membership/setup"
import {
  FINANCE_MANDATE_STATUS_LABEL,
  FINANCE_SUBSCRIPTION_STATUS_LABEL,
  FINANCE_WEB_PATHS,
  PAYMENT_STATUS_LABEL,
  billingPeriodLabel,
  describeSiblingRule,
  formatFinanceDate,
  isObligationOverdue,
  ordinalWord,
  type SiblingDiscountType,
} from "@ovalball/contracts/club/finance"

import { MemberInitials, MembershipPanel, MonthStatusChip, StandingPill, remindedLine, shortDate } from "@/components/membership/membership-board-parts"

import { CancelMembershipButton } from "../../[payerSubscriptionId]/cancel-membership-button"
import { requireMembershipsAccess } from "../../memberships-access"
import { MembershipsLoadProblem, MembershipsShell } from "../../memberships-shell"
import { MemberStatusActions, PayerActions, RetryPaymentButton } from "./member-actions"

export const metadata = { title: "Member | Memberships" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ONE MEMBER (Club Memberships Part 2) -- keyed by the PLAYER, so somebody nobody has set a membership up for has a
 * page too ("Not set up" is the commonest thing a club chases).
 *
 * One server read, `club_member_membership`: the standing, the membership, the payer (contact details only for a
 * reader who may see members' contact details), the adults the club may ask, the Direct Debit in words, every month's
 * payment with Ovalball's fee, and what the reader may do. A status card first -- what is happening and the one thing
 * to do about it -- then the payments; the membership, payer and Direct Debit beside them. The full record
 * (`/club/finance/[payerSubscriptionId]`) stays where it was and is linked as Membership Record.
 *
 * `?club=` (a link from the phone) only chooses which club: the area's authority and the server's read decide.
 */
export default async function MembershipMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>
  searchParams: Promise<{ club?: string | string[] }>
}) {
  const { playerId } = await params
  const { club } = await searchParams
  const clubParam = typeof club === "string" ? club : null
  if (!UUID.test(playerId)) notFound()

  const access = await requireMembershipsAccess(clubParam)
  const read = await loadClubMemberMembership(access.supabase, access.clubId, playerId).then(
    (member) => ({ member }),
    () => null
  )
  // Nobody the club's memberships know: no existence signal beyond "not found".
  if (read && !read.member) notFound()

  return (
    <MembershipsShell access={access} board={null} active="members" primaryAction={false}>
      {access.isActiveClub && (
        <Link
          href="/club/finance/members"
          className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-8"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          All Members
        </Link>
      )}
      {!read?.member ? <MembershipsLoadProblem /> : <Member member={read.member} clubId={access.clubId} />}
    </MembershipsShell>
  )
}

function Member({ member, clubId }: { member: ClubMemberMembership; clubId: string }) {
  const { player, standing, membership, payer, directDebit, history, can } = member
  const name = `${player.firstName} ${player.surname}`.trim() || "Unnamed player"
  const guidance = standingGuidance(standing.reason, "club")
  const active = membership?.enrolmentStatus === "active"
  const payerSubscriptionId = membership?.payerSubscriptionId ?? null

  // This month's failed payment, by Ovalball's own id, for Retry (finance.payment.act; the server re-checks it).
  const currentPeriod = history[0]?.billingPeriod ?? null
  const failedNow = history.find((m) => m.billingPeriod === currentPeriod && m.status === "FAILED" && m.paymentId && m.paymentStatus === "failed")
  const canRetryNow = can.cancel && standing.reason === "PAYMENT_FAILED" && failedNow?.paymentId

  const changePayer =
    can.releasePayer && active && payerSubscriptionId ? { payerSubscriptionId, payerName: payer?.name ?? null, canCancel: can.cancel } : null
  const remindNow = guidance.action === "remind" && can.remind && standing.canRemind

  return (
    <div className="mt-3 grid gap-5 @4xl:grid-cols-12">
      <div className="min-w-0 space-y-5 @4xl:col-span-8">
        <div className="flex items-center gap-4">
          <MemberInitials firstName={player.firstName} surname={player.surname} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-2xl font-semibold text-ink">{name}</h2>
              <StandingPill standing={standing.standing} />
            </div>
            <p className="mt-0.5 text-sm text-ink-muted">
              {[player.teams.map((t) => t.name).join(", ") || "Not in a team", membership?.name ?? "No membership covers them"].join(" · ")}
            </p>
          </div>
        </div>

        <section aria-labelledby="member-status" className="rounded-2xl border border-ink/10 bg-white p-5 md:p-6">
          <div className="flex items-start gap-3">
            <GuidanceIcon tone={guidance.tone} />
            <div className="min-w-0">
              <h3 id="member-status" className="text-lg font-semibold text-ink">
                {guidance.title}
              </h3>
              <p className="mt-1 max-w-prose text-sm text-ink">{guidance.body}</p>
              {standing.nextCollectionDate && <p className="mt-1 text-sm text-ink-muted">{`Next collection ${shortDate(standing.nextCollectionDate)}.`}</p>}
              {remindedLine(standing) && <p className="mt-1 text-xs text-ink-muted">{remindedLine(standing)}</p>}
            </div>
          </div>
          <MemberStatusActions
            clubId={clubId}
            playerId={player.id}
            playerName={player.firstName || name}
            remind={remindNow}
            askable={askableSentence(member.askable, player.firstName || name)}
            retry={canRetryNow && failedNow?.paymentId ? { paymentId: failedNow.paymentId, monthLabel: billingPeriodLabel(failedNow.billingPeriod) } : null}
            changePayer={guidance.action === "change_payer" ? changePayer : null}
            endOrPlace={guidance.action === "end_or_place" ? { canCancel: can.cancel && active && Boolean(payerSubscriptionId) } : null}
          />
        </section>

        <PaymentsPanel history={history} canRetry={can.cancel} clubId={clubId} effectiveFrom={membership?.effectiveFrom ?? null} />
      </div>

      <aside aria-label={`${name}'s membership`} className="min-w-0 space-y-5 @4xl:col-span-4">
        <MembershipDetails member={member} />

        <MembershipPanel id="member-payer" title="Responsible Payer" level={3}>
          {payer ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-ink">{payer.name ?? (payer.relationship === "self" ? name : "A guardian")}</p>
                <p className="text-ink-muted">{payer.relationship === "self" ? "Pays for their own membership" : "Parent or guardian"}</p>
              </div>
              {(payer.email || payer.phone) && (
                <ul className="space-y-1">
                  {payer.email && (
                    <li>
                      <a href={`mailto:${payer.email}`} className="inline-flex min-h-9 items-center gap-2 break-all text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800">
                        <Mail aria-hidden="true" className="size-4 shrink-0" />
                        {payer.email}
                      </a>
                    </li>
                  )}
                  {payer.phone && (
                    <li>
                      <a href={`tel:${payer.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-9 items-center gap-2 text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800">
                        <Phone aria-hidden="true" className="size-4 shrink-0" />
                        {payer.phone}
                      </a>
                    </li>
                  )}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="text-ink-muted">{`Nobody pays for ${player.firstName || name}'s membership yet.`}</p>
              {/* Who the club would ask -- said beside Send Reminder when this reader may send one, otherwise here. */}
              {!remindNow && <p className="text-ink">{askableSentence(member.askable, player.firstName || name)}</p>}
            </div>
          )}
          {/* Outside the payer/no-payer branches on purpose, so it stays mounted when the payer is released. */}
          <PayerActions changePayer={guidance.action !== "change_payer" ? changePayer : null} playerName={player.firstName || name} />
        </MembershipPanel>

        <MembershipPanel id="member-direct-debit" title="Direct Debit" level={3}>
          {directDebit ? (
            <dl className="grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-ink-muted">Direct Debit</dt>
              <dd className="text-ink">{directDebit.mandateStatus ? (FINANCE_MANDATE_STATUS_LABEL[directDebit.mandateStatus] ?? "Not known yet") : "Not set up"}</dd>
              <dt className="text-ink-muted">Monthly collection</dt>
              <dd className="text-ink">{directDebit.subscriptionStatus ? (FINANCE_SUBSCRIPTION_STATUS_LABEL[directDebit.subscriptionStatus] ?? "Not known yet") : "Not started"}</dd>
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">No Direct Debit has been set up for this membership.</p>
          )}
          <p className="mt-3 text-xs text-ink-muted">Bank details are held by GoCardless, never by Ovalball.</p>
        </MembershipPanel>

        {(payerSubscriptionId || (can.cancel && active)) && (
          <div className="space-y-3 rounded-2xl border border-ink/10 bg-white p-5 md:p-6">
            {payerSubscriptionId && (
              <div>
                <Link
                  href={FINANCE_WEB_PATHS.membership(payerSubscriptionId)}
                  className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-8"
                >
                  Membership Record
                </Link>
                <p className="text-xs text-ink-muted">The full record: every month, the sibling pricing and the Direct Debit.</p>
              </div>
            )}
            {can.cancel && active && payerSubscriptionId && (
              <div id="cancel-membership" className="border-t border-ink/10 pt-3">
                <CancelMembershipButton payerSubscriptionId={payerSubscriptionId} playerName={name} />
                <p className="mt-1.5 text-xs text-ink-muted">Stops the Direct Debit&rsquo;s monthly collections at GoCardless.</p>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

const GUIDANCE_ICON: Record<StandingGuidance["tone"], { Icon: typeof AlertTriangle; className: string }> = {
  problem: { Icon: AlertTriangle, className: "bg-red-50 text-destructive-text" },
  attention: { Icon: AlertTriangle, className: "bg-amber-50 text-amber-700" },
  neutral: { Icon: Clock, className: "bg-ink/5 text-ink-muted" },
  moving: { Icon: RefreshCw, className: "bg-mint-100 text-rugby-700" },
  settled: { Icon: CheckCircle2, className: "bg-mint-100 text-forest-800" },
  quiet: { Icon: MinusCircle, className: "bg-ink/5 text-ink-muted" },
}

/** Decorative: the title beside it always says what the icon shows. */
function GuidanceIcon({ tone }: { tone: StandingGuidance["tone"] }) {
  const { Icon, className } = GUIDANCE_ICON[tone]
  return (
    <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-full ${className}`}>
      <Icon className="size-5" />
    </span>
  )
}

function MembershipDetails({ member }: { member: ClubMemberMembership }) {
  const { membership, player, history } = member
  // Whether somebody holds the membership: a status, so sentence case.
  const chip = !membership?.enrolmentStatus ? "Not set up" : membership.enrolmentStatus === "active" ? "Active" : "Ended"
  if (!membership) {
    return (
      <MembershipPanel id="member-membership" title="Membership Details" level={3}>
        <p className="text-sm text-ink-muted">{`No membership covers ${player.firstName || "this player"} at the moment: none of their teams has one.`}</p>
      </MembershipPanel>
    )
  }
  // What a member's Direct Debit collects when members pay Ovalball's fee: the latest month's own figures, never
  // worked out here.
  const charged = membership.feeBearer === "PAYER" ? history.find((m) => m.collectMinor != null && m.feeMinor != null) : undefined
  const policy = membership.firstPaymentPolicy
    ? firstPaymentPolicyOptions(membership.collectionDay ?? 1).find((o) => o.value === membership.firstPaymentPolicy)?.label ?? null
    : null
  const sibling =
    (membership.siblingOrdinal ?? 0) >= 2 && membership.siblingDiscountType && membership.siblingDiscountType !== "NONE"
      ? `${describeSiblingRule({ discountType: membership.siblingDiscountType as SiblingDiscountType, discountValue: membership.siblingDiscountValue ?? 0 })} as the ${ordinalWord(membership.siblingOrdinal ?? 0)} child`
      : null
  return (
    <MembershipPanel
      id="member-membership"
      title="Membership Details"
      level={3}
      action={
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chip === "Active" ? "border-mint-100 bg-mint-100 text-forest-800" : "border-ink/15 bg-chalk text-ink-muted"}`}>
          <span className="sr-only">Membership: </span>
          {chip}
        </span>
      }
    >
      <dl className="grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-ink-muted">Membership</dt>
        <dd className="font-medium text-ink">{membership.name}</dd>
        <dt className="text-ink-muted">Price</dt>
        <dd className="text-ink tabular-nums">
          {membership.monthlyAmountMinor != null ? `${formatMoneyMinor(membership.monthlyAmountMinor)} a month` : "No monthly price yet"}
          {charged && (
            <span className="mt-0.5 block text-xs text-ink-muted">{`Members pay ${formatMoneyMinor(charged.collectMinor!)} a month, including Ovalball's ${formatMoneyMinor(charged.feeMinor!)}`}</span>
          )}
        </dd>
        {sibling && (
          <>
            <dt className="text-ink-muted">Sibling discount</dt>
            <dd className="text-ink">
              {sibling}
              {membership.baseAmountMinor != null && <span className="mt-0.5 block text-xs text-ink-muted">{`Standard price ${formatMoneyMinor(membership.baseAmountMinor)} a month`}</span>}
            </dd>
          </>
        )}
        {membership.collectionDay && (
          <>
            <dt className="text-ink-muted">Collection day</dt>
            <dd className="text-ink">{`The ${ordinalWord(membership.collectionDay)} of each month`}</dd>
          </>
        )}
        {policy && (
          <>
            <dt className="text-ink-muted">First payment</dt>
            <dd className="text-ink">{policy}</dd>
          </>
        )}
        {membership.effectiveFrom && (
          <>
            <dt className="text-ink-muted">Started</dt>
            <dd className="text-ink">{formatFinanceDate(membership.effectiveFrom, "long")}</dd>
          </>
        )}
        {membership.endedAt && (
          <>
            <dt className="text-ink-muted">Ended</dt>
            <dd className="text-ink">
              {formatFinanceDate(membership.endedAt, "long")}
              {membership.endReason && <span className="mt-0.5 block text-xs text-ink-muted">{membership.endReason}</span>}
            </dd>
          </>
        )}
        <dt className="text-ink-muted">Teams</dt>
        <dd className="text-ink">{player.teams.map((t) => t.name).join(", ") || "Not in a team"}</dd>
      </dl>
    </MembershipPanel>
  )
}

/** Every month of this player's membership, newest first: amount, what was collected, Ovalball's fee and where it stands. */
function PaymentsPanel({ history, canRetry, clubId, effectiveFrom }: { history: MemberPaymentMonth[]; canRetry: boolean; clubId: string; effectiveFrom: string | null }) {
  const now = new Date()
  const months = history.map((m) => {
    // The ledger's own rule for an unpaid month that is late (contract isObligationOverdue), so the two never differ.
    const status = m.dueDate && isObligationOverdue(m.status, m.dueDate, 5, now, effectiveFrom) ? "OVERDUE" : m.status
    return { ...m, shownStatus: status, label: billingPeriodLabel(m.billingPeriod) }
  })
  return (
    <MembershipPanel id="member-payments" title="Payments" level={3}>
      {months.length === 0 ? (
        <p className="text-sm text-ink-muted">No payments yet. Months appear here once the membership is set up.</p>
      ) : (
        <div className="@container/pay">
          <table className="hidden w-full text-sm @lg/pay:table">
            <caption className="sr-only">Payments, newest first</caption>
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs font-medium text-ink-muted">
                <th scope="col" className="py-2 pr-3">
                  Month
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Collects
                </th>
                <th scope="col" className="px-3 py-2">
                  Ovalball&rsquo;s Fee
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="py-2 pl-3">
                  Payment
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.07]">
              {months.map((m) => (
                <tr key={m.billingPeriod} className="align-top">
                  <td className="py-2.5 pr-3 text-ink">
                    {m.label}
                    {m.isProrated && <span className="block text-xs text-ink-muted">Part month</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{formatMoneyMinor(m.amountMinor)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{m.collectMinor != null ? formatMoneyMinor(m.collectMinor) : "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {m.feeMinor != null ? <span className="text-ink">{formatMoneyMinor(m.feeMinor)}</span> : <span className="text-ink-muted">—</span>}
                    {feePositionLabel(m.feePosition) && <span className="block text-xs text-ink-muted">{feePositionLabel(m.feePosition)}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <MonthStatusChip status={m.shownStatus} />
                  </td>
                  <td className="py-2.5 pl-3 text-ink">
                    <PaymentCell m={m} canRetry={canRetry} clubId={clubId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-ink/[0.07] @lg/pay:hidden">
            {months.map((m) => (
              <li key={m.billingPeriod} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{m.label}</span>
                  <MonthStatusChip status={m.shownStatus} />
                </div>
                <p className="mt-0.5 text-sm text-ink tabular-nums">
                  {[
                    `${formatMoneyMinor(m.amountMinor)}${m.isProrated ? " (part month)" : ""}`,
                    m.collectMinor != null && m.collectMinor !== m.amountMinor ? `collects ${formatMoneyMinor(m.collectMinor)}` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {m.feeMinor != null && (
                  <p className="text-xs text-ink-muted tabular-nums">{`Ovalball's fee ${formatMoneyMinor(m.feeMinor)}${feePositionLabel(m.feePosition) ? `: ${feePositionLabel(m.feePosition)!.toLowerCase()}` : ""}`}</p>
                )}
                <div className="mt-1 text-xs text-ink-muted">
                  <PaymentCell m={m} canRetry={canRetry} clubId={clubId} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </MembershipPanel>
  )
}

function PaymentCell({ m, canRetry, clubId }: { m: MemberPaymentMonth & { label: string }; canRetry: boolean; clubId: string }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{m.paymentStatus ? (PAYMENT_STATUS_LABEL[m.paymentStatus] ?? "Recorded by GoCardless") : <span className="text-ink-muted">No payment yet</span>}</span>
      {m.chargeDate && <span className="text-xs text-ink-muted">{`Charge date ${shortDate(m.chargeDate)}`}</span>}
      {/* Mounted for every month Retry could ever apply to, so after a retry it stays to say so. */}
      {canRetry && m.paymentId && <RetryPaymentButton clubId={clubId} paymentId={m.paymentId} monthLabel={m.label} available={m.status === "FAILED" && m.paymentStatus === "failed"} />}
    </span>
  )
}
