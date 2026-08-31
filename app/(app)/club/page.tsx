import { redirect } from "next/navigation"
import Link from "next/link"

import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubContactsSection } from "./club-contacts-section"
import type { ClubContact } from "./actions"
import { ClubProfileForm } from "./club-profile-form"

export default async function ClubProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const adminMembership = ctx.clubMemberships.find((m) => m.role === "CLUB_ADMIN")
  if (!adminMembership) redirect("/dashboard")

  const { data: club } = await supabase
    .from("clubs")
    .select(
      "id, slug, bio, website, facebook_url, address_display, logo_storage_path, club_directory(name, town, county, rugby_code)"
    )
    .eq("id", adminMembership.clubId)
    .maybeSingle()

  if (!club) redirect("/dashboard")

  const { data: contacts } = await supabase
    .from("club_contacts")
    .select("id, role, name, phone, email, is_public")
    .eq("club_id", club.id)
    .order("created_at")

  const logoUrl = club.logo_storage_path
    ? supabase.storage.from("club-logos").getPublicUrl(club.logo_storage_path).data.publicUrl
    : null

  const contactRows: ClubContact[] = (contacts ?? []).map((c) => ({
    id: c.id,
    role: c.role as ClubContact["role"],
    name: c.name,
    phone: c.phone,
    email: c.email,
    isPublic: c.is_public,
  }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
          <h1 className="mt-2 font-display text-display-l text-ink">{club.club_directory?.name}</h1>
          <p className="mt-1 text-sm text-ink/50">
            {[club.club_directory?.town, club.club_directory?.county].filter(Boolean).join(", ")}
          </p>
        </div>
        <Link
          href={`/club/${club.slug}`}
          target="_blank"
          className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
        >
          View public page &rarr;
        </Link>
      </div>
      <p className="mt-4 max-w-md text-sm text-ink/55">
        Club name, location, and rugby code come from Ovalball&apos;s canonical directory and can&apos;t be edited
        here &mdash; contact support if any of that is wrong. Everything below is yours to manage.
      </p>

      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-6">
        <ClubProfileForm
          initial={{
            clubId: club.id,
            bio: club.bio ?? "",
            website: club.website ?? "",
            facebookUrl: club.facebook_url ?? "",
            addressDisplay: club.address_display ?? "",
            logoUrl,
          }}
        />
      </div>

      <div className="mt-8">
        <ClubContactsSection clubId={club.id} initial={contactRows} />
      </div>
    </div>
  )
}
