import { Suspense } from "react"

import { SignupShell } from "./signup-shell"

// Server Component entry point -- SignupShell (client) reads/writes the
// current step via the `?step=` URL param (useSearchParams), which Next.js
// requires a Suspense boundary around.
export default function SignupPage() {
  return (
    <Suspense>
      <SignupShell />
    </Suspense>
  )
}
