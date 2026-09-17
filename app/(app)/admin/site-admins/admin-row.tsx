"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { changeSiteAdminRole, revokeActiveSiteAdmin, setCompetitionsAccess, setDiagnosticAccess, setFixtureSupportAccess, setGlobalLookupsAccess, setSeasonsAccess, setTeamCatalogueAccess } from "./actions"
import { ADMIN_PROFILES, profileKeyFor, profileLabel } from "./profiles"

const MIN_REASON = 10

export interface ActiveSiteAdminData {
  userId: string
  email: string | null
  name: string
  adminRole: string
  grantedAt: string
  diagnosticClubAccess: boolean
  manageTeamCatalogue: boolean
  manageCompetitions: boolean
  manageFixtureSupport: boolean
  manageGlobalLookups: boolean
  manageSeasons: boolean
}

export function AdminRow({ admin, isSelf }: { admin: ActiveSiteAdminData; isSelf: boolean }) {
  const [adminRole, setAdminRole] = useState(admin.adminRole)
  const [diagnosticAccess, setDiagnosticAccessState] = useState(admin.diagnosticClubAccess)
  const [teamCatalogueAccess, setTeamCatalogueAccessState] = useState(admin.manageTeamCatalogue)
  const [competitionsAccess, setCompetitionsAccessState] = useState(admin.manageCompetitions)
  const [fixtureSupportAccess, setFixtureSupportAccessState] = useState(admin.manageFixtureSupport)
  const [globalLookupsAccess, setGlobalLookupsAccessState] = useState(admin.manageGlobalLookups)
  const [seasonsAccess, setSeasonsAccessState] = useState(admin.manageSeasons)
  const [working, setWorking] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // SLICE 7c: a profile change and a revocation both need a reason now, so
  // neither can be a single click any more. `pending` is what the
  // administrator has chosen but not yet justified.
  const [pending, setPending] = useState<{ kind: "role"; next: string } | { kind: "revoke" } | null>(null)
  const [reason, setReason] = useState("")

  const reasonReady = reason.trim().length >= MIN_REASON

  function cancelPending() {
    setPending(null)
    setReason("")
    setError(null)
  }

  async function handleDiagnosticToggle(next: boolean) {
    const previous = diagnosticAccess
    setDiagnosticAccessState(next)
    setWorking(true)
    setError(null)
    const result = await setDiagnosticAccess(admin.userId, next)
    setWorking(false)
    if (!result.ok) {
      setDiagnosticAccessState(previous)
      setError(result.error)
    }
  }

  async function handleTeamCatalogueToggle(next: boolean) {
    const previous = teamCatalogueAccess
    setTeamCatalogueAccessState(next)
    setWorking(true)
    setError(null)
    const result = await setTeamCatalogueAccess(admin.userId, next)
    setWorking(false)
    if (!result.ok) {
      setTeamCatalogueAccessState(previous)
      setError(result.error)
    }
  }

  async function handleCompetitionsToggle(next: boolean) {
    const previous = competitionsAccess
    setCompetitionsAccessState(next)
    setWorking(true)
    setError(null)
    const result = await setCompetitionsAccess(admin.userId, next)
    setWorking(false)
    if (!result.ok) {
      setCompetitionsAccessState(previous)
      setError(result.error)
    }
  }

  async function handleFixtureSupportToggle(next: boolean) {
    const previous = fixtureSupportAccess
    setFixtureSupportAccessState(next)
    setWorking(true)
    setError(null)
    const result = await setFixtureSupportAccess(admin.userId, next)
    setWorking(false)
    if (!result.ok) {
      setFixtureSupportAccessState(previous)
      setError(result.error)
    }
  }

  async function handleGlobalLookupsToggle(next: boolean) {
    const previous = globalLookupsAccess
    setGlobalLookupsAccessState(next)
    setWorking(true)
    setError(null)
    const result = await setGlobalLookupsAccess(admin.userId, next)
    setWorking(false)
    if (!result.ok) {
      setGlobalLookupsAccessState(previous)
      setError(result.error)
    }
  }

  async function handleSeasonsToggle(next: boolean) {
    const previous = seasonsAccess
    setSeasonsAccessState(next)
    setWorking(true)
    setError(null)
    const result = await setSeasonsAccess(admin.userId, next)
    setWorking(false)
    if (!result.ok) {
      setSeasonsAccessState(previous)
      setError(result.error)
    }
  }

  // No optimistic update here, unlike the add-on toggles above: moving
  // somebody UP TO Full Site Admin goes through the two-admin gate and will
  // be refused unless a second administrator has already approved it, so
  // showing the new profile before the server agrees would show an authority
  // change that did not happen.
  async function confirmPending() {
    if (!pending || !reasonReady) return
    setWorking(true)
    setError(null)
    if (pending.kind === "revoke") {
      const result = await revokeActiveSiteAdmin(admin.userId, reason)
      setWorking(false)
      if (result.ok) {
        setRevoked(true)
        cancelPending()
      } else {
        setError(result.error)
      }
      return
    }
    const profileKey = profileKeyFor(pending.next)
    if (!profileKey) {
      setWorking(false)
      setError("That is not a Site Admin profile.")
      return
    }
    const result = await changeSiteAdminRole(admin.userId, profileKey, reason)
    setWorking(false)
    if (result.ok) {
      setAdminRole(pending.next)
      cancelPending()
    } else {
      setError(result.error)
    }
  }

  if (revoked) {
    return (
      <li className="rounded-lg border border-dashed border-ink/15 bg-white/40 px-4 py-3 text-sm text-ink-muted">
        {admin.name} &mdash; Site Admin access revoked.
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{admin.name}</p>
        <p className="truncate text-xs text-ink-muted">{admin.email ?? "No email on file"}</p>
        {error && <p className="mt-1 text-xs text-destructive-text">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={diagnosticAccess ? "h-8 border-forest-800/30 bg-forest-800/10 text-forest-900" : "h-8 text-ink/60"}
          disabled={working}
          onClick={() => handleDiagnosticToggle(!diagnosticAccess)}
          title="Whether this admin can enter read-only diagnostic club-viewing sessions"
        >
          {diagnosticAccess ? "Diagnostic access: On" : "Diagnostic access: Off"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={teamCatalogueAccess ? "h-8 border-forest-800/30 bg-forest-800/10 text-forest-900" : "h-8 text-ink/60"}
          disabled={working}
          onClick={() => handleTeamCatalogueToggle(!teamCatalogueAccess)}
          title="Whether this admin can add or deactivate global team types in the Team Directory"
        >
          {teamCatalogueAccess ? "Team Directory: On" : "Team Directory: Off"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={competitionsAccess ? "h-8 border-forest-800/30 bg-forest-800/10 text-forest-900" : "h-8 text-ink/60"}
          disabled={working}
          onClick={() => handleCompetitionsToggle(!competitionsAccess)}
          title="Whether this admin can add or deactivate global competitions"
        >
          {competitionsAccess ? "Competitions: On" : "Competitions: Off"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={fixtureSupportAccess ? "h-8 border-forest-800/30 bg-forest-800/10 text-forest-900" : "h-8 text-ink/60"}
          disabled={working}
          onClick={() => handleFixtureSupportToggle(!fixtureSupportAccess)}
          title="Whether this admin can view and post into fixture conversations as Ovalball support"
        >
          {fixtureSupportAccess ? "Fixture support: On" : "Fixture support: Off"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={globalLookupsAccess ? "h-8 border-forest-800/30 bg-forest-800/10 text-forest-900" : "h-8 text-ink/60"}
          disabled={working}
          onClick={() => handleGlobalLookupsToggle(!globalLookupsAccess)}
          title="Whether this admin can add or edit any club's venues and pitches from Lookup Administration"
        >
          {globalLookupsAccess ? "Lookups: On" : "Lookups: Off"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={seasonsAccess ? "h-8 border-forest-800/30 bg-forest-800/10 text-forest-900" : "h-8 text-ink/60"}
          disabled={working}
          onClick={() => handleSeasonsToggle(!seasonsAccess)}
          title="Whether this admin can add, edit, archive, or delete seasons"
        >
          {seasonsAccess ? "Seasons: On" : "Seasons: Off"}
        </Button>
        <select
          value={pending?.kind === "role" ? pending.next : adminRole}
          onChange={(e) => {
            setPending({ kind: "role", next: e.target.value })
            setReason("")
            setError(null)
          }}
          disabled={working || isSelf}
          className="h-9 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600 disabled:opacity-50"
        >
          {ADMIN_PROFILES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {isSelf ? (
          <span className="text-xs text-ink-muted">You</span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-destructive-text hover:bg-destructive/10"
            disabled={working}
            onClick={() => {
              setPending({ kind: "revoke" })
              setReason("")
              setError(null)
            }}
          >
            Revoke
          </Button>
        )}
      </div>

      {pending && (
        <label className="mt-1 flex w-full flex-col gap-1.5 border-t border-ink/8 pt-3 text-sm text-ink">
          <span className="font-medium">
            {pending.kind === "revoke"
              ? `Reason for revoking ${admin.name}'s Site Admin access`
              : `Reason for moving ${admin.name} to ${profileLabel(pending.next)}`}
          </span>
          <span className="text-xs font-normal text-ink-muted">
            {pending.kind === "revoke"
              ? "Their live sessions end as soon as you confirm."
              : "Moving somebody up to Full Site Admin needs a second Full Site Admin to have approved it first."}
          </span>
          <textarea
            className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            value={reason}
            maxLength={500}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          />
          <span className="flex items-center gap-2">
            <Button
              type="button"
              variant={pending.kind === "revoke" ? "destructive" : "default"}
              className="h-9"
              disabled={working || !reasonReady}
              onClick={confirmPending}
            >
              {working ? "Working…" : pending.kind === "revoke" ? "Confirm Revoke" : "Confirm Change"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={cancelPending}>
              Cancel
            </Button>
          </span>
        </label>
      )}
    </li>
  )
}
