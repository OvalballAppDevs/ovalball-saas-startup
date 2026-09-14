"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { quickCreateCompetition } from "./actions"

/**
 * ADD A COMPETITION -- A NAME, AND UNION OR LEAGUE.
 *
 * Both are required, and the code is never assumed: Union and League
 * catalogues are kept apart, so a competition filed under the wrong code would
 * be offered to the wrong clubs.
 *
 * That is all a competition needs to exist and be selectable: the season
 * edition is created for the code's current canonical season. Areas, format,
 * teams and the draw are all optional and can follow, in the Competition
 * Creator. When no season is registered for the code, it says so rather than
 * inventing one.
 */
export function QuickCreateCompetition() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [code, setCode] = useState<"union" | "league" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    name: string
    editionId: string | null
    seasonName: string | null
    notice: string | null
  } | null>(null)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!code) return setError("Choose Union or League.")
    start(async () => {
      const r = await quickCreateCompetition(name, code)
      if (!r.ok) return setError(r.error)
      setCreated({
        name: name.trim(),
        editionId: r.editionId,
        seasonName: r.seasonName,
        notice: r.needsAttention,
      })
      setName("")
      setCode(null)
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-ink/10 bg-white p-4"
    >
      <p className="text-sm font-medium text-ink">Add a Competition</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label
            htmlFor="quick-competition-name"
            className="text-sm text-ink/80"
          >
            Name
          </label>
          <input
            id="quick-competition-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lancashire Cup"
            className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400/40"
          />
        </div>
        <div>
          <p id="quick-competition-code" className="text-sm text-ink/80">
            Rugby Code
          </p>
          <div
            className="mt-1 inline-flex h-10 rounded-lg border border-ink/15 p-0.5"
            role="radiogroup"
            aria-labelledby="quick-competition-code"
            aria-required="true"
          >
            {(["union", "league"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={code === c}
                onClick={() => setCode(c)}
                className={cn(
                  "min-w-20 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                  code === c
                    ? "bg-forest-800 font-medium text-white"
                    : "text-ink hover:bg-ink/[0.05]"
                )}
              >
                {c === "union" ? "Union" : "League"}
              </button>
            ))}
          </div>
        </div>
        <Button
          type="submit"
          className="h-10"
          disabled={pending || !name.trim() || !code}
        >
          {pending ? "Saving…" : "Save Competition"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive-text">
          {error}
        </p>
      )}
      {created && (
        <p role="status" className="mt-2 text-sm text-ink">
          {created.editionId ? (
            <>
              {created.name} is ready for {created.seasonName}.{" "}
              <Link
                href={`/fixtures/competitions/${created.editionId}/details`}
                className="font-medium text-forest-800 underline underline-offset-2"
              >
                Open in Competition Creator
              </Link>
            </>
          ) : (
            <>
              {created.name} was added. {created.notice}
            </>
          )}
        </p>
      )}
    </form>
  )
}
