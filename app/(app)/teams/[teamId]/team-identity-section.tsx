"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { clearTeamAlias, setTeamAlias } from "./actions"

export interface TeamIdentityData {
  id: string
  fullLabel: string
  compactLabel: string
  /** Only "B"/"C" carry an alias -- the primary squad has nothing to alias (see AliasEditor below). */
  squadDesignation: string | null
  active: boolean
  alias: string | null
}

/**
 * Section 23-25: replaces the old "Which team is this?" age/category
 * radio-grid identity-switcher. A team's canonical identity
 * (category/age_group/gender/squad_designation) is read-only here --
 * it now only ever changes through Season Rollover, never a manual
 * re-pick on this page (that picker let two admins independently
 * "correct" the same team into conflicting identities, and was the root
 * cause class behind this pass's real Burnley duplicate-team cleanup).
 * The one thing still genuinely editable here is a club-specific display
 * ALIAS for a B/C squad (Section 26-30) -- it only ever changes what's
 * printed (e.g. "U12 Blacks" instead of "U12 B"), never the underlying
 * structural identity.
 */
export function TeamIdentitySection({ team }: { team: TeamIdentityData }) {
  const showAliasEditor = team.squadDesignation === "B" || team.squadDesignation === "C"

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      {!team.active && (
        <div className="mb-5 rounded-lg bg-ink/5 px-3.5 py-2.5 text-sm text-ink/60">
          This team has folded. It&apos;s hidden from new fixture requests and team pickers, but its fixtures,
          messages, and past assignments are untouched. See Team Lifecycle below to reactivate it.
        </div>
      )}

      <div>
        <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Team identity</p>
        <p className="mt-1 font-display text-lg text-ink">{team.fullLabel}</p>
        <p className="text-sm text-ink/50">{team.compactLabel}</p>
        <p className="mt-3 text-xs text-ink/45">
          Team age and canonical identity are progressed through Season Rollover, not edited here.
        </p>
      </div>

      {showAliasEditor && <AliasEditor teamId={team.id} alias={team.alias} />}
    </div>
  )
}

function AliasEditor({ teamId, alias }: { teamId: string; alias: string | null }) {
  const [value, setValue] = useState(alias ?? "")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const dirty = value.trim() !== (alias ?? "")

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const trimmed = value.trim()
    const result = trimmed ? await setTeamAlias(teamId, trimmed) : await clearTeamAlias(teamId)
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="mt-5 border-t border-ink/10 pt-5">
      <Label htmlFor="team-alias" className="text-ink/80">
        Display alias
      </Label>
      <p className="mt-1 text-xs text-ink/50">
        Shown instead of the squad letter everywhere this team appears (e.g. &quot;U12 Blacks&quot; instead of
        &quot;U12 B&quot;). Leave blank to show the squad letter as normal.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Input
          id="team-alias"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Blacks"
          className="h-10 max-w-xs border-ink/15 bg-white"
        />
        <Button type="button" className="h-10" disabled={!dirty || status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
