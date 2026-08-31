import { notFound } from "next/navigation"
import Image from "next/image"
import Link from "next/link"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Rugby Union", league: "Rugby League" }
const CONTACT_ROLE_LABEL: Record<string, string> = {
  fixture_secretary: "Fixture Secretary",
  minis_secretary: "Minis Secretary",
  general: "General enquiries",
}

/**
 * Public, unauthenticated -- every field selected below is already publicly
 * readable per existing RLS (clubs_select_active / club_contacts_select /
 * teams_select_active), never a service-role bypass. Deliberately does NOT
 * show people/roles, fixture requests, or messages -- those stay inside the
 * authenticated app regardless of what this page's own queries could
 * technically reach.
 */
export default async function PublicClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: club } = await supabase
    .from("clubs")
    .select(
      "id, bio, website, facebook_url, address_display, logo_storage_path, club_directory(name, town, county, nation, home_ground, rugby_code)"
    )
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle()

  if (!club) notFound()

  const [{ data: contacts }, { data: teams }] = await Promise.all([
    supabase
      .from("club_contacts")
      .select("role, name, phone, email")
      .eq("club_id", club.id)
      .eq("is_public", true),
    supabase
      .from("teams")
      .select("id, display_name, category, age_group")
      .eq("club_id", club.id)
      .eq("active", true)
      .order("category")
      .order("age_group"),
  ])

  const logoUrl = club.logo_storage_path
    ? supabase.storage.from("club-logos").getPublicUrl(club.logo_storage_path).data.publicUrl
    : null

  const directory = club.club_directory

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-12 md:px-8 md:py-16">
        <div className="flex items-start gap-5">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink/10 bg-white">
            {logoUrl ? (
              <Image src={logoUrl} alt={`${directory?.name} crest`} width={80} height={80} className="size-full object-contain" />
            ) : (
              <span className="text-xs text-ink/30">No crest</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
              {directory ? RUGBY_CODE_LABEL[directory.rugby_code] ?? directory.rugby_code : ""}
            </p>
            <h1 className="mt-1 font-display text-display-l text-ink">{directory?.name}</h1>
            <p className="mt-1 text-sm text-ink/50">
              {[directory?.town, directory?.county, directory?.nation].filter(Boolean).join(", ")}
            </p>
          </div>
        </div>

        {club.bio && <p className="mt-8 max-w-xl text-base text-ink/70">{club.bio}</p>}

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          {club.website && (
            <a href={club.website} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
              Website
            </a>
          )}
          {club.facebook_url && (
            <a href={club.facebook_url} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
              Facebook
            </a>
          )}
        </div>

        {(directory?.home_ground || club.address_display) && (
          <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
            <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Home ground</p>
            {directory?.home_ground && <p className="mt-1.5 text-sm font-medium text-ink">{directory.home_ground}</p>}
            {club.address_display && <p className="mt-0.5 text-sm text-ink/60">{club.address_display}</p>}
          </div>
        )}

        {teams && teams.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Teams</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {teams.map((t) => (
                <li key={t.id} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/75">
                  {t.display_name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {contacts && contacts.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Contact</p>
            <ul className="mt-3 flex flex-col gap-2">
              {contacts.map((c, i) => (
                <li key={i} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
                  <p className="text-sm font-medium text-ink">
                    {c.name} <span className="text-ink/40">&middot; {CONTACT_ROLE_LABEL[c.role] ?? c.role}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink/60">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}
