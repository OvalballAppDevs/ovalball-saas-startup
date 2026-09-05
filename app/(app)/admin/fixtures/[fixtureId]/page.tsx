import { notFound, redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { ChevronLeft, ShieldCheck } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { ClubAvatar } from "@/components/club/club-avatar"
import { reconcileOverdueFixtureResults } from "@/lib/app-context/reconcile-results"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { AuditLog } from "../../clubs/[directoryId]/audit-log"
import { getClubVenuesAndPitches, type TeamSearchResult } from "../actions"
import { HomeAwayBadge } from "../home-away-badge"
import { SOURCE_LABEL } from "../format"
import { resolvedTeamName } from "../query"
import { EditFixtureForm } from "./edit-form"
import { FixtureDangerZone } from "./fixture-danger-zone"
import { FixtureHeroResult } from "./fixture-hero-result"
import { FixtureStatusControl } from "./fixture-status-control"
import { MessagePanel } from "./message-panel"
import { OpponentTeamEditor } from "./opponent-team-editor"
import { OwningTeamEditor } from "./owning-team-editor"
import { SwapHomeAwayButton } from "./swap-home-away-button"
import { VenuePitchSection } from "./venue-pitch-section"

export default async function AdminFixtureDetailPage({ params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  await reconcileOverdueFixtureResults(supabase)

  const { data: overview } = await supabase.from("admin_fixture_overview").select("*").eq("id", fixtureId).maybeSingle()
  if (!overview) notFound()

  // This is the ONE fixture detail surface for both Site Admin and a
  // legitimately-involved club (Reconciliation pass: "Club Admin should be
  // able to edit within their permissions/workflow" -- never a second,
  // club-scoped copy of this page). A club is involved only when it's
  // genuinely the home or away side of THIS fixture; club-wide fixture
  // authority elsewhere confers nothing here. Individual controls below
  // (team/venue/pitch editors, swap, messaging) already enforce their own
  // narrower authority at the RPC/RLS layer regardless of this page-level
  // gate -- this only decides who can land on the page at all.
  // Every club this session manages (CLUB_ADMIN/FIXTURE_SECRETARY), not
  // just the first one -- manageableClubId(ctx) only ever returned the
  // single first-found membership, which silently denied a genuinely
  // multi-club admin (like this project's own test.burnley.admin, real
  // Club Admin at both Burnley and League Test Club A) access to a fixture
  // involving whichever club wasn't first. This check is deliberately
  // session-wide across ALL managed clubs, not scoped to the active
  // context -- unlike a club-wide settings/write surface, "is one side of
  // THIS specific fixture a club I manage" is inherently per-resource, not
  // per-active-context, matching the page's own comment above.
  const myClubIds = new Set(ctx.clubMemberships.filter((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY").map((m) => m.clubId))
  const isInvolvedClub =
    (overview.owning_club_id !== null && myClubIds.has(overview.owning_club_id)) ||
    (overview.opponent_club_id !== null && myClubIds.has(overview.opponent_club_id))
  // Site Admin route-family guard (addendum): the Site-Admin half of this
  // page's dual access model requires the account to be ACTIVELY operating
  // as Site Admin, not merely holding that authority somewhere -- a
  // Burnley Club Admin viewing their own involved fixture is admitted via
  // isInvolvedClub regardless (a genuinely different, resource-scoped
  // authority, unaffected by this rule), and every ctx.isSiteAdmin-gated
  // Site Admin-specific label/action below is scoped the same way, so this
  // account sees the Club Admin framing, not Site Admin's, while operating
  // as Burnley.
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const activeIsSiteAdmin = ctx.isSiteAdmin && activeContext.kind === "site_admin"
  if (!activeIsSiteAdmin && !isInvolvedClub) redirect("/dashboard")

  const [{ data: messages }, { data: auditRows }, { count: requestCount }, { data: opponentTeamRow }] = await Promise.all([
    supabase.from("fixture_messages").select("id, body, created_at, sender_user_id, is_site_admin_message").eq("fixture_id", fixtureId).order("created_at"),
    supabase
      .from("audit_log")
      .select("id, action, changed_at, changed_by, before, after")
      .eq("record_id", fixtureId)
      .eq("table_name", "fixtures")
      .order("changed_at", { ascending: false })
      .limit(15),
    supabase.from("fixture_requests").select("id", { count: "exact", head: true }).eq("resulting_fixture_id", fixtureId),
    // Hydrates the Opposition editor's already-resolved state -- OpponentResolver
    // only ever renders clubName/teamName/teamCategoryLabel for a pre-selected
    // team, so this is a display-only fetch, never re-used for eligibility math.
    overview.opponent_team_id
      ? supabase
          .from("teams")
          .select("id, display_name, rugby_code, category, age_group, team_number, squad_designation, gender, club_id, clubs!inner(club_directory!inner(name, town))")
          .eq("id", overview.opponent_team_id)
          .maybeSingle()
      : { data: null },
  ])

  const opponentTeamInitial: TeamSearchResult | null = opponentTeamRow
    ? {
        teamId: opponentTeamRow.id,
        teamName: opponentTeamRow.display_name,
        clubId: opponentTeamRow.club_id,
        clubName: opponentTeamRow.clubs.club_directory.name,
        town: opponentTeamRow.clubs.club_directory.town,
        rugbyCode: opponentTeamRow.rugby_code,
        category: opponentTeamRow.category,
        ageGroup: opponentTeamRow.age_group,
        teamNumber: opponentTeamRow.team_number,
        squadDesignation: opponentTeamRow.squad_designation,
        gender: opponentTeamRow.gender,
      }
    : null

  const senderIds = [...new Set((messages ?? []).map((m) => m.sender_user_id))]
  const auditByIds = [...new Set((auditRows ?? []).map((r) => r.changed_by).filter((id): id is string => Boolean(id)))]
  const allProfileIds = [...new Set([...senderIds, ...auditByIds])]
  const { data: profiles } =
    allProfileIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", allProfileIds) : { data: [] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Site Admin"]))

  const hasHistory = (messages?.length ?? 0) > 0 || (requestCount ?? 0) > 0
  const isHome = overview.home_away !== "Away"
  // Section 26-30: display alias for a B/C squad must show here too, same
  // as every other surface that resolves a team's name -- one lookup for
  // whichever of owning/opponent's team ids are real.
  const aliasTeamIds = [overview.owning_team_id, overview.opponent_team_id].filter((id): id is string => Boolean(id))
  const { data: aliasRows } = aliasTeamIds.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", aliasTeamIds) : { data: [] }
  const aliasByTeamId = new Map((aliasRows ?? []).map((a) => [a.team_id, a.alias]))
  const owningAlias = overview.owning_team_id ? (aliasByTeamId.get(overview.owning_team_id) ?? null) : null
  const opponentAlias = overview.opponent_team_id ? (aliasByTeamId.get(overview.opponent_team_id) ?? null) : null
  // Full canonical Team Directory names (Reconciliation complaint 2/8) --
  // never the raw, sometimes-stale teams.display_name overview.owning_
  // team_name/opponent_team_name carry.
  const owningTeamFullName = isHome
    ? resolvedTeamName(overview.home_team_category, overview.home_team_age_group, overview.home_team_gender, overview.home_team_squad_designation, overview.owning_team_name, owningAlias)
    : resolvedTeamName(overview.away_team_category, overview.away_team_age_group, overview.away_team_gender, overview.away_team_squad_designation, overview.owning_team_name, owningAlias)
  const opponentTeamFullName = isHome
    ? resolvedTeamName(overview.away_team_category, overview.away_team_age_group, overview.away_team_gender, overview.away_team_squad_designation, overview.opponent_team_name, opponentAlias)
    : resolvedTeamName(overview.home_team_category, overview.home_team_age_group, overview.home_team_gender, overview.home_team_squad_designation, overview.opponent_team_name, opponentAlias)
  const owningLogoUrl = overview.owning_club_logo_path
    ? supabase.storage.from("club-logos").getPublicUrl(overview.owning_club_logo_path).data.publicUrl
    : null
  const opponentLogoUrl = overview.opponent_club_logo_path
    ? supabase.storage.from("club-logos").getPublicUrl(overview.opponent_club_logo_path).data.publicUrl
    : null

  const kickoffPassed =
    Boolean(overview.kickoff_date) &&
    (overview.kickoff_time
      ? new Date(`${overview.kickoff_date}T${overview.kickoff_time}`) <= new Date()
      : new Date(`${overview.kickoff_date}T23:59:59`) <= new Date())

  // A named pitch can only ever be set on a strict home_away = "Home"
  // fixture (matches update_fixture_pitch's own check exactly) -- the
  // looser `isHome` badge convention above (defaults true unless
  // explicitly "Away") is deliberately NOT reused here, since TBD/Not
  // Applicable have no real home club to draw pitches from.
  const isHomeFixtureForPitch = overview.home_away === "Home"
  const pitchHomeClubId = overview.home_away === "Home" ? overview.owning_club_id : overview.home_away === "Away" ? overview.opponent_club_id : null
  const { venues: homeClubVenues, pitches: homeClubVenuePitches } = pitchHomeClubId
    ? await getClubVenuesAndPitches(pitchHomeClubId)
    : { venues: [], pitches: [] }

  // Message content (viewing) keeps its original, already-correct rule --
  // Full Site Admin / Message Moderator only, matching Message
  // Management's own authorization exactly (this is a real, separate,
  // pre-existing content-access scope, not something this session
  // narrowed). manage_fixture_support (ctx.manageFixtureSupport, passed
  // to MessagePanel below as canSend) gates a DIFFERENT, genuinely new
  // action: posting a message that's visibly flagged as Ovalball
  // support, enforced by send_fixture_support_message's own capability
  // check regardless of what this page shows.
  // The pre-existing Full-Site-Admin/Message-Moderator content rule is
  // unchanged; a club genuinely involved in this fixture also sees their
  // own conversation content -- they're a real participant, not a support
  // agent, and the existing message-send/post authorization is unaffected.
  const canSeeMessageContent = (activeIsSiteAdmin && (ctx.siteAdminRole === "full" || ctx.siteAdminRole === "message_moderator")) || isInvolvedClub

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <Link href={activeIsSiteAdmin ? "/admin/fixtures" : "/fixtures/management"} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Fixture management
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{activeIsSiteAdmin ? "Site Admin" : "Club Admin"}</p>
      </div>

      {/* ============ HERO: the fixture itself ============ */}
      <div className="mt-4 rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex items-center justify-between gap-3 sm:gap-6">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center sm:flex-row sm:text-left">
            <ClubAvatar logoUrl={owningLogoUrl} name={overview.owning_club_name ?? "Club"} size="lg" />
            <div className="min-w-0">
              <p className="font-display text-display-s text-ink">{overview.owning_club_name}</p>
              <p className="truncate text-sm text-ink/55">{owningTeamFullName}</p>
              <div className="mt-1 flex items-center justify-center gap-2 sm:justify-start">
                <HomeAwayBadge value={isHome ? "Home" : "Away"} />
                {overview.owning_team_id && overview.owning_club_id && (
                  <OwningTeamEditor
                    fixtureId={fixtureId}
                    clubId={overview.owning_club_id}
                    currentTeamId={overview.owning_team_id}
                    currentTeamName={owningTeamFullName || "This team"}
                    sideLabel={isHome ? "Home" : "Away"}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-1 border-x border-ink/8 px-5 sm:px-6">
            <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">{formatDate(overview.kickoff_date)}</p>
            {overview.kickoff_time && <p className="font-display text-display-s text-ink">{overview.kickoff_time.slice(0, 5)}</p>}
            <p className="text-xs text-ink/45">{overview.game_type ?? "Friendly"}</p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center sm:flex-row-reverse sm:text-right">
            <ClubAvatar logoUrl={opponentLogoUrl} name={overview.opponent_club_name ?? overview.raw_opposition_text ?? "Opponent"} size="lg" />
            <div className="min-w-0">
              {overview.opponent_club_name ? (
                <p className="font-display text-display-s text-ink">{overview.opponent_club_name}</p>
              ) : overview.raw_opposition_text ? (
                <p className="font-display text-display-s text-amber-700">
                  <span className="text-xs font-sans font-medium uppercase tracking-[0.04em]">Unresolved opponent</span>
                  <br />
                  {overview.raw_opposition_text}
                </p>
              ) : (
                <p className="font-display text-display-s text-ink/40">Opponent unresolved</p>
              )}
              <p className={`truncate text-sm ${opponentTeamFullName ? "text-ink/55" : "text-ink/35 italic"}`}>
                {opponentTeamFullName || (overview.opponent_club_name ? "Team not set" : " ")}
              </p>
              <div className="mt-1 flex items-center justify-center gap-2 sm:justify-end">
                <HomeAwayBadge value={isHome ? "Away" : "Home"} />
                <OpponentTeamEditor
                  fixtureId={fixtureId}
                  owningTeamId={overview.owning_team_id ?? ""}
                  currentTeam={opponentTeamInitial}
                  currentDirectoryId={overview.opponent_directory_id}
                  currentRawText={overview.raw_opposition_text ?? ""}
                  sideLabel={isHome ? "Away" : "Home"}
                />
              </div>
            </div>
          </div>
        </div>

        {overview.mirror_fixture_id && (
          <p className="mt-3 border-t border-ink/8 pt-3 text-center text-xs text-ink/45">
            Historical mirror pair &mdash; also recorded as{" "}
            <Link href={`/admin/fixtures/${overview.mirror_fixture_id}`} className="font-medium text-forest-800 underline hover:text-forest-950">
              the other club&apos;s copy of this fixture
            </Link>
            . Shown once in the main table; both rows are kept for history.
          </p>
        )}

        {/* Operational strip: status + swap, always visible, always live controls.
            Venue/Pitch has its own full-width section below (Reconciliation
            pass Section 6) -- no longer crammed in here as tiny text. */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-ink/8 pt-3">
          <FixtureStatusControl fixtureId={fixtureId} status={overview.status ?? "Planned"} />
          <SwapHomeAwayButton
            fixtureId={fixtureId}
            homeTeamName={
              [isHome ? overview.owning_club_name : overview.opponent_club_name, isHome ? owningTeamFullName : opponentTeamFullName]
                .filter(Boolean)
                .join(" ") || "Home"
            }
            awayTeamName={
              [isHome ? overview.opponent_club_name : overview.owning_club_name, isHome ? opponentTeamFullName : owningTeamFullName]
                .filter(Boolean)
                .join(" ") || "Away"
            }
            canSwap={Boolean(overview.opponent_team_id) && (overview.home_away === "Home" || overview.home_away === "Away")}
          />
        </div>

        <VenuePitchSection
          fixtureId={fixtureId}
          isHomeFixture={isHomeFixtureForPitch}
          currentVenueId={overview.venue_id}
          currentVenueName={overview.venue_name}
          currentPitchId={overview.pitch_id}
          currentPitchName={
            overview.pitch_id ? (homeClubVenuePitches.find((p) => p.id === overview.pitch_id)?.displayName ?? overview.pitch_allocation) : overview.pitch_allocation
          }
          venues={homeClubVenues}
          pitches={homeClubVenuePitches}
        />

        {overview.cancelled_at && (
          <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Cancelled {formatDateTime(overview.cancelled_at)}
            {overview.cancellation_reason ? ` — ${overview.cancellation_reason}` : ""}
          </p>
        )}

        {/* Score + result actions -- the scoreboard, never a separate duplicate "Result" card */}
        <FixtureHeroResult
          fixtureId={fixtureId}
          result={{
            status: overview.result_status ?? "none",
            homeScore: overview.home_score,
            awayScore: overview.away_score,
            amendmentHomeScore: overview.result_amendment_proposed_home_score,
            amendmentAwayScore: overview.result_amendment_proposed_away_score,
            kickoffPassed,
            isCancelled: Boolean(overview.cancelled_at),
          }}
        />
      </div>

      {/* ============ ONE conversation section -- no separate preview
          card linking out to a duplicate view (mega-spec section X/Y/Z) ============ */}
      <div className="mt-4 rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">
          Conversation {overview.message_count ? `(${overview.message_count})` : ""}
        </h2>
        <div className="mt-3">
          {canSeeMessageContent ? (
            <MessagePanel
              fixtureId={fixtureId}
              canSend={ctx.manageFixtureSupport}
              showSupportCapabilityHint={activeIsSiteAdmin}
              messages={(messages ?? []).map((m) => ({
                id: m.id,
                senderName: nameById.get(m.sender_user_id) ?? "Unknown",
                body: m.body,
                createdAt: m.created_at,
                isSiteAdminMessage: m.is_site_admin_message,
              }))}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-ink/15 bg-ink/[0.02] px-3.5 py-2.5 text-sm text-ink/50">
              {overview.message_count
                ? `${overview.message_count} message${overview.message_count === 1 ? "" : "s"} on this fixture -- fixture support access is required to view content.`
                : "No messages on this fixture yet."}
            </p>
          )}
        </div>
      </div>

      {/* ============ Progressive disclosure: less-common metadata.
          Audit/Danger-zone/raw-field editing stay Site-Admin-only -- an
          involved club already has the equivalent editors on the hero
          above (status, home/away team change, swap, venue/pitch), which
          covers "Club Admin should be able to edit within their
          permissions/workflow" without exposing Site-Admin correction
          tooling. ============ */}
      <div className="mt-8 rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Match details</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <InfoCard label="Competition" value={overview.competition_name ?? "None"} />
          <InfoCard label="Game type" value={overview.game_type ?? "Not set"} />
          <InfoCard label="Source" value={SOURCE_LABEL[overview.source ?? "club_created"] ?? overview.source ?? "club_created"} />
        </div>
      </div>

      {activeIsSiteAdmin && (
        <details className="group mt-4 rounded-xl border border-ink/10 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
            Site Admin details
            <span className="text-xs font-normal text-ink/40 group-open:hidden">Edit, audit, danger zone</span>
          </summary>
          <div className="flex flex-col gap-8 border-t border-ink/10 px-5 py-6">
            <section>
              <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Edit details</h2>
              <div className="mt-3">
                <EditFixtureForm
                  initial={{
                    fixtureId,
                    owningTeamId: overview.owning_team_id ?? "",
                    homeAway: (overview.home_away as "Home" | "Away" | "TBD" | "Not Applicable") ?? "Home",
                    rawOppositionText: overview.raw_opposition_text ?? "",
                    opponentTeam: opponentTeamInitial,
                    opponentDirectoryId: overview.opponent_directory_id,
                    kickoffDate: overview.kickoff_date ?? "",
                    kickoffTime: overview.kickoff_time ?? "",
                    gameType: overview.game_type ?? "",
                    status: overview.status ?? "Planned",
                    notes: overview.notes ?? "",
                    rugbyCode: overview.rugby_code ?? "",
                    competitionEditionId: overview.competition_edition_id,
                  }}
                />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Audit</h2>
              <div className="mt-3">
                <AuditLog
                  entries={(auditRows ?? []).map((r) => ({
                    id: r.id,
                    action: r.action,
                    changedAt: r.changed_at,
                    changedByLabel: r.changed_by ? nameById.get(r.changed_by) || "Site Admin" : "System",
                    before: r.before,
                    after: r.after,
                  }))}
                />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Danger zone</h2>
              <div className="mt-3">
                <FixtureDangerZone fixtureId={fixtureId} status={overview.status ?? "Planned"} hasHistory={hasHistory} />
              </div>
            </section>
          </div>
        </details>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{label}</p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}
