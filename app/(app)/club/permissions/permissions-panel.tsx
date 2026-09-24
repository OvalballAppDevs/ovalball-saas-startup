"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { GROUPS } from "@ovalball/contracts/club/permission-groups"
import {
  effectiveLabel,
  lockSentence,
  permissionReasonRule,
  roleDefaultSentence,
  sourceSentence,
  stateOf,
  type PermissionRow,
  type PermissionScope,
} from "@ovalball/contracts/club/permissions"

import { applyClubPreset, clearClubCapability, setClubCapability, setTeamCapability, type DelegationResult } from "./actions"

/**
 * A NAMED JOB, rather than a list of switches (V-3 / AC.Presets).
 *
 * A club does not think "allow venue.pitch_allocation.view and .manage". It
 * thinks "Nadia is doing the pitch allocation this season". `mayApply` is
 * answered by the database asking the same question the write will ask, so the
 * screen never offers a button that then refuses.
 */
export interface CapabilityPreset {
  presetKey: string
  label: string
  description: string
  capabilityLabels: string[]
  mayApply: boolean
}

export interface ClubMember {
  userId: string
  name: string
  /** So a row whose person has no name recorded is still identifiable. */
  email: string
  roleLabel: string
  capabilities: PermissionRow[]
}

/**
 * WHO IN THIS CLUB MAY DO WHAT (CA-M4: three states, the source visible).
 *
 * NO RAW CAPABILITY KEYS. A club administrator is deciding whether a
 * particular coach may cancel a match; `fixture.cancel` is how the database
 * writes that down, not how the decision is described to the person making
 * it. The groups (the shared contract) match how the work is actually divided
 * at a club -- fixtures, training, pitch allocation, the calendar -- rather
 * than the shape of the capability catalogue.
 *
 * THREE STATES, NOT A TOGGLE. "Allowed" has two very different meanings: allowed
 * by their ROLE disappears the day they stop being a Team Manager; allowed
 * because somebody DECIDED it stays until it is undone. Every row therefore
 * shows the effective answer with where it came from and, when a decision
 * exists, what the role default would otherwise give -- so "Use Role Default"
 * is a real choice rather than a mystery button. The server computes all three
 * (`internal.person_capability_rows`); this panel only shows them.
 *
 * A REASON IS ASKED, NOT INVENTED. A withhold needs a reason the server records;
 * an allow or a restore takes one when given. The rule is the contract's, which
 * states the server's own.
 */

type Action = { kind: "allow" | "withhold"; userId: string; key: string } | { kind: "restore"; userId: string; overrideId: string } | { kind: "preset"; userId: string; presetKey: string }

function actionRule(action: Action): "required" | "optional" {
  if (action.kind === "preset") return "optional"
  return permissionReasonRule(action.kind)
}

