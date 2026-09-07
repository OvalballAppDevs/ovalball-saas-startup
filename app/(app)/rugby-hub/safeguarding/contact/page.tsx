import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { ContactForm } from "./contact-form"

export const metadata: Metadata = {
  title: "Contact Safeguarding Officer | Rugby Hub",
}

/**
 * The real handoff SP3's Stage 7 contract asked Main to eventually provide
 * (docs/SIDE_PROJECT_3_STAGE_7_INTEGRATION.md: "a real destination for the
 * two contact-handoff routes officerContactHandoffHref builds"). OVALBALL
 * mode calls Main's own real start_or_get_safeguarding_officer_conversation
 * RPC (20261018020000_safeguarding_officer_messaging.sql, unchanged --
 * this page adds no new authorization or messaging logic of its own).
 * EMAIL mode shows the officer's real contact_email, resolved server-side
 * from club_safeguarding_officers -- never a client-supplied address.
 */
export default async function SafeguardingOfficerContactPage({ searchParams }: { searchParams: Promise<{ club?: string; assignment?: string; mode?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const mode = params.mode === "EMAIL" ? "EMAIL" : params.mode === "OVALBALL" ? "OVALBALL" : null

  let officerName: string | null = null
  let officerEmail: string | null = null
  if (params.assignment) {
    const { data } = await supabase.from("club_safeguarding_officers").select("contact_name, contact_email").eq("id", params.assignment).maybeSingle()
    officerName = data?.contact_name ?? null
    officerEmail = data?.contact_email ?? null
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 md:py-24">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Contact Safeguarding Officer</h1>

      {!params.club || !params.assignment || !mode ? (
        <p className="mt-4 text-[15px] leading-relaxed text-ink/80">This contact link is missing required information.</p>
      ) : mode === "EMAIL" ? (
        <div className="mt-4 rounded-lg border border-ink/15 bg-mint-100/40 px-4 py-3.5">
          <p className="text-[15px] leading-relaxed text-ink/80">
            {officerName ?? "This officer"} is not yet an active Ovalball user, so the fastest way to reach them is by email.
          </p>
          {officerEmail && (
            <a href={`mailto:${officerEmail}`} className="mt-2 inline-block font-medium text-forest-800 underline underline-offset-2">
              {officerEmail}
            </a>
          )}
        </div>
      ) : (
        <ContactForm clubId={params.club} officerId={params.assignment} officerName={officerName} />
      )}

      <Link href="/rugby-hub/safeguarding" className="mt-6 inline-block text-sm font-medium text-forest-800 underline underline-offset-2">
        Back to Safeguarding
      </Link>
    </div>
  )
}
