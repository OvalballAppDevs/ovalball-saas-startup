"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"

import { createTeamJoinCode, revokeTeamJoinCode, type TeamJoinCodeRow } from "./join-code-actions"

/**
 * A TEAM JOIN CODE.
 *
 * Unlike every other invitation Ovalball sends, this one is not addressed to anybody. It is ten
 * characters read out at training or printed on a sheet, and several people use the same one — which
 * is exactly why it is shown once, here, and never again.
 *
 * What is stored is an HMAC of the code, so there is no way to display it later: revoke this one and
 * make another. That is a deliberate cost. A code that can be looked up months afterwards by anyone
 * who can reach this page is a standing key to a children's team.
 */
export function JoinCodeSection({ teamId, codes }: { teamId: string; codes: TeamJoinCodeRow[] }) {
  const [issued, setIssued] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function issue() {
    setError(null)
    start(async () => {
      const result = await createTeamJoinCode(teamId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setIssued(result.code)
    })
  }

  function revoke(id: string) {
    setError(null)
    start(async () => {
      const result = await revokeTeamJoinCode(id)
      if (!result.ok) setError(result.error)
      else setIssued(null)
    })
  }

  return (
    <section className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="font-display text-xl text-ink">Team Join Code</h2>
      <p className="mt-2 text-sm text-ink/70">
        A code anyone can use to ask to join this team. It does not add them &mdash; each person still
        appears as a join request for someone at the club to accept or decline.
      </p>

      {issued && (
        <div className="mt-4 rounded-lg bg-mint-100 px-4 py-4">
          <p className="text-sm font-medium text-forest-950">Write this down now.</p>
          <p className="mt-2 font-mono text-2xl tracking-[0.18em] text-forest-950">{issued}</p>
          <p className="mt-2 text-sm text-forest-950/80">
            Ovalball stores only a one-way hash of this code, so it cannot be shown again. If it is
            lost, revoke it and make a new one.
          </p>
        </div>
      )}

      {codes.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {codes.map((code) => (
            <li key={code.id} className="flex items-center gap-3 rounded-lg border border-ink/10 px-3.5 py-2.5">
              <span className="min-w-0 flex-1 text-sm text-ink/80">
                Ends &ldquo;{code.codeHint}&rdquo; &middot; used {code.useCount} of {code.maxUses} &middot;
                expires {new Date(code.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
              </span>
              <Button type="button" variant="ghost" className="h-8" disabled={pending} onClick={() => revoke(code.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" className="mt-4 h-9" disabled={pending} onClick={issue}>
        {pending ? "Working…" : codes.length > 0 ? "Create Another Code" : "Create a Join Code"}
      </Button>
      {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}
    </section>
  )
}
