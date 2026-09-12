"use client"

import { useState, useTransition } from "react"

import { setClubCommunicationPolicy } from "./actions"


/**
 * THE CLUB'S COMMUNICATIONS SETTINGS.
 *
 * Until now a club could set exactly one of these -- direct messaging -- even
 * though Ovalball delegates six more. The rest were enforced server-side with
 * no control anywhere, so a club that had been given a choice had no way to
 * exercise it. This is that surface, and it is deliberately the mirror of the
 * Site Admin one: same grouping, same order, same words for the same things,
 * so the two screens read as one subject seen from two heights.
 *
 * TWO PRECEDENCE MODELS, AND THE CLUB IS TOLD WHICH IT IS LOOKING AT.
 *
 *   CONJUNCTION (direct messaging) resolves as site AND club. A club can
 *   only ever restrict it. When Ovalball has it off, a club switch reading
 *   "On" would be a lie, so the control is disabled and the panel says what
 *   is actually in force.
 *
 *   OVERRIDE (everything else) resolves as coalesce(club, site) beneath a
 *   ceiling Ovalball can withdraw. When the ceiling is withdrawn the club's
 *   stored choice stops applying -- so the row shows Ovalball's value and
 *   says the choice is not currently the club's to make, rather than
 *   displaying a stale override as though it were in force.
 *
 * EVERY ROW STATES THE EFFECTIVE RESULT, because that is the only thing a
 * club administrator actually needs to know, and it is the one thing two
 * interacting switches make hard to work out.
 */
export interface ClubCommunicationRow {
  key: string
  label: string
  description: string
  /** What Ovalball allows. */
  siteEnabled: boolean
  /** What this club has chosen, where it has an opinion. */
  clubEnabled: boolean
  /**
   * True where a club setting can only RESTRICT (direct messaging). False
   * where the club overrides the platform default within Ovalball's ceiling.
   */
  conjunction: boolean
  /** For override-model rows: has Ovalball allowed clubs an opinion at all? */
  overrideAllowed: boolean
}

const GROUPS: { title: string; blurb: string; keys: string[] }[] = [
  {
    title: "Messaging",
    blurb: "Who may talk to whom, and in what shape.",
    keys: ["allow_direct_messaging", "allow_team_conversations", "allow_multi_person_conversations"],
  },
  {
    title: "Announcements",
    blurb: "One message to many people, sent as a team or as the club.",
    keys: [
      "allow_team_announcements",
      "allow_club_announcements",
      "allow_private_replies",
      "allow_group_discussion",
    ],
  },
]

function effectiveOf(row: ClubCommunicationRow, clubValue: boolean): boolean {
  if (row.conjunction) return row.siteEnabled && clubValue
  // An override only counts while Ovalball still permits one.
  return row.overrideAllowed ? clubValue : row.siteEnabled
}

export function ClubCommunicationsPanel({
  clubId,
  rows,
  canEdit,
}: {
  clubId: string
  rows: ClubCommunicationRow[]
  canEdit: boolean
}) {
  const [state, setState] = useState(new Map(rows.map((r) => [r.key, r.clubEnabled])))
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const byKey = new Map(rows.map((r) => [r.key, r]))

  function toggle(row: ClubCommunicationRow) {
    const next = !(state.get(row.key) ?? true)
    setState((prev) => new Map(prev).set(row.key, next))
    setError(null)
    startTransition(async () => {
      const result = await setClubCommunicationPolicy(clubId, row.key, next)
      if (!result.ok) {
        setState((prev) => new Map(prev).set(row.key, !next))
        setError(result.error)
      }
    })
  }

  return (
    <div className="mt-4 rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Communications</p>
      <p className="mt-1 text-xs text-ink-muted">
        What this club allows its members, within what Ovalball allows. Where Ovalball has switched something off,
        your club cannot turn it back on.
      </p>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {GROUPS.map((group) => {
        const groupRows = group.keys.map((k) => byKey.get(k)).filter(Boolean) as ClubCommunicationRow[]
        if (groupRows.length === 0) return null

        return (
          <section key={group.title} className="mt-5">
            <h3 className="text-sm font-medium text-ink">{group.title}</h3>
            <p className="mt-0.5 text-xs text-ink-muted">{group.blurb}</p>

            <ul className="mt-2 divide-y divide-ink/8 rounded-md border border-ink/10">
              {groupRows.map((row) => {
                const clubValue = state.get(row.key) ?? true
                const effective = effectiveOf(row, clubValue)

                // A control that cannot change the outcome is disabled rather
                // than left live to do nothing.
                const locked = row.conjunction ? !row.siteEnabled : !row.overrideAllowed

                return (
                  <li
                    key={row.key}
                    className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3.5 py-3"
                  >
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="block text-sm text-ink">{row.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">{row.description}</span>

                      {/* WHAT IS ACTUALLY IN FORCE, in a sentence. */}
                      <span className="mt-1 block text-[11px] text-ink-subtle">
                        {locked
                          ? row.conjunction
                            ? "Ovalball has this off for every club, so it is off here whatever this says. Your club's choice applies again if Ovalball turns it back on."
                            : `Ovalball decides this for every club. Currently ${row.siteEnabled ? "on" : "off"}.`
                          : effective
                            ? "On for this club."
                            : "Off for this club. Existing conversations stay readable."}
                      </span>
                    </span>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={clubValue}
                      aria-label={row.label}
                      disabled={!canEdit || locked || pending}
                      onClick={() => toggle(row)}
                      className="flex min-h-11 shrink-0 items-center gap-2 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
                    >
                      <span aria-hidden="true" className="text-[11px] font-medium text-ink-muted">
                        {clubValue ? "On" : "Off"}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${clubValue ? "bg-pitch-600" : "bg-ink/20"}`}
                      >
                        <span
                          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                            clubValue ? "translate-x-[22px]" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
