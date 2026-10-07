import Link from "next/link"
import { STANDING_LABEL } from "@ovalball/contracts/membership/board"
import { loadMembershipReminderHistory, type MembershipReminderEntry } from "@ovalball/contracts/membership/member"
import { standingGuidance } from "@ovalball/contracts/membership/operate"

import { MembershipPanel, shortDateTime } from "@/components/membership/membership-board-parts"

import { loadMembershipsBoard, requireMembershipsAccess } from "../memberships-access"
import { MembershipsLoadProblem, MembershipsNotSetUp, MembershipsShell } from "../memberships-shell"
import { ReminderComposer, type AudienceKind } from "./reminder-composer"

export const metadata = { title: "Reminders | Memberships" }

type Search = Record<string, string | string[] | undefined>

const AUDIENCES: AudienceKind[] = ["needs_action", "overdue", "team", "selected"]
const HISTORY_LIMIT = 100

/**
 * REMINDERS (Club Memberships Part 2): send one, and see every one that was sent.
 *
 * Sending is for the club's enrolment managers (`finance.enrolment.manage`, which the server checks again on every
 * send); everybody who may see the club's memberships sees the history -- who was reminded, when, why, by whom, from
 * the club or a team, and how many adults were told (never who). `?audience=needs_action|overdue|team|selected`,
 * `&team=` and `&players=` open it with a choice made, which is how Send N Reminders arrives here.
 */
export default async function MembershipRemindersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams
  const access = await requireMembershipsAccess()
  const board = await loadMembershipsBoard()
  const history = board?.programme
    ? await loadMembershipReminderHistory(access.supabase, { clubId: access.clubId, limit: HISTORY_LIMIT }).catch(() => null)
    : null

  const audience = first(params.audience)
  const initial = {
    kind: AUDIENCES.includes(audience as AudienceKind) ? (audience as AudienceKind) : "needs_action",
    teamId: first(params.team),
    playerIds: (first(params.players) ?? "").split(",").filter(Boolean).slice(0, 500),
  }

  return (
    <MembershipsShell access={access} board={board} active="reminders">
      {!board ? (
        <MembershipsLoadProblem />
      ) : !board.programme ? (
        <MembershipsNotSetUp canConfigure={access.can.configure} />
      ) : (
        <div className="grid items-start gap-5 @4xl:grid-cols-12">
          {access.can.enrolment && (
            // The send column travels with the page beside a long history, so no part of the desk sits empty; if it is
            // ever taller than the window (a long list of members to pick from) it scrolls on its own, so Send is
            // always reachable.
            <div className="min-w-0 @4xl:sticky @4xl:top-6 @4xl:col-span-5 @4xl:max-h-[calc(100dvh-3rem)] @4xl:overflow-y-auto @4xl:overscroll-contain">
              <ReminderComposer clubId={access.clubId} rows={board.rows} initial={initial} />
            </div>
          )}
          <MembershipPanel
            id="reminders-history"
            title="History"
            description={access.can.enrolment ? "Every reminder sent, newest first." : "Every reminder sent, newest first. Sending reminders needs the enrolment permission at this club."}
            className={access.can.enrolment ? "@4xl:col-span-7" : "@4xl:col-span-12"}
          >
            {!history ? (
              <p role="alert" className="text-sm text-destructive-text">
                The reminder history couldn&rsquo;t be loaded. Refresh the page to try again.
              </p>
            ) : history.reminders.length === 0 ? (
              <p className="text-sm text-ink-muted">No reminders have been sent yet.</p>
            ) : (
              <ReminderHistory entries={history.reminders} />
            )}
            {history && history.reminders.length >= HISTORY_LIMIT && <p className="mt-3 text-xs text-ink-muted">{`Showing the latest ${HISTORY_LIMIT}.`}</p>}
          </MembershipPanel>
        </div>
      )}
    </MembershipsShell>
  )
}

function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

/** Why somebody was reminded, as it was when the reminder went: the guidance's own title. */
function reasonTitle(entry: MembershipReminderEntry): string {
  if (entry.reason) return standingGuidance(entry.reason, "club").title
  return entry.standing ? STANDING_LABEL[entry.standing] : "—"
}

function told(n: number | null): string {
  if (n === null) return "—"
  return n === 1 ? "1 person" : `${n} people`
}

function ReminderHistory({ entries }: { entries: MembershipReminderEntry[] }) {
  const link = "font-medium text-ink underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-forest-800"
  return (
    <div className="@container/history">
      <table className="hidden w-full table-fixed text-sm @md/history:table">
        <caption className="sr-only">Reminders sent, newest first</caption>
        <colgroup>
          <col className="w-[21%]" />
          <col className="w-[25%]" />
          <col className="w-[26%]" />
          <col className="w-[18%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs font-medium text-ink-muted">
            <th scope="col" className="py-2 pr-3">
              When
            </th>
            <th scope="col" className="px-3 py-2">
              Member
            </th>
            <th scope="col" className="px-3 py-2">
              Reason
            </th>
            <th scope="col" className="px-3 py-2">
              Sent By
            </th>
            <th scope="col" className="py-2 pl-3 text-right">
              Told
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/[0.07]">
          {entries.map((e, i) => (
            <tr key={`${e.sentAt}-${e.playerId}-${i}`} className="align-top">
              <td className="py-2.5 pr-3 text-ink-muted tabular-nums">
                <time dateTime={e.sentAt}>{shortDateTime(e.sentAt)}</time>
              </td>
              <td className="px-3 py-2.5">
                <Link href={`/club/finance/members/${encodeURIComponent(e.playerId)}`} className={`block truncate ${link}`}>
                  {`${e.firstName} ${e.surname}`.trim()}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-ink">{reasonTitle(e)}</td>
              <td className="px-3 py-2.5">
                <span className="block truncate text-ink">{e.sentBy ?? "Someone at the club"}</span>
                <span className="block text-xs text-ink-muted">{e.scope === "team" ? "From the team" : "From the club"}</span>
              </td>
              {/* How many adults were told -- never who. */}
              <td className="py-2.5 pl-3 text-right text-ink-muted tabular-nums">
                {e.recipients === null ? "—" : e.recipients}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-ink/[0.07] @md/history:hidden">
        {entries.map((e, i) => (
          <li key={`${e.sentAt}-${e.playerId}-${i}`} className="py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <Link href={`/club/finance/members/${encodeURIComponent(e.playerId)}`} className={`text-sm ${link}`}>
                {`${e.firstName} ${e.surname}`.trim()}
              </Link>
              <time dateTime={e.sentAt} className="text-xs text-ink-muted tabular-nums">
                {shortDateTime(e.sentAt)}
              </time>
            </div>
            <p className="mt-0.5 text-sm text-ink">{reasonTitle(e)}</p>
            <p className="text-xs text-ink-muted">
              {[`by ${e.sentBy ?? "someone at the club"}`, e.scope === "team" ? "from the team" : "from the club", e.recipients !== null ? `${told(e.recipients)} told` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
