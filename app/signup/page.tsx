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

  // A first-time Google/Facebook/Apple visitor reaches this wizard ALREADY
  // authenticated -- /auth/callback sends them here when the provider gave
  // them a session but Ovalball has no profile for them yet. The wizard
  // then skips the email step (the provider already proved the address) and
  // writes its records through an authenticated action instead of stashing
  // them in user_metadata for a magic link that is not coming.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const authenticatedEmail = user?.email ?? null

  return (
    <Suspense>
      <SignupShell
        teamCategoryGroups={teamCategoryGroups}
        authenticatedEmail={authenticatedEmail}
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
      />
    </Suspense>
  )
}
