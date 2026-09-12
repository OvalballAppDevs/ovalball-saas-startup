import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { listContactCandidates } from "./actions"
import { PersonPicker } from "./person-picker"

export default async function NewDirectMessagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const candidates = await listContactCandidates()

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link
        href="/messages"
        className="inline-flex items-center gap-1 text-sm text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Messages
      </Link>

      <h1 className="mt-3 font-display text-display-l text-ink">Message a Person</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        People at your club, on your teams, and at the clubs you have fixtures against. Only the two of you can read
        a direct message.
      </p>

      <div className="mt-8">
        <PersonPicker candidates={candidates} />
      </div>
    </div>
  )
}
