"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { updateFixtureOpposition, type TeamSearchResult } from "../actions"
import { OpponentResolver } from "../opponent-resolver"

/**
 * Change Away Team / Change Home Team for the OPPONENT side (Reconciliation
 * complaint 7) -- the prominent, hero-level counterpart to OwningTeamEditor.
 * This is the ONE place opposition gets corrected now (moved up from the
 * "Edit details" accordion, which previously duplicated this exact control
 * -- complaint 34/35: one operation, one place, not two).
 *
 * Now also supports the structured missing-team age/gender/squad picker
 * (previously only the Calendar/Add-Fixture callers of OpponentResolver
 * got it) -- a real live-tested gap: this dialog's opponent-club search
 * genuinely could not express an age group at all when the club had no
 * matching team, so a resolved club plus an empty/stale free-text field
 * was the only outcome, which is exactly the bug that produced "Persistent
 * Test Fixture" showing where an age group should. Since this dialog
 * corrects an EXISTING fixture rather than sending a new request, a
 * structured-but-unresolved choice doesn't go through the request/accept
 * workflow here -- it's composed into a clear, honest description ("Club
 * Name -- Under 14", "Club Name -- Under 12 Girls B") via the same
 * update_fixture_opposition RPC every other correction on this page uses,
 * never silently dropped and never presented as if it were a real
 * resolved team.
 */
export function OpponentTeamEditor({
  fixtureId,
  owningTeamId,
  currentTeam,
  currentDirectoryId,
  currentRawText,
  sideLabel,
}: {
  fixtureId: string
  owningTeamId: string
  currentTeam: TeamSearchResult | null
  currentDirectoryId: string | null
  currentRawText: string
  /** "Home" or "Away" -- whichever this opponent side currently is, purely for copy. */
  sideLabel: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [team, setTeam] = useState<TeamSearchResult | null>(currentTeam)
  const [directoryId, setDirectoryId] = useState<string | null>(currentDirectoryId)
  const [rawText, setRawText] = useState(currentRawText)
  const [missingTeamGender, setMissingTeamGender] = useState<"boys" | "girls" | null>(null)
  const [missingTeamSquad, setMissingTeamSquad] = useState<string | null>(null)
  const [missingTeamAgeGroup, setMissingTeamAgeGroup] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function composeStructuredDescription(clubName: string): string {
    const genderLabel = missingTeamGender === "girls" ? " Girls" : ""
    const squadLabel = missingTeamSquad ? ` ${missingTeamSquad}` : ""
    return `${clubName} — ${missingTeamAgeGroup}${genderLabel}${squadLabel}`
  }

  async function handleConfirm() {
    const hasStructuredIdentity = Boolean(directoryId && missingTeamGender && missingTeamAgeGroup)
    if (!rawText.trim() && !team && !directoryId) {
      setError("An opponent (resolved team, or a description) is required.")
      return
    }
    setWorking(true)
    setError(null)
    const finalRawText = hasStructuredIdentity ? composeStructuredDescription(rawText || team?.clubName || "this club") : rawText || team?.clubName || ""
    const result = await updateFixtureOpposition(fixtureId, team?.teamId ?? null, directoryId, finalRawText)
    setWorking(false)
    if (result.ok) {
      setOpen(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setTeam(currentTeam)
          setDirectoryId(currentDirectoryId)
          setRawText(currentRawText)
          setMissingTeamGender(null)
          setMissingTeamSquad(null)
          setMissingTeamAgeGroup(null)
        }
        setError(null)
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-ink/45 outline-none hover:text-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400"
          />
        }
      >
        <Pencil className="size-3" />
        Change
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change {sideLabel.toLowerCase()} team</DialogTitle>
          <DialogDescription>Resolves to the canonical Club Directory and Team Directory &mdash; never a free-text name alone.</DialogDescription>
        </DialogHeader>
        <OpponentResolver
          owningTeamId={owningTeamId}
          selectedTeam={team}
          onSelectTeam={setTeam}
          selectedDirectoryId={directoryId}
          onSelectDirectory={setDirectoryId}
          rawText={rawText}
          onRawTextChange={setRawText}
          missingTeamGender={missingTeamGender}
          onMissingTeamGenderChange={setMissingTeamGender}
          missingTeamSquad={missingTeamSquad}
          onMissingTeamSquadChange={setMissingTeamSquad}
          missingTeamAgeGroup={missingTeamAgeGroup}
          onMissingTeamAgeGroupChange={setMissingTeamAgeGroup}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
          <Button type="button" className="h-9" disabled={working} onClick={handleConfirm}>
            {working ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
