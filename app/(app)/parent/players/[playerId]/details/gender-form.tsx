"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"

import { setPlayerGender } from "./actions"

/**
 * "Gender", not "playing pathway".
 *
 * playing_pathway is what Ovalball stores it as, because a team or a
 * competition can be Mixed and a person cannot. That distinction matters
 * inside the domain and means nothing to a parent, who is being asked one
 * plain question about their child. The helper text says why it is being
 * asked, because a rugby-specific reason is the honest one.
 */
export function GenderForm({
  playerId,
  playerFirstName,
  current,
}: {
  playerId: string
  playerFirstName: string
  current: "MALE" | "FEMALE" | null
}) {
  const router = useRouter()
  const [choice, setChoice] = useState<"MALE" | "FEMALE" | null>(current)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)

  async function handleSave() {
    if (!choice) return
    setWorking(true)
    setError(null)
    setOutcome(null)
    const result = await setPlayerGender(playerId, choice)
    setWorking(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOutcome(
      result.resolved
        ? `Saved. ${result.reason ?? `${playerFirstName}'s place for next season is settled.`}`
        : `Saved. ${result.reason ?? "Their club can now confirm next season's team."}`
    )
    router.refresh()
  }

  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-6">
      <fieldset className="m-0 border-0 p-0">
        <legend className="p-0 text-sm font-medium text-ink">Gender</legend>
        <p className="mt-1 max-w-lg text-sm text-ink/60">
          Rugby runs separate boys&rsquo; and girls&rsquo; age grades from Under-12, so clubs need this to put{" "}
          {playerFirstName} in the right team. It is never assumed from the team they happen to be in now.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input
              type="radio"
              name={`gender-${playerId}`}
              checked={choice === "MALE"}
              onChange={() => setChoice("MALE")}
              className="size-4 accent-pitch-600"
            />
            Boys
          </label>
          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input
              type="radio"
              name={`gender-${playerId}`}
              checked={choice === "FEMALE"}
              onChange={() => setChoice("FEMALE")}
              className="size-4 accent-pitch-600"
            />
            Girls
          </label>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive-text">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button
          type="button"
          className="h-11"
          aria-disabled={!choice || working || choice === current}
          aria-describedby={!choice ? `gender-hint-${playerId}` : undefined}
          onClick={() => {
            if (!choice || working || choice === current) return
            void handleSave()
          }}
        >
          {working ? "Saving…" : "Save changes"}
        </Button>
        {!choice && (
          <p id={`gender-hint-${playerId}`} className="text-sm text-ink-muted">
            Choose Boys or Girls to continue.
          </p>
        )}
      </div>

      {outcome && (
        <p
          role="status"
          aria-atomic="true"
          className="mt-4 flex items-start gap-2 rounded-lg bg-mint-100/60 px-3.5 py-3 text-sm text-forest-950"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{outcome}</span>
        </p>
      )}
    </div>
  )
}
