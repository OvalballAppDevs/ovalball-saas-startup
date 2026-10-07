"use client"

import { useEffect, useId, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, Search } from "lucide-react"
import {
  STANDING_LABEL,
  STANDING_ORDER,
  formatMoneyMinor,
  reasonShort,
  remindAgainOn,
  type BoardMembership,
  type MembershipRow,
  type MembershipStanding,
} from "@ovalball/contracts/membership/board"
import {
  MEMBER_SEGMENTS,
  NO_MEMBER_FILTERS,
  activeFilterCount,
  filterMembers,
  memberGroups,
  memberTeamOptions,
  segmentCounts,
  type MemberFilters,
} from "@ovalball/contracts/membership/operate"

import { MemberInitials, StandingPill, memberName, payerLine, shortDate } from "@/components/membership/membership-board-parts"
import { OutcomeNotice, RemindButton, useOutcome, useRemindedHere, type Said } from "@/components/membership/membership-remind"

import { remindMembers } from "../actions"

/**
 * MEMBERS (Club Memberships Part 2) -- the club board's rows, filtered and grouped by the contract's own arithmetic
 * (`filterMembers`, `segmentCounts`, `memberGroups`), so this list and the phone's can never count differently.
 *
 * A grouped table on a desk, a list of cards where the space is narrow: the same rows, the same words. Every row opens
 * the member's own page; Remind is offered where the server says the payer can be asked now and the reader may ask.
 */

const SELECT =
  "h-11 w-full min-w-0 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-forest-800/25 sm:h-9"
const NAME_LINK = "font-medium text-ink underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-forest-800"

function toQuery(f: MemberFilters): string {
  const p = new URLSearchParams()
  if (f.segment !== "all") p.set("segment", f.segment)
  if (f.teamId) p.set("team", f.teamId)
  if (f.membershipId) p.set("membership", f.membershipId)
  if (f.standing) p.set("status", f.standing)
  if (f.query.trim()) p.set("q", f.query.trim())
  const s = p.toString()
  return s ? `?${s}` : ""
}

