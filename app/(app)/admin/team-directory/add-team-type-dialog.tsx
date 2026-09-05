"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

import { createTeamType, type CreateTeamTypeInput } from "./actions"

const YOUTH_AGES = ["U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18"]
const MIXED_ELIGIBLE_AGES = new Set(["U6", "U7", "U8", "U9", "U10", "U11"])

type Category = "youth" | "colts" | "senior"

/**
 * CREATE A GLOBAL CANONICAL TEAM TYPE -- a genuinely privileged, product-
 * wide action, distinct from an ordinary Club Admin's Add Team (which only
 * ever picks from this catalogue, never extends it). No free-text name
 * field exists: every field here is a structured identity component, and
 * the resulting label is always generated server-side from them. A
 * confirmation dialog is required before submit, explaining exactly that
 * scope -- this is not a per-club action.
 */
export function AddTeamTypeDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [category, setCategory] = useState<Category>("youth")
  const [ageGroup, setAgeGroup] = useState("U17")
  const [gender, setGender] = useState<"boys" | "girls" | "mixed">("boys")
  const [seniorGender, setSeniorGender] = useState<"mens" | "womens">("mens")
  const [ordinal, setOrdinal] = useState("4th")
  const [coltsLevel, setColtsLevel] = useState<"JuniorColts" | "SeniorColts">("JuniorColts")
  const [allowsSquads, setAllowsSquads] = useState(true)
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  function buildInput(): CreateTeamTypeInput {
    if (category === "colts") {
      return { category: "colts", ageGroup: coltsLevel, gender: null, fixedSquadDesignation: null, allowsSquads: false }
    }
    if (category === "senior") {
      return { category: "senior", ageGroup: null, gender: seniorGender, fixedSquadDesignation: ordinal.trim(), allowsSquads: false }
    }
    return { category: "youth", ageGroup, gender, fixedSquadDesignation: null, allowsSquads }
  }

  function previewLabel(): string {
    if (category === "colts") return coltsLevel === "JuniorColts" ? "Junior Colts" : "Senior Colts"
    if (category === "senior") return `${seniorGender === "womens" ? "Women's" : "Men's"} ${ordinal.trim() || "?"} Team`
    return gender === "girls" ? `Girls ${ageGroup}` : ageGroup
  }

  async function handleConfirm() {
    setStatus("saving")
    setError(null)
    const result = await createTeamType(buildInput())
    if (result.ok) {
      setStatus("idle")
      setConfirmOpen(false)
      setOpen(false)
      router.refresh()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (!open) {
    return (
      <Button type="button" className="h-10" onClick={() => setOpen(true)}>
        Add team type
      </Button>
    )
  }

  const genderOptionsForAge = ageGroup && MIXED_ELIGIBLE_AGES.has(ageGroup) ? (["boys", "girls", "mixed"] as const) : (["boys", "girls"] as const)

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Add a global team type</p>
      <p className="mt-1 text-sm text-ink/50">
        This extends the closed catalogue every club in Ovalball picks from &mdash; it does not create a team for any
        specific club. There is no free-text name: the identity is built from the structured fields below.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-ink/80">Category</Label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="youth">Youth / age-grade</option>
            <option value="colts">Colts</option>
            <option value="senior">Senior</option>
          </select>
        </div>

        {category === "youth" && (
          <>
            <div>
              <Label className="text-ink/80">Age group</Label>
              <select
                value={ageGroup}
                onChange={(e) => {
                  const next = e.target.value
                  setAgeGroup(next)
                  if (gender === "mixed" && !MIXED_ELIGIBLE_AGES.has(next)) setGender("boys")
                }}
                className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
              >
                {YOUTH_AGES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-ink/80">Classification</Label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as "boys" | "girls" | "mixed")}
                className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
              >
                {genderOptionsForAge.map((g) => (
                  <option key={g} value={g}>
                    {g === "mixed" ? "Mixed (mini-rugby default)" : g === "girls" ? "Girls" : "Boys (default)"}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink/40">Mixed is only offered for U6&ndash;U11, matching the app&apos;s real age-grade rule.</p>
            </div>
            <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
              <input type="checkbox" checked={allowsSquads} onChange={(e) => setAllowsSquads(e.target.checked)} className="size-4 accent-pitch-600" />
              <span className="text-ink/70">Clubs may run additional B/C squads at this level</span>
            </label>
          </>
        )}

        {category === "colts" && (
          <div>
            <Label className="text-ink/80">Level</Label>
            <select
              value={coltsLevel}
              onChange={(e) => setColtsLevel(e.target.value as "JuniorColts" | "SeniorColts")}
              className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
            >
              <option value="JuniorColts">Junior Colts</option>
              <option value="SeniorColts">Senior Colts</option>
            </select>
          </div>
        )}

        {category === "senior" && (
          <>
            <div>
              <Label className="text-ink/80">Classification</Label>
              <select
                value={seniorGender}
                onChange={(e) => setSeniorGender(e.target.value as "mens" | "womens")}
                className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
              >
                <option value="mens">Men&apos;s</option>
                <option value="womens">Women&apos;s</option>
              </select>
            </div>
            <div>
              <Label htmlFor="ordinal" className="text-ink/80">
                Ordinal
              </Label>
              <input
                id="ordinal"
                value={ordinal}
                onChange={(e) => setOrdinal(e.target.value)}
                placeholder="e.g. 4th"
                className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
              />
            </div>
          </>
        )}
      </div>

      <p className="mt-4 text-sm text-ink/55">
        This will appear everywhere as <span className="font-medium text-ink">{previewLabel()}</span>.
      </p>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger render={<Button type="button" className="h-9" disabled={category === "senior" && !ordinal.trim()} />}>
            Review and add
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add &ldquo;{previewLabel()}&rdquo; to the global Team Directory?</DialogTitle>
              <DialogDescription>
                This is a product-wide change, not a per-club one. Every club in Ovalball will immediately be able to
                pick <span className="font-medium text-ink">{previewLabel()}</span> from Add Team, and it will appear
                in the signup team checklist &mdash; no code change, no deploy. No club is activated automatically;
                each club still has to add it themselves.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
              <Button type="button" className="h-9" disabled={status === "saving"} onClick={handleConfirm}>
                {status === "saving" ? "Adding…" : "Add to Team Directory"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button type="button" variant="ghost" className="h-9" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
