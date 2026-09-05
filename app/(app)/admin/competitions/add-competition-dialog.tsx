"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createCompetition } from "./actions"
import type { GeographicArea } from "./page"

/**
 * CREATE A GLOBAL COMPETITION -- a genuinely privileged, product-wide
 * action, distinct from an ordinary Club Admin's fixture form (which only
 * ever picks from this directory, never extends it). Area is either
 * National or a set of specific counties, never both -- the picker itself
 * makes that structurally impossible (multi-select is disabled while
 * National is on), matching the database-level guard.
 */
export function AddCompetitionDialog({ areas }: { areas: GeographicArea[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [rugbyCode, setRugbyCode] = useState<"union" | "league">("union")
  const [isNational, setIsNational] = useState(false)
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([])
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  function toggleArea(id: string) {
    setSelectedAreaIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]))
  }

  const canSubmit = name.trim().length > 0 && (isNational || selectedAreaIds.length > 0)

  async function handleConfirm() {
    setStatus("saving")
    setError(null)
    const result = await createCompetition({
      name: name.trim(),
      description: description.trim() || null,
      rugbyCode,
      isNational,
      areaIds: isNational ? [] : selectedAreaIds,
    })
    if (result.ok) {
      setStatus("idle")
      setConfirmOpen(false)
      setOpen(false)
      setName("")
      setDescription("")
      setIsNational(false)
      setSelectedAreaIds([])
      router.refresh()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (!open) {
    return (
      <Button type="button" className="h-10" onClick={() => setOpen(true)}>
        Add competition
      </Button>
    )
  }

  const areasByNation = new Map<string, GeographicArea[]>()
  for (const a of areas) {
    const list = areasByNation.get(a.nation) ?? []
    list.push(a)
    areasByNation.set(a.nation, list)
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Add a competition</p>
      <p className="mt-1 text-sm text-ink/50">
        This extends the global Competition Directory every club&apos;s fixture form picks from. Scope it to specific
        counties, or mark it National.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="competition-name" className="text-ink/80">
            Name
          </Label>
          <Input
            id="competition-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lancashire Cup"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="competition-description" className="text-ink/80">
            Description (optional)
          </Label>
          <Input
            id="competition-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Metadata only -- never used as logic"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label className="text-ink/80">Rugby code</Label>
          <select
            value={rugbyCode}
            onChange={(e) => setRugbyCode(e.target.value as "union" | "league")}
            className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="union">Union</option>
            <option value="league">League</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex h-11 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={isNational}
              onChange={(e) => {
                setIsNational(e.target.checked)
                if (e.target.checked) setSelectedAreaIds([])
              }}
              className="size-4 accent-pitch-600"
            />
            <span className="text-ink/70">National (not scoped to specific counties)</span>
          </label>
        </div>

        <div className={`sm:col-span-2 ${isNational ? "pointer-events-none opacity-40" : ""}`}>
          <Label className="text-ink/80">Counties / areas</Label>
          <div className="mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-ink/15 bg-white p-3">
            {Array.from(areasByNation.entries()).map(([nation, list]) => (
              <div key={nation} className="mb-3 last:mb-0">
                <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">{nation}</p>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {list.map((a) => (
                    <label key={a.id} className="flex items-center gap-1.5 text-sm text-ink/70">
                      <input type="checkbox" checked={selectedAreaIds.includes(a.id)} onChange={() => toggleArea(a.id)} className="size-3.5 accent-pitch-600" />
                      {a.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink/40">{selectedAreaIds.length} selected</p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger render={<Button type="button" className="h-9" disabled={!canSubmit} />}>Review and add</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add &ldquo;{name.trim()}&rdquo; to the Competition Directory?</DialogTitle>
              <DialogDescription>
                This is a product-wide change, not a per-club one. Every {rugbyCode === "union" ? "Union" : "League"} club
                in Ovalball will immediately be able to select{" "}
                <span className="font-medium text-ink">{name.trim()}</span> for their fixtures &mdash; no code change,
                no deploy.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
              <Button type="button" className="h-9" disabled={status === "saving"} onClick={handleConfirm}>
                {status === "saving" ? "Adding…" : "Add competition"}
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
