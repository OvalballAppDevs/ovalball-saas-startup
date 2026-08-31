"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { setTeamActive, updateTeam } from "./actions"

const AGE_GROUPS = ["U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18"] as const
const SENIOR_SQUAD_OPTIONS = ["1st", "2nd", "3rd", "4th", "5th"] as const
const YOUTH_SQUAD_OPTIONS = ["A", "B", "C", "D"] as const

export interface TeamEditData {
  id: string
  displayName: string
  category: "senior" | "youth"
  ageGroup: string | null
  squadDesignation: string | null
  gender: "mens" | "womens" | "mixed" | null
  active: boolean
}

export function TeamEditForm({ team }: { team: TeamEditData }) {
  const [displayName, setDisplayName] = useState(team.displayName)
  const [category, setCategory] = useState(team.category)
  const [ageGroup, setAgeGroup] = useState(team.ageGroup ?? "U12")
  const [squadDesignation, setSquadDesignation] = useState(team.squadDesignation ?? "")
  const [gender, setGender] = useState(team.gender ?? "mixed")
  const [active, setActive] = useState(team.active)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [archiveStatus, setArchiveStatus] = useState<"idle" | "working">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await updateTeam({
      teamId: team.id,
      displayName: displayName.trim(),
      category,
      ageGroup: category === "youth" ? ageGroup : null,
      squadDesignation: squadDesignation.trim() || null,
      gender,
    })
    if (result.ok) {
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  async function handleToggleActive() {
    setArchiveStatus("working")
    setError(null)
    const result = await setTeamActive(team.id, !active)
    setArchiveStatus("idle")
    if (result.ok) setActive(!active)
    else setError(result.error)
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      {!active && (
        <div className="mb-5 rounded-lg bg-ink/5 px-3.5 py-2.5 text-sm text-ink/60">
          This team is archived. It&apos;s hidden from new fixture requests and team pickers, but its fixtures,
          messages, and past assignments are untouched.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="edit-team-name" className="text-ink/80">
            Team name
          </Label>
          <Input
            id="edit-team-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label htmlFor="edit-team-category" className="text-ink/80">
            Category
          </Label>
          <select
            id="edit-team-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as "senior" | "youth")}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="youth">Youth</option>
            <option value="senior">Senior</option>
          </select>
        </div>
        {category === "youth" && (
          <div>
            <Label htmlFor="edit-team-age-group" className="text-ink/80">
              Age group
            </Label>
            <select
              id="edit-team-age-group"
              value={ageGroup}
              onChange={(e) => setAgeGroup(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
            >
              {AGE_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label htmlFor="edit-team-squad" className="text-ink/80">
            {category === "senior" ? "Team number" : "Squad"}
          </Label>
          <select
            id="edit-team-squad"
            value={squadDesignation}
            onChange={(e) => setSquadDesignation(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="">{category === "senior" ? "1st (default)" : "Just one team"}</option>
            {(category === "senior" ? SENIOR_SQUAD_OPTIONS : YOUTH_SQUAD_OPTIONS).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink/45">
            {category === "senior"
              ? "Only needed once you run more than one senior side."
              : "Only needed once this age group has more than one team."}
          </p>
        </div>
        <div>
          <Label htmlFor="edit-team-gender" className="text-ink/80">
            Gender
          </Label>
          <select
            id="edit-team-gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as "mens" | "womens" | "mixed")}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="mixed">Mixed</option>
            <option value="mens">Men&apos;s</option>
            <option value="womens">Women&apos;s</option>
          </select>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-5">
        <div className="flex items-center gap-3">
          <Button type="button" className="h-10" disabled={status === "saving" || !displayName.trim()} onClick={handleSave}>
            {status === "saving" ? "Saving…" : "Save changes"}
          </Button>
          {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
        </div>
        <Button type="button" variant="outline" className="h-10" disabled={archiveStatus === "working"} onClick={handleToggleActive}>
          {archiveStatus === "working" ? "Working…" : active ? "Archive team" : "Reactivate team"}
        </Button>
      </div>
    </div>
  )
}
