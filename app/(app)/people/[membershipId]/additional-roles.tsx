"use client"

import { useState, useTransition } from "react"

import { assignAdditionalRole, endRoleAssignment } from "../actions"

export interface HeldRole {
  assignmentId: string
  roleKey: string
  roleLabel: string
  teamName: string | null
  /** Whether this session may end it -- the database decides; this only shows it. */
  removable: boolean
  /** Set when an appointment is not yet settled, e.g. a Safeguarding Officer nomination. */
  pendingNote: string | null
}

export interface AssignableRole {
  roleKey: string
  label: string
  description: string
}

const FIELD =
  "mt-1 min-h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"

/**
 * THE ROLES A PERSON HOLDS BESIDES THEIR SEAT.
 *
 * The club-wide seat -- Member, Fixture Secretary, Club Admin -- is one
 * three-way choice and lives on the people list. It is not everything a person
 * is. Volunteer is a canonical club role a Club Admin may legitimately give,
 * and before Slice 8 no screen could give it, so `role_assignments` was
 * writable from the database and from Site Admin but not by the person the
 * design says owns it.
 *
 * ROLE IS NOT IDENTITY. One person may be a Volunteer here, a Coach at one
 * team, a Team Manager at another and a parent besides. Nothing on this screen
 * replaces one role with another: each is its own assignment, added and ended
 * on its own, which is why removing one leaves the rest standing.
 *
 * The options offered come from the database's own catalogue and are filtered
 * by what it says this person may assign. Hiding a control is not the boundary
 * -- `assign_role` refuses with 42501 regardless -- but offering one that will
 * refuse is its own kind of lie.
 */
export function AdditionalRoles({
  membershipId,
  personName,
  held,
  assignable,
}: {
  membershipId: string
  personName: string
  held: HeldRole[]
  assignable: AssignableRole[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [roleKey, setRoleKey] = useState(assignable[0]?.roleKey ?? "")
  const [reason, setReason] = useState("")

  function add() {
    setError(null)
    startTransition(async () => {
      const result = await assignAdditionalRole(membershipId, roleKey, null, reason)
      if (result.ok) {
        setAdding(false)
        setReason("")
      } else {
        setError(result.error)
      }
    })
  }

  function end(assignmentId: string) {
    setError(null)
    startTransition(async () => {
      const result = await endRoleAssignment(membershipId, assignmentId, "Removed from Users & Permissions")
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <section className="mt-8" aria-labelledby="person-other-roles">
      <h2 id="person-other-roles" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
        Other Roles
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Everything {personName} is at this club besides their club-wide role. Each one stands on its own — removing
        one leaves the others exactly as they are.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive-text">
          {error}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {held.length === 0 && (
          <li className="rounded-lg border border-dashed border-ink/15 px-4 py-3 text-sm text-ink-muted">
            No other roles recorded.
          </li>
        )}
        {held.map((role) => (
          <li
            key={role.assignmentId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-ink/10 bg-white px-4 py-3"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{role.roleLabel}</span>
              <span className="block text-xs text-ink-muted">
                {[role.teamName, role.pendingNote].filter(Boolean).join(" · ") || "Across the club"}
              </span>
            </span>
            {role.removable && (
              <button
                type="button"
                disabled={pending}
                onClick={() => end(role.assignmentId)}
                className="min-h-11 rounded-lg px-2.5 text-sm font-medium text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {assignable.length > 0 &&
        (adding ? (
          <div className="mt-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
            {/* "Additional Role", not "Role": the Team Access editor further
                down this same page already has a control labelled Role, and two
                controls sharing an accessible name on one page is a real defect
                for anyone navigating by label rather than by sight. */}
            <label htmlFor="additional-role" className="text-sm font-medium text-ink">
              Additional Role
            </label>
            <select id="additional-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)} className={FIELD}>
              {assignable.map((r) => (
                <option key={r.roleKey} value={r.roleKey}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-muted">
              {assignable.find((r) => r.roleKey === roleKey)?.description ?? ""}
            </p>

            {/* Distinct from Team Access's own Reason field, for the same
                reason the select above is "Additional Role". */}
            <label htmlFor="additional-role-reason" className="mt-3 block text-sm font-medium text-ink">
              Reason for This Role
            </label>
            <input
              id="additional-role-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this person is taking it on"
              className={FIELD}
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending || !roleKey}
                onClick={add}
                className="min-h-11 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white outline-none hover:bg-pitch-700 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
              >
                Give Role
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAdding(false)}
                className="min-h-11 rounded-lg border border-ink/15 bg-white px-4 text-sm font-semibold text-ink outline-none hover:border-ink/35 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 min-h-11 rounded-lg border border-ink/15 bg-white px-4 text-sm font-semibold text-ink outline-none hover:border-ink/35 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Give Another Role
          </button>
        ))}
    </section>
  )
}
