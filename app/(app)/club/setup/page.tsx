import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getClubSetupState, resumeStep } from "@/lib/club-setup/state"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import type { KitConfig, KitPattern } from "@/components/club/rugby-kit"

import { ClubProfileForm } from "../club-profile-form"
import { KitSection } from "../kit-section"
import { SetupProgress, StepChecklist, StepNav, type StepMeta } from "./setup-chrome"
import { StepTeams, type SetupTeam } from "./step-teams"
import { StepVenue, type ExistingVenue } from "./step-venue"

/**
 * Club first-run setup.
 *
 * Three steps, resumable, and mandatory: the application shell redirects a
 * Club Admin here whenever their club's setup is not COMPLETED, and this
 * page is one of the few paths that stays reachable while that gate is up.
 *
 * IT OWNS NO DATA. Every step mounts the same editor the club will use
 * forever afterwards -- ClubProfileForm, KitSection, the canonical venue
 * and pitch RPCs, Team Administration's own team rows -- so nothing
 * configured during onboarding is configured in a place that then
 * disappears. What is stored here is the progress, and only the progress.
 *
 * Which step to show is a three-way decision: an explicit ?step= when the
 * person navigated, otherwise the first step whose requirements are not
 * met. Requirements are re-derived from canonical data on every render, so
 * a step cannot stay ticked after the thing it was ticking for is gone.
 */
export default async function ClubSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) redirect("/dashboard")

  const canEdit = await hasCapability(supabase, "club.edit_profile", "club", { clubId })
  if (!canEdit) redirect("/dashboard")

  const setup = await getClubSetupState(supabase, clubId)
  // Already activated: this page has nothing to do, and leaving it
  // reachable would give a working club a second front door to its own
  // settings. Everything it edits is in Club Settings.
  if (!setup || setup.status === "COMPLETED") redirect("/club")

  const { data: club } = await supabase
    .from("clubs")
    .select("id, slug, bio, website, facebook_url, address_display, logo_storage_path, club_directory(name, town, county)")
    .eq("id", clubId)
    .maybeSingle()
  if (!club) redirect("/dashboard")

  const clubName = club.club_directory?.name ?? club.slug
  const req = setup.requirements

  const params = await searchParams
  const requested = Number(params.step)
  const step: 1 | 2 | 3 =
    requested === 1 || requested === 2 || requested === 3 ? requested : resumeStep(req)

  const steps: StepMeta[] = [
    { n: 1, label: "Club identity", done: req.step1Complete },
    { n: 2, label: "Home ground", done: req.step2Complete },
    { n: 3, label: "Teams", done: req.step3Complete },
  ]

  return (
    // Deep bottom padding on purpose: the Ask Ovie launcher floats over the
    // bottom-right of every page, and this is the one page whose primary
    // action -- Continue, then Finish setup -- sits at the very end of the
    // content. Without the clearance the launcher covers it at narrow
    // widths and the button cannot be pressed at all.
    <div className="mx-auto max-w-2xl px-4 pt-8 pb-32 md:px-8 md:pt-12 md:pb-20">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Set up your club</p>
      <h1 className="mt-2 font-display text-display-l text-ink">{clubName}</h1>
      <p className="mt-2 max-w-lg text-sm text-ink/55">
        Three things before {clubName} goes live on Ovalball. Everything you set here you can change
        later, and you can stop and come back &mdash; your progress is saved as you go.
      </p>

      <SetupProgress steps={steps} current={step} />

      <div className="mt-8">
        {step === 1 && <Step1 club={club} clubId={clubId} clubName={clubName} supabase={supabase} req={req} />}
        {step === 2 && <Step2 clubId={clubId} clubName={clubName} supabase={supabase} req={req} />}
        {step === 3 && <Step3 clubId={clubId} supabase={supabase} req={req} />}
      </div>
    </div>
  )
}

type Supa = Awaited<ReturnType<typeof createClient>>
type Req = NonNullable<Awaited<ReturnType<typeof getClubSetupState>>>["requirements"]

