"use client"

import { useRef, useState } from "react"
import {
  STANDING_LABEL,
  exclusionsSentence,
  reasonShort,
  reminderExclusions,
  SETTLED_STANDINGS,
  type MembershipRow,
} from "@ovalball/contracts/membership/board"
import {
  NEEDS_ACTION,
  REMINDER_RECIPIENTS_EXPLAINED,
  audiencePlayerIds,
  memberGroups,
  sendRemindersLabel,
  standingGuidance,
  type ReminderPreview,
} from "@ovalball/contracts/membership/operate"

import { StandingPill, memberName, remindedLine } from "@/components/membership/membership-board-parts"
import { ChevronDown } from "lucide-react"

import { OutcomeNotice, RemindButton, useOutcome, useRemindedHere, type Said } from "@/components/membership/membership-remind"
import { ReminderMessageList } from "@/components/membership/reminder-messages"

type PreviewAnswer = { ok: true; preview: ReminderPreview } | { ok: false; error: string }

/**
 * A TEAM'S PLAYERS, BY STANDING, FOR THE PEOPLE WHO RUN THE TEAM (Club Memberships Part 2, decision #2).
 *
 * The team's board carries no money, no payer and no Direct Debit, so neither does this: who needs action first, with
 * what it means in the team's words (`standingGuidance(reason, "team")`) and Remind; everybody else folded away.
 * `remind` is given only to a reader the server lets remind this team (the team's own finance view, or the club's
 * enrolment managers) -- anybody else sees the standing and no button that would be refused.
 *
 * REMINDING EVERYBODY IS CONFIRMED, as on the app: with `previewReminders`, the bulk button first shows the server's
 * words for each situation and how many families get each, and only Send sends. One player's Remind sends at once --
 * the row has just said what it is about.
 */