export function MembersBoard({
  clubId,
  rows,
  memberships,
  endedCount,
  initialFilters,
  canRemind,
}: {
  clubId: string
  rows: MembershipRow[]
  memberships: BoardMembership[]
  endedCount: number
  initialFilters: MemberFilters
  canRemind: boolean
}) {
  const teams = useMemo(() => memberTeamOptions(rows), [rows])
  // A link may name a team or membership the board no longer has: that filter is dropped rather than showing nobody.
  const [filters, setFilters] = useState<MemberFilters>(() => ({
    ...initialFilters,
    teamId: initialFilters.teamId && teams.some((t) => t.id === initialFilters.teamId) ? initialFilters.teamId : null,
    membershipId: initialFilters.membershipId && memberships.some((m) => m.id === initialFilters.membershipId) ? initialFilters.membershipId : null,
    standing: initialFilters.standing === "ENDED" && endedCount === 0 ? null : initialFilters.standing,
  }))
  const update = (patch: Partial<MemberFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const { said, done } = useOutcome()
  const reminded = useRemindedHere()

  // The filters live in the address, so a refresh, Back and a copied link all keep them -- without a server round trip.
  useEffect(() => {
    const next = `${window.location.pathname}${toQuery(filters)}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next)
  }, [filters])

  const showingEnded = filters.standing === "ENDED"
  const visible = useMemo(() => {
    if (!showingEnded) return filterMembers(rows, filters)
    // The segments never include an ended membership (operate.ts `inSegment`), so "Ended" is asked for by name: each
    // ended row is put to filterMembers' own team, membership and name tests as though it were current.
    return rows.filter((r) => r.standing === "ENDED" && filterMembers([{ ...r, standing: "UP_TO_DATE" }], { ...filters, segment: "all", standing: null }).length === 1)
  }, [rows, filters, showingEnded])
  // The segment counts follow the other filters, so "Need Action 3" means three in what is being looked at.
  const counts = useMemo(() => segmentCounts(filterMembers(rows, { ...filters, segment: "all", standing: showingEnded ? null : filters.standing })), [rows, filters, showingEnded])
  const total = useMemo(() => segmentCounts(rows).all, [rows])
  const groups = memberGroups(visible)
  // Settled groups fold away only beside groups that need somebody; asked for on their own, they open.
  const mixed = groups.some((g) => !g.settled)
  const filtered = activeFilterCount(filters) > 0 || filters.segment !== "all"

  const segmentName = useId()
  const searchId = useId()
  const teamId = useId()
  const membershipId = useId()
  const statusId = useId()

  const remind = (row: MembershipRow) => (): Promise<Said> => remindMembers(clubId, [row.playerId])
  const remindControl: RemindControl = {
    show: (row) => canRemind && (row.canRemind || reminded.has(row.playerId)),
    held: (row) => reminded.has(row.playerId),
    action: remind,
    onDone: (row) => reminded.track([row.playerId], done),
  }
  // A filtered view can be handed to Reminders as "Selected members" -- the people it shows who can be asked now.
  const handOff = canRemind && filtered && !showingEnded ? visible.filter((r) => r.canRemind).map((r) => r.playerId) : []

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink/15 bg-white px-5 py-8 md:px-8">
        <p className="text-sm font-medium text-ink">Nobody needs a membership yet</p>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">Players appear here once they have a place in a team that has a membership.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-ink/10 bg-white p-4 md:p-5">
        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <fieldset className="min-w-0">
            <legend className="sr-only">Show Members</legend>
            <div className="inline-flex flex-wrap gap-1 rounded-xl bg-ink/[0.04] p-1">
              {MEMBER_SEGMENTS.map((s) => {
                const on = !showingEnded && filters.segment === s.key
                return (
                  <label
                    key={s.key}
                    className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-forest-800 ${
                      on ? "bg-forest-800 text-white" : "text-ink hover:bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name={segmentName}
                      value={s.key}
                      checked={on}
                      onChange={() => update({ segment: s.key, standing: showingEnded ? null : filters.standing })}
                      className="sr-only"
                    />
                    {s.label}
                    <span className={`tabular-nums ${on ? "text-white/80" : "text-ink-muted"}`}>{counts[s.key]}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div className="relative w-full @3xl:max-w-xs">
            <label htmlFor={searchId} className="sr-only">
              Search Members
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              id={searchId}
              type="search"
              value={filters.query}
              onChange={(e) => update({ query: e.target.value })}
              placeholder="Search by name"
              autoComplete="off"
              className={`${SELECT} pl-9`}
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 @lg:grid-cols-3 @4xl:grid-cols-[repeat(3,minmax(0,13rem))_1fr] @4xl:items-end">
          <div className="min-w-0 space-y-1">
            <label htmlFor={teamId} className="text-xs font-medium text-ink-muted">
              Team
            </label>
            <select id={teamId} value={filters.teamId ?? ""} onChange={(e) => update({ teamId: e.target.value || null })} className={SELECT}>
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor={membershipId} className="text-xs font-medium text-ink-muted">
              Membership
            </label>
            <select id={membershipId} value={filters.membershipId ?? ""} onChange={(e) => update({ membershipId: e.target.value || null })} className={SELECT}>
              <option value="">All memberships</option>
              {memberships.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor={statusId} className="text-xs font-medium text-ink-muted">
              Status
            </label>
            <select
              id={statusId}
              value={filters.standing ?? ""}
              onChange={(e) => {
                const standing = (e.target.value || null) as MembershipStanding | null
                update(standing === "ENDED" ? { standing, segment: "all" } : { standing })
              }}
              className={SELECT}
            >
              <option value="">All statuses</option>
              {STANDING_ORDER.filter((s) => s !== "ENDED" || endedCount > 0).map((s) => (
                <option key={s} value={s}>
                  {STANDING_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 @lg:col-span-3 @4xl:col-span-1 @4xl:justify-end sm:min-h-9">
            <p aria-live="polite" className="text-sm text-ink-muted tabular-nums">
              {showingEnded
                ? `${visible.length} ended ${visible.length === 1 ? "membership" : "memberships"}`
                : filtered
                  ? `${visible.length} of ${total} members`
                  : `${total} ${total === 1 ? "member" : "members"}`}
            </p>
            {(filtered || handOff.length > 0) && (
              <div className="flex flex-wrap items-center gap-x-4">
                {handOff.length > 0 && handOff.length <= HAND_OFF_LIMIT && (
                  <Link
                    href={`/club/finance/reminders?audience=selected&players=${handOff.join(",")}`}
                    className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-9"
                  >
                    {handOff.length === 1 ? "Remind This Member" : `Remind These ${handOff.length} Members`}
                  </Link>
                )}
                {filtered && (
                  <button
                    type="button"
                    onClick={() => setFilters(NO_MEMBER_FILTERS)}
                    className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-9"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <OutcomeNotice said={said} />

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-white px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">Nobody matches these filters.</p>
          <button
            type="button"
            onClick={() => setFilters(NO_MEMBER_FILTERS)}
            className="mt-2 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-9"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        groups.map((group, index) => {
          const headingId = `members-group-${group.standing}`
          const heading = `${STANDING_LABEL[group.standing]} · ${group.rows.length}`
          const body = <MemberRows rows={group.rows} first={index === 0} remindControl={remindControl} caption={heading} />
          if (group.settled && mixed) {
            return (
              <details key={group.standing} className="group rounded-2xl border border-ink/10 bg-white">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-sm font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-forest-800 md:px-5 [&::-webkit-details-marker]:hidden">
                  {heading}
                  <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <div className="border-t border-ink/10">{body}</div>
              </details>
            )
          }
          return (
            <section key={group.standing} aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
              <h2 id={headingId} className="px-4 pt-4 pb-2 text-sm font-semibold text-ink md:px-5">
                {heading}
              </h2>
              {body}
            </section>
          )
        })
      )}

      {endedCount > 0 && !showingEnded && (
        <p className="text-sm text-ink-muted">
          {`${endedCount} ${endedCount === 1 ? "membership has" : "memberships have"} ended in the last year. `}
          <button
            type="button"
            onClick={() => setFilters({ ...NO_MEMBER_FILTERS, standing: "ENDED" })}
            className="inline-flex min-h-11 items-center rounded-md font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-8"
          >
            Show Ended Memberships
          </button>
        </p>
      )}
    </div>
  )
}

/** Whether a row offers Remind, whether it has just been reminded here, and what pressing it does. */
type RemindControl = {
  show: (row: MembershipRow) => boolean
  held: (row: MembershipRow) => boolean
  action: (row: MembershipRow) => () => Promise<Said>
  onDone: (row: MembershipRow) => (said: Said) => void
}

/** Above this, a filtered view is too many people to carry in a link; Reminders' own audiences cover it. */
const HAND_OFF_LIMIT = 100

function RowRemind({ row, control, className = "" }: { row: MembershipRow; control: RemindControl; className?: string }) {
  if (!control.show(row)) return null
  return (
    <RemindButton
      label={`Remind about ${memberName(row)}`}
      visibleLabel="Remind"
      action={control.action(row)}
      onDone={control.onDone(row)}
      held={control.held(row)}
      heldLabel="Reminded"
      className={className}
    />
  )
}

/** One group's rows: a table where there is room for it, cards where there is not. */
function MemberRows({ rows, first, remindControl, caption }: { rows: MembershipRow[]; first: boolean; remindControl: RemindControl; caption: string }) {
  return (
    <>
      <div className="hidden @4xl:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">{caption}</caption>
          {/* Fixed widths that add up to the whole, so every group's columns line up and nothing pushes the page wide. */}
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col className="w-[20%]" />
            <col className="w-[13%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
          </colgroup>
          {/* Every group carries its column names; they are drawn above the first group only. */}
          <thead className={first ? "" : "sr-only"}>
            <tr className="border-b border-ink/10 text-left text-xs font-medium text-ink-muted">
              <th scope="col" className="px-4 py-2 md:pl-5">
                Member
              </th>
              <th scope="col" className="px-3 py-2">
                Membership
              </th>
              <th scope="col" className="px-3 py-2">
                Status
              </th>
              <th scope="col" className="px-3 py-2">
                Payer
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                This Month
              </th>
              <th scope="col" className="px-3 py-2">
                Last Reminder
              </th>
              <th scope="col" className="py-2 pr-4 pl-2 md:pr-5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/[0.07]">
            {rows.map((row) => (
              <tr key={row.playerId} className="align-top">
                <td className="px-4 py-3 md:pl-5">
                  <Link href={`/club/finance/members/${encodeURIComponent(row.playerId)}`} className={`block truncate ${NAME_LINK}`}>
                    {memberName(row)}
                  </Link>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">{(row.teams ?? []).map((t) => t.name).join(", ") || "No team"}</span>
                </td>
                <td className="px-3 py-3 text-ink">
                  <span className="block truncate">{row.membership?.name ?? <span className="text-ink-muted">None</span>}</span>
                </td>
                <td className="px-3 py-3">
                  <StandingPill standing={row.standing} />
                  <span className="mt-1 block text-xs text-ink-muted">{statusDetail(row)}</span>
                </td>
                <td className={`px-3 py-3 ${row.payer ? "text-ink" : "text-ink-muted"}`}>
                  <span className="block truncate">{payerLine(row.payer)}</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{thisMonth(row)}</td>
                <td className="px-3 py-3">
                  <LastReminder row={row} />
                </td>
                <td className="py-2.5 pr-4 pl-2 text-right md:pr-5">
                  <RowRemind row={row} control={remindControl} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-ink/[0.07] @4xl:hidden">
        {rows.map((row) => (
          <li key={row.playerId} className="flex items-start gap-3 px-4 py-3.5">
            <MemberInitials firstName={row.firstName} surname={row.surname} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={`/club/finance/members/${encodeURIComponent(row.playerId)}`} className={`text-sm ${NAME_LINK}`}>
                  {memberName(row)}
                </Link>
                <StandingPill standing={row.standing} />
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">{[(row.teams ?? []).map((t) => t.name).join(", "), row.membership?.name].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 text-sm text-ink">{statusDetail(row)}</p>
              <p className="mt-0.5 text-xs text-ink-muted tabular-nums">{[payerLine(row.payer), thisMonthText(row)].filter(Boolean).join(" · ")}</p>
              <div className="mt-0.5 text-xs text-ink-muted">
                <LastReminder row={row} compact />
              </div>
            </div>
            <RowRemind row={row} control={remindControl} className="shrink-0" />
          </li>
        ))}
      </ul>
    </>
  )
}

/** The reason in a few words, and when the money comes next where the Direct Debit is running. */
function statusDetail(row: MembershipRow): string {
  const next = row.nextCollectionDate ? `Next collection ${shortDate(row.nextCollectionDate)}` : null
  return [reasonShort(row.reason), next].filter(Boolean).join(" · ")
}

function thisMonthText(row: MembershipRow): string | null {
  if (row.amountDueMinor != null) return `${formatMoneyMinor(row.amountDueMinor)} this month`
  if (row.monthlyAmountMinor) return `${formatMoneyMinor(row.monthlyAmountMinor)} a month`
  return null
}

function thisMonth(row: MembershipRow) {
  if (row.amountDueMinor != null) return <span className="text-ink">{formatMoneyMinor(row.amountDueMinor)}</span>
  if (row.monthlyAmountMinor) return <span className="text-xs text-ink-muted">{`${formatMoneyMinor(row.monthlyAmountMinor)} a month`}</span>
  return <span className="text-ink-muted">—</span>
}

function LastReminder({ row, compact = false }: { row: MembershipRow; compact?: boolean }) {
  if (!row.lastRemindedAt) return compact ? null : <span className="text-ink-muted">Never</span>
  const again = remindAgainOn(row)
  if (compact) {
    return <>{[`Reminded ${shortDate(row.lastRemindedAt)}${row.lastRemindedBy ? ` by ${row.lastRemindedBy}` : ""}`, again ? `can remind again ${again}` : null].filter(Boolean).join(" · ")}</>
  }
  return (
    <>
      <span className="block text-ink">{shortDate(row.lastRemindedAt)}</span>
      {row.lastRemindedBy && <span className="block truncate text-xs text-ink-muted">{`by ${row.lastRemindedBy}`}</span>}
      {again && <span className="block text-xs text-ink-muted">{`Again from ${again}`}</span>}
    </>
  )
}
