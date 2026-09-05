import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubContactsSection } from "./club-contacts-section"
import { ClubMessagingSection, type ClubMessagingPolicy } from "./club-messaging-section"
import type { ClubContact } from "./actions"
import { ClubProfileForm } from "./club-profile-form"
import { ClubSettingsNav } from "./settings/club-settings-nav"

export default async function ClubProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const activeClub = activeManageableClubId(ctx, activeContext)
  // Scoped to the ACTIVE context's own club-admin membership, not "any
  // CLUB_ADMIN row this session happens to hold" -- otherwise a multi-role
  // account viewing Parent View (or a different club's Team Admin context)
  // would still see/edit a DIFFERENT club's profile, contacts and
  // messaging policy. See app/(app)/people/page.tsx for the identical fix.
  //
  // Canonical Scoped Capability Engine pass (Section 19/20): UI visibility
  // now derives from the SAME internal.has_capability() primitive RLS
  // enforces on the write, via the has_capability RPC -- so a Site Admin
  // deny override on club.edit_profile for this specific person correctly
  // hides this page's form too, not just blocks the write underneath it.
  const [canEditProfile, canVenues, canPitches, canRollover, canPlayerMoves] = activeClub
    ? await Promise.all([
        hasCapability(supabase, "club.edit_profile", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.venues.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.pitches.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId: activeClub }),
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId: activeClub }),
      ])
    : [false, false, false, false, false]
  if (!canEditProfile || !activeClub) redirect("/dashboard")
  // venues/pitches/rollover only computed for the shared tab strip's accuracy -- see club-settings-nav.tsx.
  const canTeamsForNav = canEditProfile || canPitches

  const { data: club } = await supabase
    .from("clubs")
    .select(
      "id, slug, bio, website, facebook_url, address_display, logo_storage_path, club_directory(name, town, county, rugby_code)"
    )
    .eq("id", activeClub)
    .maybeSingle()

  if (!club) redirect("/dashboard")

  const { data: contacts } = await supabase
    .from("club_contacts")
    .select("id, role, name, phone, email, is_public")
    .eq("club_id", club.id)
    .order("created_at")

  // Deliberately the club's OWN uploaded logo only, never the Club
  // Directory fallback resolveClubLogoUrl() applies for read-only display
  // elsewhere -- this editor's "Replace"/"Remove" affordances only make
  // sense against a real, deletable clubs.logo_storage_path, not a
  // directory-seeded logo this club never uploaded and has nothing to
  // remove.
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

  const [{ data: clubPolicyRows }, { data: globalPolicyRows }] = await Promise.all([
    supabase.rpc("get_effective_message_policy", { p_club_id: club.id }),
    supabase.rpc("get_effective_message_policy", { p_club_id: undefined }),
  ])
  const clubPolicy = clubPolicyRows?.[0]
  const globalPolicy = globalPolicyRows?.[0]
  const messagingPolicy: ClubMessagingPolicy | null =
    clubPolicy && globalPolicy
      ? {
          directAttachments: {
            origin: clubPolicy.allow_direct_attachments_origin as "global_default" | "club_override",
            effective: clubPolicy.allow_direct_attachments,
            clubOverrideAllowed: clubPolicy.allow_direct_attachments_club_override_allowed,
            globalDefault: globalPolicy.allow_direct_attachments,
          },
          documentLibrarySharing: {
            origin: clubPolicy.allow_document_library_sharing_origin as "global_default" | "club_override",
            effective: clubPolicy.allow_document_library_sharing,
            clubOverrideAllowed: clubPolicy.allow_document_library_sharing_club_override_allowed,
            globalDefault: globalPolicy.allow_document_library_sharing,
          },
          imageUploads: {
            origin: clubPolicy.allow_image_uploads_origin as "global_default" | "club_override",
            effective: clubPolicy.allow_image_uploads,
            clubOverrideAllowed: clubPolicy.allow_image_uploads_club_override_allowed,
            globalDefault: globalPolicy.allow_image_uploads,
          },
          contactCardSharing: {
            origin: clubPolicy.allow_contact_card_sharing_origin as "global_default" | "club_override",
            effective: clubPolicy.allow_contact_card_sharing,
            clubOverrideAllowed: clubPolicy.allow_contact_card_sharing_club_override_allowed,
            globalDefault: globalPolicy.allow_contact_card_sharing,
          },
          participantManagement: {
            origin: clubPolicy.allow_participant_management_origin as "global_default" | "club_override",
            effective: clubPolicy.allow_participant_management,
            clubOverrideAllowed: clubPolicy.allow_participant_management_club_override_allowed,
            globalDefault: globalPolicy.allow_participant_management,
          },
        }
      : null

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

      <ClubSettingsNav active="profile" canProfile={canEditProfile} canTeams={canTeamsForNav} canVenues={canVenues} canRollover={canRollover} canPlayerMoves={canPlayerMoves} />

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

      <div className="mt-8 flex items-center justify-between rounded-lg border border-ink/10 bg-white px-4 py-3.5">
        <div>
          <p className="text-sm font-medium text-ink">Venues &amp; pitches</p>
          <p className="mt-0.5 text-xs text-ink/50">Managed under Lookup Administration &mdash; used throughout fixture creation and editing.</p>
        </div>
        <Link href="/club/venues" className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          Manage &rarr;
        </Link>
      </div>

      {messagingPolicy && (
        <div className="mt-8">
          <ClubMessagingSection clubId={club.id} initial={messagingPolicy} />
        </div>
      )}
    </div>
  )
}
