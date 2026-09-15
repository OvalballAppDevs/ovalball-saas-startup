"use client"

import { useState, useTransition } from "react"

import { clearClubCapability, setClubCapability } from "./actions"
import { GROUPS } from "./groups"

export interface MemberCapability {
  capabilityKey: string
  effective: boolean
  /** "role" | "granted" | "denied" | "restricted" | "none" -- where the answer came from. */
  source: string
  overrideId: string | null
  /** The level an explicit decision was made at: "CLUB", "TEAM" or "SITE" (Ovalball). */
  overrideLevel: string | null
  /** Whether the person viewing may change this answer (the database decides; this only shows it). */
  editable: boolean
}

export interface ClubMember {
  userId: string
  name: string
  roleLabel: string
  capabilities: MemberCapability[]
}

/**
 * WHO IN THIS CLUB MAY DO WHAT.
 *
 * NO RAW CAPABILITY KEYS. A club administrator is deciding whether a
 * particular coach may cancel a match; `fixture.cancel` is how the database
 * writes that down, not how the decision is described to the person making
 * it. The groups (./groups.ts) match how the work is actually divided at a club --
 * fixtures, training, the calendar -- rather than the shape of the
 * capability catalogue.
 *
 * THE SOURCE OF EACH ANSWER IS SHOWN, because "allowed" has two very
 * different meanings. Allowed by their ROLE disappears the day they stop
 * being a Team Manager; allowed because somebody GRANTED it is a decision
 * that stays until it is undone. A screen that showed only a tick would
 * make those indistinguishable and make Reset meaningless.
 *
 * Only capabilities the catalogue actually holds are offered. There is no
 * Tournament group because Ovalball has no tournament capability today --
 * inventing a switch that maps to nothing would be worse than its absence.
 */

const SOURCE_LABEL: Record<string, string> = {
  role: "From their role",
  granted: "Granted",
  denied: "Withheld",
  restricted: "Restricted by Ovalball",
  none: "Not from their role",
}

function lockReason(state: MemberCapability): string | null {
  if (state.editable) return null
  if (state.overrideLevel === "SITE") return "Ovalball decided this, so it can only be changed by Ovalball."
  return "You cannot change this permission."
}

export function ClubPermissionsPanel({ clubId, members }: { clubId: string; members: ClubMember[] }) {
  const [openMember, setOpenMember] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function apply(userId: string, key: string, effect: "grant" | "deny") {
    setError(null)
    startTransition(async () => {
      const result = await setClubCapability(userId, key, clubId, effect)
      if (!result.ok) setError(result.error)
    })
  }

  function reset(overrideId: string) {
    setError(null)
    startTransition(async () => {
      const result = await clearClubCapability(overrideId)
      if (!result.ok) setError(result.error)
    })
  }

  if (members.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-4 py-8 text-center text-sm text-ink-muted">
        This club has no active members to give permissions to yet.
      </p>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive-text">
          {error}
        </p>
      )}

      {members.map((member) => {
        const open = openMember === member.userId
        const granted = member.capabilities.filter((c) => c.effective).length

        return (
          <div key={member.userId} className="rounded-lg border border-ink/10 bg-white">
            <button
              type="button"
              onClick={() => setOpenMember(open ? null : member.userId)}
              aria-expanded={open}
              className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{member.name}</span>
                <span className="block text-xs text-ink-muted">{member.roleLabel}</span>
              </span>
              <span className="text-xs text-ink-muted">
                {granted} of {member.capabilities.length} allowed
              </span>
            </button>

            {open && (
              <div className="border-t border-ink/8 px-4 py-3">
                {GROUPS.map((group) => {
                  const rows = group.items
                    .map((item) => ({ item, state: member.capabilities.find((c) => c.capabilityKey === item.key) }))
                    .filter((r) => r.state)

                  if (rows.length === 0) return null

                  return (
                    <section key={group.title} className="mt-3 first:mt-0">
                      <h3 className="text-sm font-medium text-ink">{group.title}</h3>
                      <p className="mt-0.5 text-xs text-ink-muted">{group.blurb}</p>

                      <ul className="mt-2 divide-y divide-ink/8 rounded-md border border-ink/10">
                        {rows.map(({ item, state }) => (
                          <li key={item.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3 py-2.5">
                            <span className="min-w-0 flex-1 basis-56">
                              <span className="block text-sm text-ink">{item.label}</span>
                              <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
                              <span className="mt-1 block text-[11px] text-ink-subtle">
                                {state!.effective ? "Allowed" : "Not allowed"} · {SOURCE_LABEL[state!.source] ?? state!.source}
                              </span>
                              {lockReason(state!) && (
                                <span className="mt-0.5 block text-[11px] text-ink-subtle">{lockReason(state!)}</span>
                              )}
                            </span>

                            {state!.editable && (
                            <span className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => apply(member.userId, item.key, "grant")}
                                aria-pressed={state!.source === "granted"}
                                className={`min-h-9 rounded-lg px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
                                  state!.source === "granted"
                                    ? "bg-pitch-600/15 text-forest-800 ring-1 ring-pitch-600/30"
                                    : "text-ink-muted hover:bg-ink/[0.04]"
                                }`}
                              >
                                Allow
                              </button>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => apply(member.userId, item.key, "deny")}
                                aria-pressed={state!.source === "denied"}
                                className={`min-h-9 rounded-lg px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
                                  state!.source === "denied"
                                    ? "bg-amber-500/15 text-amber-900 ring-1 ring-amber-500/30"
                                    : "text-ink-muted hover:bg-ink/[0.04]"
                                }`}
                              >
                                Withhold
                              </button>
                              {state!.overrideId && (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => reset(state!.overrideId as string)}
                                  className="min-h-9 rounded-lg px-2.5 text-xs font-medium text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
                                >
                                  Reset
                                </button>
                              )}
                            </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
