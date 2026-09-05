import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { listMySupportTickets } from "@/lib/support/queries"

import { SupportCentre } from "./support-centre"

export default async function SupportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const tickets = await listMySupportTickets(supabase, user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Support</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Ovalball Support</h1>
      <p className="mt-2 max-w-lg text-sm text-ink/55">Ask us anything about using Ovalball, and track your requests here.</p>

      <div className="mt-8">
        <SupportCentre tickets={tickets} />
      </div>
    </div>
  )
}