export function ClubPermissionsPanel({
  clubId,
  members,
  presets,
  teamId,
  teamName,
  groups = GROUPS,
  emptyMessage = "This club has no active members to give permissions to yet.",
}: {
  clubId: string
  members: ClubMember[]
  presets: CapabilityPreset[]
  /**
   * Present when the club is deciding for ONE TEAM. The rows, the sources and the restore are identical
   * -- a team decision is the same decision at a different scope, so it gets the same screen rather
   * than a parallel one. Only where the write goes changes.
   */
  teamId?: string
  teamName?: string
  groups?: typeof GROUPS
  emptyMessage?: string
}) {
  const [openMember, setOpenMember] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<{ message: string; href?: string } | null>(null)
  const [asking, setAsking] = useState<Action | null>(null)
  const [reason, setReason] = useState("")

  const scope: PermissionScope = teamId ? { kind: "team", teamId, teamName: teamName ?? "this team" } : { kind: "club" }
  const currentPath = teamId ? `/club/permissions?team=${teamId}` : "/club/permissions"

  function settle(result: DelegationResult) {
    if (!result.ok) setError({ message: result.error, href: result.href })
  }

  function begin(action: Action) {
    setError(null)
    setAsking(action)
    setReason("")
  }

  function cancel() {
    setAsking(null)
    setReason("")
  }

  function confirm() {
    if (!asking) return
    const action = asking
    const given = reason.trim()
    if (actionRule(action) === "required" && given.length === 0) return
    setError(null)
    startTransition(async () => {
      let result: DelegationResult
      switch (action.kind) {
        case "allow":
        case "withhold": {
          const effect = action.kind === "allow" ? "grant" : "deny"
          result = teamId
            ? await setTeamCapability(action.userId, action.key, clubId, teamId, effect, given)
            : await setClubCapability(action.userId, action.key, clubId, effect, given)
          break
        }
        case "restore":
          result = await clearClubCapability(action.overrideId, given)
          break
        case "preset":
          result = await applyClubPreset(action.userId, action.presetKey, clubId, given)
          break
      }
      settle(result)
      setAsking(null)
      setReason("")
    })
  }

  if (members.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-4 py-8 text-center text-sm text-ink-muted">
        {emptyMessage}
      </p>
    )
  }

  const isAsking = (a: Partial<Action> & { userId: string }) =>
    asking !== null &&
    asking.userId === a.userId &&
    asking.kind === a.kind &&
    ("key" in a ? (asking as { key?: string }).key === a.key : true) &&
    ("presetKey" in a ? (asking as { presetKey?: string }).presetKey === a.presetKey : true)

  const reasonForm = (label: string) => {
    if (!asking) return null
    const rule = actionRule(asking)
    const required = rule === "required"
    const fieldId = `permission-reason-${asking.userId}`
    return (
      <form
        className="mt-2 flex w-full flex-col gap-2 rounded-md border border-ink/10 bg-ink/[0.02] px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          confirm()
        }}
      >
        <label htmlFor={fieldId} className="text-xs font-medium text-ink">
          {required ? "Reason" : "Reason (Optional)"}
        </label>
        <input
          id={fieldId}
          autoFocus
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          placeholder={required ? "Recorded with the decision" : "Recorded with the decision, if given"}
          className="h-9 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending || (required && reason.trim().length === 0)}
            className="min-h-9 rounded-lg bg-forest-800 px-3 text-xs font-medium text-white outline-none hover:bg-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
          >
            {pending ? "Saving…" : label}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={cancel}
            className="min-h-9 rounded-lg px-3 text-xs font-medium text-ink-muted outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive-text">
          {error.message}
          {error.href && (
            <>
              {" "}
              <Link
                href={`${error.href}?next=${encodeURIComponent(currentPath)}`}
                className="font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Verify Now
              </Link>
            </>
          )}
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
                <span className="block truncate text-xs text-ink-muted">
                  {[member.roleLabel, member.email].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-xs text-ink-muted">
                {granted} of {member.capabilities.length} allowed
              </span>
            </button>

            {open && (
              <div className="border-t border-ink/8 px-4 py-3">
                {presets.length > 0 && (
                  <section className="rounded-lg bg-ink/[0.03] px-3 py-3">
                    <h3 className="text-sm font-medium text-ink">Give them a job</h3>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Everything that job needs, allowed in one go. Each permission is recorded separately, so you
                      can still change any one of them below afterwards.
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {presets.map((preset) => (
                        <button
                          key={preset.presetKey}
                          type="button"
                          disabled={pending || !preset.mayApply}
                          aria-pressed={isAsking({ kind: "preset", userId: member.userId, presetKey: preset.presetKey })}
                          title={
                            preset.mayApply
                              ? `${preset.description} Allows: ${preset.capabilityLabels.join(", ")}.`
                              : "You cannot give a permission you do not hold yourself."
                          }
                          onClick={() => begin({ kind: "preset", userId: member.userId, presetKey: preset.presetKey })}
                          className="min-h-11 rounded-lg border border-ink/15 bg-white px-3 py-2 text-xs font-medium text-ink outline-none hover:bg-pitch-50 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {asking?.kind === "preset" && asking.userId === member.userId && reasonForm("Give Job")}
                  </section>
                )}

                {groups.map((group) => {
                  const rows = group.items
                    .map((item) => ({ item, row: member.capabilities.find((c) => c.key === item.key) }))
                    .filter((r): r is { item: (typeof group.items)[number]; row: PermissionRow } => Boolean(r.row))

                  if (rows.length === 0) return null

                  return (
                    <section key={group.title} className="mt-3 first:mt-0">
                      <h3 className="text-sm font-medium text-ink">{group.title}</h3>
                      <p className="mt-0.5 text-xs text-ink-muted">{group.blurb}</p>

                      <ul className="mt-2 divide-y divide-ink/8 rounded-md border border-ink/10">
                        {rows.map(({ item, row }) => {
                          const state = stateOf(row)
                          const lock = lockSentence(row)
                          const askingHere =
                            asking !== null &&
                            asking.userId === member.userId &&
                            ((asking.kind !== "preset" && asking.kind !== "restore" && asking.key === item.key) ||
                              (asking.kind === "restore" && row.decision?.id === asking.overrideId))
                          return (
                            <li key={item.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3 py-2.5">
                              <span className="min-w-0 flex-1 basis-56">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="text-sm text-ink">{item.label}</span>
                                  {row.decision && <DecisionBadge row={row} />}
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
                                <span className="mt-1 block text-[11px] text-ink-subtle">
                                  {effectiveLabel(row)} · {sourceSentence(row, scope)}
                                </span>
                                {row.decision && (
                                  <span className="block text-[11px] text-ink-subtle">Role default: {roleDefaultSentence(row)}</span>
                                )}
                                {lock && <span className="mt-0.5 block text-[11px] text-ink-subtle">{lock}</span>}
                              </span>

                              {row.editable && (
                                <span className="flex shrink-0 items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => begin({ kind: "allow", userId: member.userId, key: item.key })}
                                    aria-pressed={state === "allow"}
                                    className={`min-h-9 rounded-lg px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
                                      state === "allow"
                                        ? "bg-pitch-600/15 text-forest-800 ring-1 ring-pitch-600/30"
                                        : "text-ink-muted hover:bg-ink/[0.04]"
                                    }`}
                                  >
                                    Allow
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => begin({ kind: "withhold", userId: member.userId, key: item.key })}
                                    aria-pressed={state === "withhold"}
                                    className={`min-h-9 rounded-lg px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
                                      state === "withhold"
                                        ? "bg-amber-500/15 text-amber-900 ring-1 ring-amber-500/30"
                                        : "text-ink-muted hover:bg-ink/[0.04]"
                                    }`}
                                  >
                                    Withhold
                                  </button>
                                  {row.decision && (
                                    <button
                                      type="button"
                                      disabled={pending}
                                      onClick={() => begin({ kind: "restore", userId: member.userId, overrideId: row.decision!.id })}
                                      className="min-h-9 rounded-lg px-2.5 text-xs font-medium text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
                                    >
                                      Use Role Default
                                    </button>
                                  )}
                                </span>
                              )}

                              {askingHere &&
                                reasonForm(asking!.kind === "allow" ? "Allow" : asking!.kind === "withhold" ? "Withhold" : "Use Role Default")}
                            </li>
                          )
                        })}
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

/** The decision, visible: ordinary configuration in a quiet tint, never an alarm. */
function DecisionBadge({ row }: { row: PermissionRow }) {
  const decision = row.decision!
  if (decision.expired) {
    return <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink-muted">Expired decision</span>
  }
  if (decision.effect === "grant") {
    return <span className="rounded-full bg-pitch-600/15 px-2 py-0.5 text-[11px] font-medium text-forest-800">Allowed explicitly</span>
  }
  return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-900">Withheld</span>
}
