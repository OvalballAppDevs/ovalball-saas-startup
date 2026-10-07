"use client"

import { useEffect, useId, useMemo, useState, useTransition } from "react"
import { Search } from "lucide-react"
import {
  exclusionsSentence,
  reasonShort,
  reminderExclusions,
  type MembershipRow,
  type MembershipTeamRef,
} from "@ovalball/contracts/membership/board"
import {
  NEEDS_ACTION,
  REMINDER_RECIPIENTS_EXPLAINED,
  audiencePlayerIds,
  memberTeamOptions,
  reminderMessages,
  sendRemindersLabel,
  type ReminderAudience,
} from "@ovalball/contracts/membership/operate"

import { MembershipPanel, memberName } from "@/components/membership/membership-board-parts"
import { OutcomeNotice, useOutcome } from "@/components/membership/membership-remind"
import { ReminderMessageList } from "@/components/membership/reminder-messages"

import { previewRemindersAction, sendRemindersAction } from "../actions"

/**
 * SEND REMINDERS (Club Memberships Part 2): choose who, read exactly what they will get, send.
 *
 * The audiences are the contract's (`audiencePlayerIds`): only players the server says can be put to a payer now are
 * ever counted. The message is the SERVER's preview (`membership_reminder_preview`) -- the same composer the sending
 * uses, so what is shown is what a family receives; nothing here is free text, so nothing here can leak another
 * family's money. Sending goes in the server's own batches; what happened is said in the server's own words.
 */

export type AudienceKind = ReminderAudience["kind"]

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-forest-800/25 sm:h-9"

function teamName(teams: MembershipTeamRef[], id: string | null): string {
  return teams.find((t) => t.id === id)?.name ?? "the team"
}