/** Step 1 -- crest and kit, mounting Club Settings' own two editors. */
async function Step1({
  club,
  clubId,
  clubName,
  supabase,
  req,
}: {
  club: { bio: string | null; website: string | null; facebook_url: string | null; address_display: string | null; logo_storage_path: string | null }
  clubId: string
  clubName: string
  supabase: Supa
  req: Req
}) {
  const logoUrl = club.logo_storage_path
    ? supabase.storage.from("club-logos").getPublicUrl(club.logo_storage_path).data.publicUrl
    : null

  const { data: kitRows } = await supabase
    .from("club_kits")
    .select("variant, pattern, primary_colour, secondary_colour, accent_colour")
    .eq("club_id", clubId)

  const kitByVariant = Object.fromEntries(
    (kitRows ?? []).map((k) => [
      k.variant,
      {
        pattern: k.pattern as KitPattern,
        primaryColour: k.primary_colour,
        secondaryColour: k.secondary_colour,
        accentColour: k.accent_colour,
      },
    ])
  ) as Partial<Record<"primary" | "alternate", KitConfig>>

  return (
    <>
      <h2 className="font-display text-2xl text-ink">Your crest and kit</h2>
      <p className="mt-1.5 max-w-lg text-sm text-ink/55">
        This is what players and parents see on every fixture card, every message and your public club
        page. The home kit is required; the away kit can wait.
      </p>

      <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5 md:p-6">
        <ClubProfileForm
          initial={{
            clubId,
            bio: club.bio ?? "",
            website: club.website ?? "",
            facebookUrl: club.facebook_url ?? "",
            addressDisplay: club.address_display ?? "",
            logoUrl,
          }}
          hideHomeGroundAddress
        />
      </div>

      <KitSection
        clubId={clubId}
        clubName={clubName}
        initialPrimary={kitByVariant.primary ?? null}
        initialAlternate={kitByVariant.alternate ?? null}
      />

      <StepChecklist
        items={[
          { label: "Upload your club crest", done: req.hasLogo },
          { label: "Set your home kit", done: req.hasPrimaryKit },
        ]}
      />

      <StepNav
        step={1}
        canContinue={req.step1Complete}
        blockedReason={req.step1Complete ? undefined : "Add a crest and a home kit to continue"}
      />
    </>
  )
}

/** Step 2 -- the home ground and its pitches. */
async function Step2({
  clubId,
  clubName,
  supabase,
  req,
}: {
  clubId: string
  clubName: string
  supabase: Supa
  req: Req
}) {
  const { data: venue } = await supabase
    .from("venues")
    .select("id, name, address_line_1, town, county, postcode, address")
    .eq("club_id", clubId)
    .eq("is_default_home", true)
    .eq("active", true)
    .maybeSingle()

  let existing: ExistingVenue | null = null
  if (venue) {
    const { count } = await supabase
      .from("club_pitches")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venue.id)
      .eq("active", true)

    existing = {
      id: venue.id,
      name: venue.name,
      line1: venue.address_line_1,
      town: venue.town,
      county: venue.county,
      postcode: venue.postcode,
      legacyAddress: venue.address,
      pitchCount: count ?? 0,
    }
  }

  return (
    <>
      <h2 className="font-display text-2xl text-ink">Where do you play?</h2>
      <p className="mt-1.5 max-w-lg text-sm text-ink/55">
        Your home ground and the pitches on it. Fixtures and training are scheduled onto pitches, and
        the address is what gives visiting clubs and parents their directions.
      </p>

      <StepVenue existing={existing} defaultVenueName={`${clubName} Ground`} />

      <StepChecklist
        items={[
          { label: "Add your home ground", done: req.hasDefaultVenue },
          { label: "Give it a street address and postcode", done: req.defaultVenueHasAddress },
          { label: "Add at least one pitch there", done: req.defaultVenueHasPitch },
        ]}
      />

      <StepNav
        step={2}
        canContinue={req.step2Complete}
        blockedReason={req.step2Complete ? undefined : "Add a home ground with an address and a pitch"}
      />
    </>
  )
}

/**
 * Why Finish is unavailable.
 *
 * It names an EARLIER step when that step has stopped being satisfied --
 * a home venue deactivated by a second admin while this one was on step 3,
 * say. Without this the button simply greys out on a page whose own
 * checklist is fully ticked, which reads as the wizard being broken rather
 * than as something having changed underneath it.
 */
function finishBlockedReason(req: Req): string | undefined {
  if (!req.step1Complete) return "Your crest or home kit is missing — go back to step 1"
  if (!req.step2Complete) return "Your home ground is no longer set up — go back to step 2"
  if (!req.teamsConfirmed) return "Confirm your team list to finish"
  return undefined
}

/** Step 3 -- confirming the team list. */
async function Step3({ clubId, supabase, req }: { clubId: string; supabase: Supa; req: Req }) {
  const { data: teams } = await supabase
    .from("teams")
    .select("id, display_name, category, age_group")
    .eq("club_id", clubId)
    .eq("active", true)
    .order("age_group")
    .order("display_name")

  const rows: SetupTeam[] = (teams ?? []).map((t) => ({
    id: t.id,
    displayName: t.display_name,
    category: t.category,
    ageGroup: t.age_group,
  }))

  return (
    <>
      <h2 className="font-display text-2xl text-ink">Your teams</h2>
      <p className="mt-1.5 max-w-lg text-sm text-ink/55">
        These came from what your club told us when it joined. Check them over &mdash; fixtures,
        training, squads and messaging all hang off this list.
      </p>

      <StepTeams teams={rows} confirmed={req.teamsConfirmed} />

      <StepChecklist items={[{ label: "Confirm your team list", done: req.teamsConfirmed }]} />

      <StepNav
        step={3}
        canContinue={req.step1Complete && req.step2Complete && req.step3Complete}
        blockedReason={finishBlockedReason(req)}
      />
    </>
  )
}
