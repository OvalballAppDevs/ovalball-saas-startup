import { Suspense } from "react"

import { createClient } from "@/lib/supabase/server"

import { SignupShell } from "./signup-shell"

// Server Component entry point -- SignupShell (client) reads/writes the
// current step via the `?step=` URL param (useSearchParams), which Next.js
// requires a Suspense boundary around.
//
// NO TEAM CATALOGUE IS FETCHED HERE, deliberately. This page used to load the
// whole canonical catalogue and thread it down, which meant the HTML sent to
// every visitor contained BOTH codes' identities -- a Rugby Union club's
// signup page carried mens_open_age and the League girls single-year bands,
// and a League club's carried mens_1st. Filtering that array in the browser
// afterwards is not isolation; it is the other sport's data already delivered,
// one unfiltered render away from being shown.
//
// The Club step now asks for the catalogue AFTER the visitor picks a rugby
// code, through loadSignupTeamCatalogue(code), so only one code's identities
// ever reach the browser.
export default async function SignupPage() {
  const supabase = await createClient()

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
        authenticatedEmail={authenticatedEmail}
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
      />
    </Suspense>
  )
}
