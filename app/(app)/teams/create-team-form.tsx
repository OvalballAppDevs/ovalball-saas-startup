"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createTeam } from "./actions"

const AGE_GROUPS = ["U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18"] as const
const SENIOR_SQUAD_OPTIONS = ["1st", "2nd", "3rd", "4th", "5th"] as const
const YOUTH_SQUAD_OPTIONS = ["A", "B", "C", "D"] as const

export function CreateTeamForm({ clubId }: { clubId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [category, setCategory] = useState<"senior" | "youth">("youth")
  const [ageGroup, setAgeGroup] = useState<string>("U12")
  const [squadDesignation, setSquadDesignation] = useState("")
  const [gender, setGender] = useState<"mens" | "womens" | "mixed">("mixed")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button type="button" className="h-10" onClick={() => setOpen(true)}>
        Add a team
      </Button>
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setStatus("saving")
    setError(null)
    const result = await createTeam({
      clubId,
      displayName: displayName.trim(),
      category,
      ageGroup: category === "youth" ? ageGroup : null,
      squadDesignation: squadDesignation.trim() || null,
      gender,
    })
    if (result.ok) {
      setDisplayName("")
      setSquadDesignation("")
      setOpen(false)
      setStatus("idle")
      router.refresh()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Add a team</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="team-name" className="text-ink/80">
            Team name
          </Label>
          <Input
            id="team-name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. U12 A, Men's 1st"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label htmlFor="team-category" className="text-ink/80">
            Category
          </Label>
          <select
            id="team-category"
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
            <Label htmlFor="team-age-group" className="text-ink/80">
              Age group
            </Label>
            <select
              id="team-age-group"
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
          <Label htmlFor="team-squad" className="text-ink/80">
            {category === "senior" ? "Team number" : "Squad"}
          </Label>
          <select
            id="team-squad"
            value={squadDesignation}
            onChange={(e) => setSquadDesignation(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="">
              {category === "senior" ? "1st (default)" : "Just one team"}
            </option>
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
          <Label htmlFor="team-gender" className="text-ink/80">
            Gender
          </Label>
          <select
            id="team-gender"
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

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" className="h-9" disabled={status === "saving" || !displayName.trim()}>
          {status === "saving" ? "Adding…" : "Add team"}
        </Button>
        <Button type="button" variant="ghost" className="h-9" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
