import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { ExternalLink, Globe } from "lucide-react"

import { readClubDetail } from "@ovalball/contracts/clubhouse"
import { readClubTeams } from "@ovalball/contracts/club/teams"

import { ClubAvatar } from "@/components/club/club-avatar"
import { ACTIVE_CONTEXT_COOKIE, activeClubId, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { getPartnerClubsMapData } from "../../map-data"
import { ClubProfileActions } from "./club-profile-actions"

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Rugby Union", league: "Rugby League" }

/**
 * THE WEB CLUB PROFILE (Section 22 of the visual blueprint) -- previously deferred, closing the gap
 * the mobile Rich/Directory-only Club Profile pass left open. Deliberately NOT a port of the mobile
 * layout: mobile's crest-forward forest hero fits a phone's own width, but a desktop viewport has room
 * for identity, facts and actions side by side, which the mobile screen's own stacked composition
 * cannot show at all. Both reach the exact same server-derived truth, though -- the one shared
 * `readClubDetail`/`getPartnerClubsMapData` read model both clients already call, never a second query
 * invented for this page.
 *
 * `/clubhouse/[clubId]` (a legacy "Shared calendar" deep-link redirect, Section 7) is a DIFFERENT,
 * unrelated route -- this page lives at `/clubhouse/club/[directoryId]` on purpose so that redirect
 * never collides with it.
 */
export default async function ClubProfilePage({ params }: { params: Promise<{ directoryId: string }> }) {
  const { directoryId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const viewerClubId = activeClubId(ctx, activeContext)
  const viewerTeamId = activeContext.kind === "team" ? activeContext.id : null
  const canManagePartnerships = activeManageableClubId(ctx, activeContext) !== null

  // NO SINGLE-CLUB READ EXISTS (the mobile route's own comment applies here too): the whole ~1,400-row
  // directory is fetched once, the same trade-off `getPartnerClubsMapData` already makes for the map
  // page, rather than a new migration/RPC for one row.
  const markers = await getPartnerClubsMapData(viewerClubId, viewerTeamId)
  const marker = markers.find((m) => m.directoryId === directoryId)
  if (!marker) redirect("/clubhouse")

  const detail = await readClubDetail(supabase, marker, viewerClubId, viewerTeamId)
  // OWNER CORRECTION PASS: the club's own real roster (any signed-in viewer may read any club's ACTIVE
  // teams -- `teams_select` RLS), never the narrower `compatible_opponent_teams`-derived
  // `detail.compatibleTeams` (which needs a team context, answers "which of MY teams could play THEM",
  // and is always empty for the viewer's own club or a club-context viewer). Mirrors the mobile
  // profile's own fix this same pass.
  const clubTeams = marker.clubId ? (await readClubTeams(supabase, marker.clubId)).teams.filter((t) => t.active) : []
  const locationText = [marker.town, marker.county].filter(Boolean).join(", ") || (marker.hasLocation ? "Location on file" : "Location not yet known")
  const isOtherClub = marker.clubId !== null && !marker.isOwnClub
  const hasHistory = detail.fixturesTogetherThisSeason !== null || detail.fixturesTogetherAllTime !== null || !!detail.firstMetDate
  const hasTeams = clubTeams.length > 0

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* CREST-FORWARD, NEVER INVENTED PHOTOGRAPHY -- the same rule the mobile hero follows: there is
          no real photograph for ~1,400 directory clubs, so the identity comes from the crest and a
          real forest ground, not a stock image standing in for a club Ovalball has never photographed. */}
      <div className="flex flex-col gap-5 rounded-xl bg-gradient-to-br from-forest-900 to-forest-950 px-6 py-7 text-chalk sm:flex-row sm:items-center sm:gap-6 sm:px-8 sm:py-8">
        <ClubAvatar logoUrl={marker.logoUrl} name={marker.name} size="xl" variant="dark" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-[0.08em] text-white/60 uppercase">{RUGBY_CODE_LABEL[marker.rugbyCode] ?? marker.rugbyCode}</p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">{marker.name}</h1>
          <p className="mt-1.5 text-sm text-white/70">{locationText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge marker={marker} />
          </div>
        </div>
      </div>

      {marker.networkState === "not_on_ovalball" ? (
        <DirectoryOnlyBody marker={marker} detail={detail} canManagePartnerships={canManagePartnerships} />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <ClubProfileActions marker={marker} canManagePartnerships={canManagePartnerships} myClubId={viewerClubId} isOtherClub={isOtherClub} canFindFixture={detail.actions.canFindFixture} />

          {detail.website && (
            <section className="rounded-lg border border-ink/10 bg-white p-6">
              <h2 className="text-sm font-semibold text-ink">About</h2>
              <a
                href={detail.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-pitch-600 hover:underline"
              >
                <Globe className="size-3.5" />
                {detail.website}
              </a>
            </section>
          )}

          {hasHistory && (
            <section className="rounded-lg border border-ink/10 bg-white p-6">
              <h2 className="text-sm font-semibold text-ink">Our History</h2>
              <div className="mt-3 flex gap-8">
                {detail.fixturesTogetherThisSeason !== null && (
                  <Stat value={detail.fixturesTogetherThisSeason} label={detail.fixturesTogetherThisSeason === 1 ? "fixture this season" : "fixtures this season"} />
                )}
                {detail.fixturesTogetherAllTime !== null && detail.fixturesTogetherAllTime !== detail.fixturesTogetherThisSeason && (
                  <Stat value={detail.fixturesTogetherAllTime} label={detail.fixturesTogetherAllTime === 1 ? "fixture all time" : "fixtures all time"} />
                )}
              </div>
              {detail.firstMetDate && <p className="mt-3 text-xs text-ink-muted">First met {monthYearLabel(detail.firstMetDate)}</p>}
            </section>
          )}

          {hasTeams && (
            <section className="rounded-lg border border-ink/10 bg-white p-6">
              <h2 className="text-sm font-semibold text-ink">Teams</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {clubTeams.map((team) => (
                  <span key={team.id} className="rounded-full border border-ink/15 bg-chalk px-3 py-1.5 text-xs font-medium text-ink">
                    {team.fullLabel}
                  </span>
                ))}
              </div>
            </section>
          )}

          {isOtherClub && (
            <section className="rounded-lg border border-ink/10 bg-white p-6">
              <h2 className="text-sm font-semibold text-ink">Network Relationship</h2>
              <p className="mt-2 text-sm text-ink-muted">
                {marker.partnershipStatus === "active"
                  ? `${marker.name} is a partner club -- calendars are shared and direct messaging is open.`
                  : marker.partnershipStatus === "pending_incoming"
                    ? `${marker.name} wants to partner with your club.`
                    : marker.partnershipStatus === "pending_outgoing"
                      ? `A partnership request is waiting on ${marker.name}.`
                      : `${marker.name} is on Ovalball, with no partnership between your clubs yet.`}
              </p>
            </section>
          )}

          {!detail.website && !hasHistory && !hasTeams && !isOtherClub && (
            <p className="text-sm text-ink-muted">Nothing else recorded for this club yet.</p>
          )}

          {marker.slug && (
            <Link href={`/club/${marker.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-sm text-forest-800 hover:underline">
              <ExternalLink className="size-3.5" />
              View public club page
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ marker }: { marker: { partnershipStatus: string; networkState: string; locationPrecision: string } }) {
  if (marker.partnershipStatus === "active") return <Badge>Partner</Badge>
  if (marker.partnershipStatus === "pending_incoming") return <Badge>Wants to Partner</Badge>
  if (marker.partnershipStatus === "pending_outgoing") return <Badge>Request Sent</Badge>
  if (marker.networkState === "on_ovalball") return <Badge>On Ovalball</Badge>
  return <Badge>Not on Ovalball Yet</Badge>
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">{children}</span>
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  )
}

/** "Mar 2024" -- a real recorded fixture date, never a guess. */
function monthYearLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

/**
 * DIRECTORY-ONLY BODY: a deliberately different presentation from the on-Ovalball one above -- "Not on
 * Ovalball yet" said plainly, only the facts the directory actually has, Invite and Claim as two
 * separate actions (never implying one is the other), matching the mobile equivalent's own copy.
 */
function DirectoryOnlyBody({ marker, detail, canManagePartnerships }: { marker: Parameters<typeof ClubProfileActions>[0]["marker"]; detail: { website: string | null }; canManagePartnerships: boolean }) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm text-ink-muted">This club has not joined Ovalball. What you see here is what the Club Directory already knows -- nothing else is guessed or invented.</p>
        {detail.website && (
          <a href={detail.website} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-pitch-600 hover:underline">
            <Globe className="size-3.5" />
            {detail.website}
          </a>
        )}
      </section>
      <ClubProfileActions marker={marker} canManagePartnerships={canManagePartnerships} myClubId={null} isOtherClub={false} canFindFixture={false} directoryOnly />
    </div>
  )
}