export function ReminderComposer({
  clubId,
  rows,
  initial,
}: {
  clubId: string
  rows: MembershipRow[]
  initial: { kind: AudienceKind; teamId: string | null; playerIds: string[] }
}) {
  const teams = useMemo(() => memberTeamOptions(rows), [rows])
  const remindable = useMemo(() => rows.filter((r) => r.canRemind), [rows])
  const [kind, setKind] = useState<AudienceKind>(initial.kind)
  const [teamId, setTeamId] = useState<string | null>(() =>
    initial.teamId && teams.some((t) => t.id === initial.teamId) ? initial.teamId : (teams[0]?.id ?? null)
  )
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.playerIds))
  const [find, setFind] = useState("")
  const { said, done } = useOutcome()
  const [sending, startSend] = useTransition()
  const groupName = useId()
  const teamSelectId = useId()
  const findId = useId()

  const audienceFor = useMemo(
    () =>
      (k: AudienceKind): ReminderAudience =>
        k === "team" ? { kind: "team", teamId: teamId ?? "" } : k === "selected" ? { kind: "selected", playerIds: [...picked] } : { kind: k },
    [teamId, picked]
  )
  const ids = useMemo(() => audiencePlayerIds(rows, audienceFor(kind)), [rows, audienceFor, kind])
  const count = (k: AudienceKind) => audiencePlayerIds(rows, audienceFor(k)).length

  // Who this choice leaves out, and why (reminded in the last 3 days, or the club's to sort out).
  const considered =
    kind === "needs_action"
      ? rows.filter((r) => NEEDS_ACTION.has(r.standing))
      : kind === "overdue"
        ? rows.filter((r) => r.standing === "OVERDUE")
        : kind === "team"
          ? rows.filter((r) => NEEDS_ACTION.has(r.standing) && (r.teams ?? []).some((t) => t.id === teamId))
          : []
  const left = exclusionsSentence(reminderExclusions(considered), "club")
  const needTotal = rows.filter((r) => NEEDS_ACTION.has(r.standing)).length
  const overdueTotal = rows.filter((r) => r.standing === "OVERDUE").length

  // The server's preview for exactly this audience; an answer is only ever shown for the audience it was asked for.
  // `attempt` is Try Again: the same audience asked afresh, so a failed preview is never stuck on screen.
  const [attempt, setAttempt] = useState(0)
  const key = `${attempt}|${ids.join(",")}`
  const [answer, setAnswer] = useState<{ key: string; result: Awaited<ReturnType<typeof previewRemindersAction>> } | null>(null)
  useEffect(() => {
    if (ids.length === 0) return
    let current = true
    const asked = `${attempt}|${ids.join(",")}`
    previewRemindersAction(clubId, ids)
      .then((result) => {
        if (current) setAnswer({ key: asked, result })
      })
      .catch(() => {
        if (current) setAnswer({ key: asked, result: { ok: false, error: "The message couldn't be shown." } })
      })
    return () => {
      current = false
    }
  }, [clubId, ids, attempt])
  const preview = ids.length === 0 ? null : answer?.key === key ? answer.result : undefined
  const nobodyToAsk = preview?.ok ? preview.preview.skipped.filter((s) => s.reason === "NOBODY_TO_ASK").length : 0
  const messages = preview?.ok ? reminderMessages(preview.preview) : []

  const shownToPick = useMemo(() => {
    const q = find.trim().toLowerCase()
    return q ? remindable.filter((r) => memberName(r).toLowerCase().includes(q)) : remindable
  }, [remindable, find])

  function send() {
    startSend(async () => {
      const result = await sendRemindersAction(clubId, ids)
      done(result)
      if (kind === "selected") setPicked(new Set())
    })
  }

  const options: { kind: AudienceKind; label: string; detail: string }[] = [
    {
      kind: "needs_action",
      label: "Everyone who needs action",
      detail: `${count("needs_action")} of ${needTotal} can be reminded now.`,
    },
    { kind: "overdue", label: "Everyone overdue", detail: `${count("overdue")} of ${overdueTotal} can be reminded now.` },
    {
      kind: "team",
      label: "A team",
      detail: teamId ? `${count("team")} in ${teamName(teams, teamId)} can be reminded now.` : "No team has anybody to remind.",
    },
    { kind: "selected", label: "Selected members", detail: picked.size === 0 ? "Choose who to remind." : `${count("selected")} chosen.` },
  ]

  return (
    <div className="space-y-5">
      <MembershipPanel id="reminders-who" title="Who to Remind">
        <fieldset className="min-w-0">
          <legend className="sr-only">Who to Remind</legend>
          <div className="space-y-2">
            {options.map((option) => {
              const on = kind === option.kind
              return (
                <div key={option.kind} className={`rounded-xl border transition-colors ${on ? "border-forest-800 bg-forest-800/[0.04]" : "border-ink/10 bg-white hover:border-ink/25"}`}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-forest-800">
                    <input type="radio" name={groupName} value={option.kind} checked={on} onChange={() => setKind(option.kind)} className="sr-only" />
                    <span aria-hidden="true" className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-forest-800" : "border-ink/30"}`}>
                      {on && <span className="size-2.5 rounded-full bg-forest-800" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{option.label}</span>
                      <span className="mt-0.5 block text-sm text-ink-muted tabular-nums">{option.detail}</span>
                    </span>
                  </label>

                  {on && option.kind === "team" && teams.length > 0 && (
                    <div className="px-3.5 pb-3.5 pl-11">
                      <label htmlFor={teamSelectId} className="text-xs font-medium text-ink-muted">
                        Team
                      </label>
                      <select id={teamSelectId} value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)} className={`mt-1 ${FIELD}`}>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {on && option.kind === "selected" && (
                    <div className="px-3.5 pb-3.5 pl-11">
                      {remindable.length === 0 ? (
                        <p className="text-sm text-ink-muted">Nobody can be reminded right now.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="relative min-w-0 flex-1">
                              <label htmlFor={findId} className="sr-only">
                                Find a Member
                              </label>
                              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
                              <input id={findId} type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by name" autoComplete="off" className={`${FIELD} pl-9`} />
                            </div>
                            <button
                              type="button"
                              onClick={() => setPicked(new Set([...picked, ...shownToPick.map((r) => r.playerId)]))}
                              className="inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-9"
                            >
                              Select All
                            </button>
                            {picked.size > 0 && (
                              <button
                                type="button"
                                onClick={() => setPicked(new Set())}
                                className="inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-9"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                          <ul aria-label="Members who can be reminded" className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                            {shownToPick.map((r) => {
                              const checked = picked.has(r.playerId)
                              return (
                                <li key={r.playerId}>
                                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-ink/[0.03] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-forest-800">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        const next = new Set(picked)
                                        if (e.target.checked) next.add(r.playerId)
                                        else next.delete(r.playerId)
                                        setPicked(next)
                                      }}
                                      className="mt-0.5 size-4 shrink-0 accent-forest-800"
                                    />
                                    <span className="min-w-0">
                                      <span className="block text-sm text-ink">{memberName(r)}</span>
                                      <span className="block text-xs text-ink-muted">
                                        {[(r.teams ?? []).map((t) => t.name).join(", "), reasonShort(r.reason)].filter(Boolean).join(" · ")}
                                      </span>
                                    </span>
                                  </label>
                                </li>
                              )
                            })}
                            {shownToPick.length === 0 && <li className="px-2 py-2 text-sm text-ink-muted">Nobody by that name can be reminded now.</li>}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>
      </MembershipPanel>

      <MembershipPanel id="reminders-message" title={messages.length > 1 ? "Messages" : "Message"}>
        <div aria-live="polite" aria-busy={preview === undefined}>
          {ids.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody in this choice can be reminded now, so there is nothing to send.</p>
          ) : preview === undefined ? (
            <div aria-label="Working out the message" className="space-y-2 rounded-xl border border-ink/10 bg-chalk p-4">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
              <div className="h-3.5 w-full animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
              <div className="h-3.5 w-4/5 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
            </div>
          ) : !preview?.ok ? (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-destructive-text">
              <p>{preview?.error}</p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="inline-flex min-h-11 items-center rounded-md font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-8"
              >
                Try Again
              </button>
            </div>
          ) : (
            <ReminderMessageList preview={preview.preview} />
          )}
        </div>
        <p className="mt-3 max-w-prose text-xs text-ink-muted">{REMINDER_RECIPIENTS_EXPLAINED}</p>
        {(left || nobodyToAsk > 0) && (
          <div className="mt-3 space-y-0.5 text-sm text-ink-muted">
            {left && <p>{left}</p>}
            {nobodyToAsk > 0 && <p>{nobodyToAsk === 1 ? "1 has no adult the club can contact." : `${nobodyToAsk} have no adult the club can contact.`}</p>}
          </div>
        )}
        <div className="mt-4 border-t border-ink/10 pt-4">
          <button
            type="button"
            onClick={() => {
              if (!sending && ids.length > 0) send()
            }}
            aria-disabled={sending || ids.length === 0 || undefined}
            aria-busy={sending}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-forest-950 outline-none hover:bg-pitch-600/85 focus-visible:ring-2 focus-visible:ring-forest-800 focus-visible:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:w-auto"
          >
            {sending ? "Sending…" : ids.length === 0 ? "Nothing to Send" : sendRemindersLabel(ids.length)}
          </button>
          <OutcomeNotice said={said} className="mt-3" />
        </div>
      </MembershipPanel>
    </div>
  )
}
