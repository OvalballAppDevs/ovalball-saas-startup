"use client"

import { useRef } from "react"

import type { RugbyHubTeamOption } from "@/lib/app-context/rugby-hub-data"

import { setRugbyHubTeam } from "./actions"

/** Only shown when the viewer has more than one real team relationship. Picks among the viewer's OWN real teams -- never a fake scenario. */
export function TeamSwitcher({ options, activeTeamId }: { options: RugbyHubTeamOption[]; activeTeamId: string | null }) {
  const formRef = useRef<HTMLFormElement>(null)
  return (
    <form key={activeTeamId ?? ""} ref={formRef} action={setRugbyHubTeam} className="mb-4 rounded-lg border border-ink/10 bg-white px-4 py-3">
      <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
        <span className="text-xs font-medium tracking-[0.06em] text-ink/50 uppercase">Viewing</span>
        <select
          name="teamId"
          defaultValue={activeTeamId ?? undefined}
          onChange={() => formRef.current?.requestSubmit()}
          className="w-full rounded-md border border-ink/15 bg-white px-2.5 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 sm:max-w-xs"
        >
          {options.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.clubName} &middot; {t.teamDisplayName}
            </option>
          ))}
        </select>
      </label>
    </form>
  )
}