export function TeamMembershipRows({
  rows,
  remind,
  previewReminders,
  limit,
  level = 3,
}: {
  rows: MembershipRow[]
  remind?: (playerIds: string[]) => Promise<Said>
  previewReminders?: (playerIds: string[]) => Promise<PreviewAnswer>
  /** On the team's home page: the first few who need action, and the page has the rest. */
  limit?: number
  /** The section heading's level where it sits: under the page title (2) or under a section of its own (3). */
  level?: 2 | 3
}) {
  const Heading = level === 2 ? "h2" : "h3"
  const { said, done } = useOutcome()
  // A player just reminded keeps their button, as "Reminded", so focus is not dropped when the page refreshes.
  const reminded = useRemindedHere()
  // The bulk button likewise stays, as "Reminders Sent", once nobody is left to remind.
  const [bulkSent, setBulkSent] = useState(false)
  const [confirm, setConfirm] = useState<PreviewAnswer | "loading" | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const confirmHeading = useRef<HTMLHeadingElement>(null)
  const needRows = rows.filter((r) => NEEDS_ACTION.has(r.standing))
  const askable = remind ? audiencePlayerIds(rows, { kind: "needs_action" }) : []
  const left = exclusionsSentence(reminderExclusions(rows.filter((r) => !SETTLED_STANDINGS.has(r.standing))), "team")
  const shown = limit ? needRows.slice(0, limit) : needRows
  const others = memberGroups(rows.filter((r) => !NEEDS_ACTION.has(r.standing)))

  return (
    <div className="space-y-4">
      {(askable.length > 0 || bulkSent || left) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {remind && previewReminders && (askable.length > 0 || bulkSent) && confirm === null && (
            // One button in one place, before and after: once everybody is reminded it stays as "Reminders Sent"
            // (focusable, never `disabled`), so focus returns to it when the confirmation closes.
            <button
              ref={opener}
              type="button"
              aria-disabled={askable.length === 0 || undefined}
              onClick={() => {
                if (askable.length === 0) return
                setConfirm("loading")
                requestAnimationFrame(() => confirmHeading.current?.focus())
                previewReminders(askable)
                  .then(setConfirm)
                  .catch(() => setConfirm({ ok: false, error: "The message couldn't be shown. Try again." }))
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-forest-950 outline-none hover:bg-pitch-600/85 focus-visible:ring-2 focus-visible:ring-forest-800 focus-visible:ring-offset-2 aria-disabled:cursor-default aria-disabled:opacity-60 sm:min-h-9"
            >
              {askable.length === 0 ? "Reminders Sent" : askable.length === 1 ? "Remind 1 Family" : `Remind ${askable.length} Families`}
            </button>
          )}
          {remind && !previewReminders && (askable.length > 0 || bulkSent) && (
            <RemindButton
              primary
              label={sendRemindersLabel(askable.length)}
              action={() => remind(askable)}
              onDone={(next) => {
                if (next.tone === "ok" && (next.sent ?? 0) > 0) setBulkSent(true)
                done(next)
              }}
              held={bulkSent && askable.length === 0}
              heldLabel="Reminders Sent"
            />
          )}
          {left && <p className="text-sm text-ink-muted">{left}</p>}
        </div>
      )}
      {remind && confirm !== null && (
        <section aria-labelledby="team-remind-confirm" className="rounded-2xl border border-forest-800/30 bg-white p-4 md:p-5">
          <Heading id="team-remind-confirm" ref={confirmHeading} tabIndex={-1} className="text-sm font-semibold text-ink outline-none">
            {askable.length === 1 ? "Remind 1 Family" : `Remind ${askable.length} Families`}
          </Heading>
          <div aria-live="polite" aria-busy={confirm === "loading"} className="mt-3">
            {confirm === "loading" ? (
              <div aria-label="Working out the message" className="space-y-2 rounded-xl border border-ink/10 bg-chalk p-4">
                <div className="h-3.5 w-1/3 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
                <div className="h-3.5 w-full animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
              </div>
            ) : confirm.ok ? (
              <ReminderMessageList preview={confirm.preview} />
            ) : (
              <p role="alert" className="text-sm text-destructive-text">
                {confirm.error}
              </p>
            )}
          </div>
          <p className="mt-3 max-w-prose text-xs text-ink-muted">{REMINDER_RECIPIENTS_EXPLAINED} Nobody is asked twice in three days.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {confirm !== "loading" && confirm.ok && confirm.preview.willSend > 0 && (
              <RemindButton
                primary
                label={sendRemindersLabel(confirm.preview.willSend)}
                action={() => remind(askable)}
                onDone={(next) => {
                  if (next.tone === "ok" && (next.sent ?? 0) > 0) setBulkSent(true)
                  setConfirm(null)
                  done(next)
                  requestAnimationFrame(() => opener.current?.focus())
                }}
              />
            )}
            <button
              type="button"
              onClick={() => {
                setConfirm(null)
                requestAnimationFrame(() => opener.current?.focus())
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-forest-800 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-9"
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      <OutcomeNotice said={said} />

      <section aria-labelledby="team-need-action" className="rounded-2xl border border-ink/10 bg-white">
        <Heading id="team-need-action" className="px-4 pt-4 text-sm font-semibold text-ink md:px-5">
          {`Need Action · ${needRows.length}`}
        </Heading>
        {needRows.length === 0 ? (
          <p className="px-4 pt-1 pb-4 text-sm text-ink-muted md:px-5">Nobody in the team needs action this month.</p>
        ) : (
          <ul className="mt-1 divide-y divide-ink/[0.07]">
            {shown.map((row) => {
              const guidance = standingGuidance(row.reason, "team")
              const remindedText = remindedLine(row)
              return (
                <li key={row.playerId} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between md:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-ink">{memberName(row)}</span>
                      <StandingPill standing={row.standing} />
                    </div>
                    {row.membership && <p className="mt-0.5 text-xs text-ink-muted">{row.membership.name}</p>}
                    <p className="mt-1.5 max-w-prose text-sm text-ink">
                      <span className="font-medium">{`${guidance.title}.`}</span> {guidance.body}
                    </p>
                    {remindedText && <p className="mt-1 text-xs text-ink-muted">{remindedText}</p>}
                  </div>
                  {remind && (row.canRemind || reminded.has(row.playerId)) && (
                    <RemindButton
                      label={`Remind about ${memberName(row)}`}
                      visibleLabel="Remind"
                      action={() => remind([row.playerId])}
                      onDone={reminded.track([row.playerId], done)}
                      held={reminded.has(row.playerId)}
                      heldLabel="Reminded"
                      className="shrink-0 self-start"
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {limit && needRows.length > limit && <p className="border-t border-ink/[0.07] px-4 py-3 text-sm text-ink-muted md:px-5">{`And ${needRows.length - limit} more.`}</p>}
      </section>

      {!limit &&
        others.map((group) => (
          // Everybody else, folded: their families have nothing to do.
          <details key={group.standing} className="group rounded-2xl border border-ink/10 bg-white">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-sm font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-forest-800 md:px-5 [&::-webkit-details-marker]:hidden">
              {`${STANDING_LABEL[group.standing]} · ${group.rows.length}`}
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <ul className="divide-y divide-ink/[0.07] border-t border-ink/10">
              {group.rows.map((row) => (
                <li key={row.playerId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 md:px-5">
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{memberName(row)}</span>
                    {row.membership && <span className="block text-xs text-ink-muted">{row.membership.name}</span>}
                  </span>
                  <span className="text-xs text-ink-muted">{reasonShort(row.reason, "team")}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
    </div>
  )
}
