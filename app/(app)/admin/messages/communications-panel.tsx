"use client"

import { useState, useTransition } from "react"

import { setSiteCommunicationPolicy } from "./actions"

export interface CommunicationFlag {
  key: string
  value: boolean
  overrideAllowed: boolean | null
}

/**
 * SITE ADMIN COMMUNICATIONS.
 *
 * The eight communication capabilities added with the announcement work were
 * enforced server-side from the day they shipped and had no control anywhere:
 * the only way to change one was a raw RPC. This is that control.
 *
 * IT IS GROUPED BY WHAT A PERSON IS TRYING TO DECIDE, not by table column.
 * "Can people message each other", "what may be announced", "what may be
 * attached" are three different administrative questions, and a flat grid of
 * fourteen switches made them look like one.
 *
 * TWO PRECEDENCE MODELS, SHOWN HONESTLY. Most capabilities are a platform
 * default that a club may override where Ovalball permits it. Direct
 * messaging is not: it resolves as site AND club, so a club can only ever
 * restrict it. Rather than force both into one visual, each row says which it
 * is — an administrator should be able to predict what a club can do without
 * knowing how the resolver is written.
 */
const GROUPS: {
  title: string
  blurb: string
  items: { key: string; label: string; description: string; conjunction?: boolean }[]
}[] = [
  {
    title: "Messaging",
    blurb: "Who may talk to whom, and in what shape.",
    items: [
      {
        key: "allow_direct_messaging",
        label: "Direct Messaging",
        description:
          "Eligible adults may send person-to-person messages. People identified as under 18 cannot use direct messaging, whatever their role. Club restrictions and personal blocks still apply.",
        conjunction: true,
      },
      {
        key: "allow_team_conversations",
        label: "Team Conversations",
        description: "A team may run a standing conversation its families can read and post in.",
      },
      {
        key: "allow_multi_person_conversations",
        label: "Chosen Groups",
        description: "Messaging a specific group of people rather than a whole team or club.",
      },
    ],
  },
  {
    title: "Announcements",
    blurb: "One message to many people, sent as a team, a club, or Ovalball.",
    items: [
      {
        key: "allow_team_announcements",
        label: "Team Announcements",
        description: "A team announcing to its own families.",
      },
      {
        key: "allow_club_announcements",
        label: "Club Announcements",
        description: "A club announcing to everybody it runs.",
      },
      {
        key: "allow_platform_announcements",
        label: "Ovalball Announcements",
        description:
          "Ovalball announcing to every club. Held here only — a club cannot opt out of the platform's own channel.",
      },
      {
        key: "allow_private_replies",
        label: "Private Replies",
        description: "A recipient may answer an announcement, seen only by the sending side.",
      },
      {
        key: "allow_group_discussion",
        label: "Group Discussion",
        description:
          "Everyone who received a team or chosen-group announcement can talk to each other. Never available for a club-wide or platform-wide audience.",
      },
    ],
  },
]

export function CommunicationsPanel({
  flags,
  canEdit,
}: {
  flags: CommunicationFlag[]
  canEdit: boolean
}) {
  const [state, setState] = useState(new Map(flags.map((f) => [f.key, f.value])))
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const overrideByKey = new Map(flags.map((f) => [f.key, f.overrideAllowed]))

  function toggle(key: string) {
    const next = !(state.get(key) ?? true)
    setState((prev) => new Map(prev).set(key, next))
    setError(null)
    startTransition(async () => {
      const result = await setSiteCommunicationPolicy(key, next)
      if (!result.ok) {
        setState((prev) => new Map(prev).set(key, !next))
        setError(result.error)
      }
    })
  }

  return (
    <div className="mt-4 rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Communications</p>
      <p className="mt-1 text-xs text-ink-muted">
        What Ovalball allows across every club. Clubs can restrict some of these further; none of them can be
        switched back on by a club once you have turned them off.
      </p>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {GROUPS.map((group) => (
        <section key={group.title} className="mt-5">
          <h3 className="text-sm font-medium text-ink">{group.title}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{group.blurb}</p>

          <ul className="mt-2 divide-y divide-ink/8 rounded-md border border-ink/10">
            {group.items.map((item) => {
              const on = state.get(item.key) ?? true
              const override = overrideByKey.get(item.key)

              return (
                <li key={item.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3.5 py-3">
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block text-sm text-ink">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
                    {/* WHAT A CLUB CAN DO WITH THIS, in a sentence, because
                        that is the question an administrator actually has. */}
                    <span className="mt-1 block text-[11px] text-ink-subtle">
                      {item.conjunction
                        ? "Clubs can restrict this further. They cannot turn it back on."
                        : override === false
                          ? "Clubs follow this setting and cannot override it."
                          : "Clubs may override this while overrides are allowed."}
                    </span>
                  </span>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={item.label}
                    disabled={!canEdit || pending}
                    onClick={() => toggle(item.key)}
                    className="flex min-h-11 shrink-0 items-center gap-2 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
                  >
                    <span aria-hidden="true" className="text-[11px] font-medium text-ink-muted">
                      {on ? "On" : "Off"}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-pitch-600" : "bg-ink/20"}`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                          on ? "translate-x-[22px]" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
