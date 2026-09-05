"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { changeSiteAdminRole, revokeActiveSiteAdmin, setCompetitionsAccess, setDiagnosticAccess, setFixtureSupportAccess, setGlobalLookupsAccess, setSeasonsAccess, setTeamCatalogueAccess } from "./actions"
import { ADMIN_PROFILES } from "./profiles"

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

  async function handleRoleChange(next: string) {
    const previous = adminRole
    setAdminRole(next)
    setWorking(true)
    setError(null)
    const result = await changeSiteAdminRole(admin.userId, next)
    setWorking(false)
    if (!result.ok) {
      setAdminRole(previous)
      setError(result.error)
    }
  }

  async function handleRevoke() {
    setWorking(true)
    setError(null)
    const result = await revokeActiveSiteAdmin(admin.userId)
    setWorking(false)
    if (result.ok) setRevoked(true)
    else setError(result.error)
  }

  if (revoked) {
    return (
      <li className="rounded-lg border border-dashed border-ink/15 bg-white/40 px-4 py-3 text-sm text-ink/40">
        {admin.name} &mdash; Site Admin access revoked.
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{admin.name}</p>
        <p className="truncate text-xs text-ink/45">{admin.email ?? "No email on file"}</p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
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
          value={adminRole}
          onChange={(e) => handleRoleChange(e.target.value)}
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
          <span className="text-xs text-ink/45">You</span>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10" disabled={working} onClick={handleRevoke}>
            Revoke
          </Button>
        )}
      </div>
    </li>
  )
}
