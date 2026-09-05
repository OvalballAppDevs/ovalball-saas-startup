"use client"

import { useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

import { acceptFixtureRequest, acceptFixtureRequestWithTeamAction, declineFixtureRequest, type IncomingRequestResolution } from "./actions"

export interface RequestRowData {
  id: string
  direction: "outgoing" | "incoming"
  teamDisplayName: string
  opponentText: string
  proposedDate: string
  venuePreference: string
  /** Set only for a request made against one of my club's shared mini-rugby
   * calendars rather than one specific team -- see schedulingGroupMembers. */
  schedulingGroupTag?: string | null
  schedulingGroupMembers?: { id: string; name: string; ageGroup: string | null }[]
  /** Set only for a request that named a structured team identity (Phase C)
   * with no real target_team_id yet -- see the matching namedTeam* fields,
   * resolved server-side at render time. */
  namedTeamIdentity?: string | null
  namedTeamResolution?: IncomingRequestResolution | null
  namedTeamExistingId?: string | null
  namedTeamMessage?: string | null
  /** Central Fixture Participant Resolution: true only for Site Admin or a
   * Club Admin of the recipient club -- a Fixtures Secretary sees the
   * request but must escalate a genuine team creation/reactivation. */
  canCreateOrReactivateTeam?: boolean
  /** True when the real created_by actor is a Site Admin -- drives which wording renders (never hardcoded "Site Admin" text independent of who actually created the request). */
  initiatedBySiteAdmin?: boolean
}

/**
 * A shared-calendar request must resolve to a real member team before
 * accepting -- never auto-picked here even when there's only one member,
 * since accept_fixture_request itself is the single source of truth for
 * auto-resolution (calling it with no team lets the RPC decide, matching
 * the "no fake team, no guessed resolution in the client" requirement).
 *
 * A named-identity request goes through accept_fixture_request_with_team_
 * action -- the ONE atomic "Accept Fixture & Create/Reactivate Team" call
 * (Central Fixture Participant Resolution) -- rather than two separate
 * round-trips (create-then-accept), so there is never a moment where a
 * team exists but the fixture wasn't accepted, or vice versa.
 */
/**
 * `canManage` is REQUIRED (no default) so every call site must decide it
 * deliberately -- Accept/Decline/Cancel were previously rendered
 * unconditionally regardless of the viewer's actual authority, a real
 * permission-UI leak found live: a genuine view_only Parent/Player,
 * switched into their team's Parent View, saw a working "Cancel" button
 * on every one of their club's sent fixture requests, purely because this
 * component had no context/authority awareness of its own. Both real
 * callers (fixtures/page.tsx, computed per the active context; fixture-
 * requests-sheet.tsx, always true -- its own page is already gated to
 * genuine club-wide/Site Admin authority) now pass it explicitly. The
 * underlying accept/decline server actions remain the real authorization
 * boundary regardless -- this only stops the app from ever OFFERING the
 * control to someone it already knows can't use it.
 */
export function RequestRow({ request, canManage }: { request: RequestRowData; canManage: boolean }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const isGroupRequest = Boolean(request.schedulingGroupTag)
  const [selectedTeamId, setSelectedTeamId] = useState(request.schedulingGroupMembers?.length === 1 ? request.schedulingGroupMembers[0].id : "")

  const isNamedIdentityRequest = Boolean(request.namedTeamIdentity)
  const needsTeamAction = request.namedTeamResolution === "genuinely_missing" || request.namedTeamResolution === "exists_folded"
  const alreadyReal = request.namedTeamResolution === "exists_active" || request.namedTeamResolution === "has_target_team"
  const blockedElsewhere =
    request.namedTeamResolution === "ambiguous_squad" ||
    request.namedTeamResolution === "pending_rollover" ||
    request.namedTeamResolution === "pending_structural" ||
    request.namedTeamResolution === "no_target_club"

  const primaryActionLabel = request.namedTeamResolution === "exists_folded" ? `Accept fixture & reactivate ${request.namedTeamIdentity}` : `Accept fixture & create ${request.namedTeamIdentity}`

  async function handle(action: "accept" | "decline") {
    setStatus("working")
    setError(null)
    const result =
      action === "accept"
        ? isNamedIdentityRequest
          ? await acceptFixtureRequestWithTeamAction(request.id, needsTeamAction)
          : await acceptFixtureRequest(request.id, isGroupRequest ? selectedTeamId || undefined : undefined)
        : await declineFixtureRequest(request.id)
    if (result.ok) {
      setStatus("done")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  const date = request.proposedDate ? new Date(request.proposedDate + "T00:00:00") : null
  const dateLabel = date?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) ?? "TBC"

  if (status === "done") {
    return (
      <li className="rounded-lg border border-ink/10 bg-white/50 px-4 py-3.5 text-sm text-ink/50">
        {request.teamDisplayName} vs {request.opponentText} &mdash; updated.
      </li>
    )
  }

  return (
    <li
      className={`flex flex-wrap items-center gap-3 rounded-lg border bg-white px-4 py-3.5 ${
        isNamedIdentityRequest && needsTeamAction ? "border-amber-400/60 ring-1 ring-amber-400/20" : "border-ink/10"
      }`}
    >
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
          request.direction === "incoming" ? "bg-pitch-600/15 text-forest-900" : "bg-ink/5 text-ink/60"
        }`}
      >
        {request.direction === "incoming" ? "Received" : "Sent"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {request.teamDisplayName} <span className="text-ink/40">vs</span> {request.opponentText}
        </p>
        <p className="text-xs text-ink/50">
          {dateLabel} · {request.venuePreference}
        </p>
        {isGroupRequest && (
          <p className="mt-1 text-xs text-forest-800">
            Fixture request for: {request.schedulingGroupTag} Mini-Rugby Group &mdash; select the real team below before accepting.
          </p>
        )}
        {isNamedIdentityRequest && needsTeamAction && (
          <p className="mt-1 text-xs text-forest-800">
            {request.initiatedBySiteAdmin ? "Ovalball Site Admin has allocated you a fixture" : `${request.teamDisplayName} has requested a fixture`} against {request.namedTeamIdentity} &mdash;{" "}
            {request.namedTeamMessage}
          </p>
        )}
        {isNamedIdentityRequest && needsTeamAction && !request.canCreateOrReactivateTeam && (
          <p className="mt-1 text-xs text-amber-700">Club Admin approval is required to activate this team.</p>
        )}
        {isNamedIdentityRequest && alreadyReal && (
          <p className="mt-1 text-xs text-forest-800">Fixture request for: {request.namedTeamIdentity} &mdash; team ready, you can accept below.</p>
        )}
        {isNamedIdentityRequest && blockedElsewhere && (
          <p className="mt-1 text-xs text-amber-700">
            Fixture request for: {request.namedTeamIdentity} &mdash; {request.namedTeamMessage}
          </p>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {canManage && (request.direction === "incoming" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isGroupRequest && (
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="h-8 rounded-md border border-ink/15 bg-white px-2 text-xs outline-none focus-visible:border-pitch-600"
              aria-label="Real team to confirm this fixture for"
            >
              <option value="">Select a team…</option>
              {(request.schedulingGroupMembers ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.ageGroup})
                </option>
              ))}
            </select>
          )}
          {isNamedIdentityRequest && (request.namedTeamResolution === "pending_rollover" || request.namedTeamResolution === "pending_structural") && (
            <Button type="button" size="sm" variant="outline" className="h-8" nativeButton={false} render={<Link href="/club/rollover" />}>
              Review Season Rollover
            </Button>
          )}
          {isNamedIdentityRequest && request.namedTeamResolution === "ambiguous_squad" && (
            <Button type="button" size="sm" variant="outline" className="h-8" nativeButton={false} render={<Link href="/teams" />}>
              Review squads
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={
              status === "working" ||
              (isGroupRequest && !selectedTeamId) ||
              (isNamedIdentityRequest && blockedElsewhere) ||
              (isNamedIdentityRequest && needsTeamAction && !request.canCreateOrReactivateTeam)
            }
            title={isNamedIdentityRequest && needsTeamAction && !request.canCreateOrReactivateTeam ? "Club Admin approval is required to activate this team." : undefined}
            onClick={() => handle("accept")}
          >
            {isNamedIdentityRequest && needsTeamAction ? primaryActionLabel : "Accept"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={status === "working"} onClick={() => handle("decline")}>
            Decline
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" disabled={status === "working"} onClick={() => handle("decline")}>
          Cancel
        </Button>
      ))}
    </li>
  )
}
