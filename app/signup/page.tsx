import { Suspense } from "react"

import { createClient } from "@/lib/supabase/server"
import { loadTeamCategoryGroups } from "@/lib/teams/catalog"

import { SignupShell } from "./signup-shell"

// Server Component entry point -- SignupShell (client) reads/writes the
// current step via the `?step=` URL param (useSearchParams), which Next.js
// requires a Suspense boundary around. The live team catalogue is fetched
// once here (canonical_team_types is publicly readable, anon included --
// this page runs before any session exists) and threaded down to the Club
// step's "Which teams does your club run?" checklist, so a Site-Admin-
// added global type appears there with zero further code changes.
export default async function SignupPage() {
  const supabase = await createClient()
  const teamCategoryGroups = await loadTeamCategoryGroups(supabase)
  return (
    <Suspense>
      <SignupShell teamCategoryGroups={teamCategoryGroups} />
    </Suspense>
  )
}
