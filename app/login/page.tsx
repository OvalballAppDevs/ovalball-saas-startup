import { Suspense } from "react"
import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"

import { LoginForm } from "./login-form"

// Server Component entry point -- LoginForm (client) reads the `?email=`
// param (useSearchParams), which Next.js requires a Suspense boundary
// around. Deliberately a single centered card, not the signup wizard's
// split brand panel -- this is a one-field form, not a multi-step flow.
export default function LoginPage() {
  return (
    <main className="brand-light-scope flex min-h-screen flex-col bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
