import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { reconcileOverdueFixtureResults } from "@/lib/app-context/reconcile-results"
import { canManageClubFixturesAnywhere, getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/server"

import { ExportClubFixturesButton } from "./export-button"
import { NonOvalballRow, type NonOvalballRowData } from "./non-ovalball-row"
import { RequestRow, type RequestRowData } from "./request-row"

interface RejectedRowData {
  id: string
  direction: "outgoing" | "incoming"
  teamDisplayName: string
  opponentText: string
  proposedDate: string
  decidedAt: string | null
}

/**
 * "Fixture Requests" is specifically the interactive, two-sided Ovalball-
 * to-Ovalball surface (sent/received, awaiting response, accept/decline)
 * -- never conflated with a fixture arranged against a club that isn't
 * active on Ovalball, which has nobody to receive/accept anything.
 * Those live in a small, honestly-labelled secondary section instead of
 * cluttering the main actionable list (see NonOvalballRow).
 */
export default async function FixturesPage({ searchParams }: { searchParams: Promise<{ dir?: string }> }) {
  const { dir } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // Product decision: Parent/Player (view only) doesn't see fixture
  // request negotiation (sent/received, accept/decline) at all -- only
  // confirmed fixtures, via the Calendar. Blocked here (not just hidden
  // from nav) so a direct link never reaches it either.
  if (activeContext.kind === "parent" || activeContext.kind === "player") redirect("/dashboard")
  await reconcileOverdueFixtureResults(supabase)
  // Context-scoped, not session-wide -- getMyTeams(ctx) used to union every
  // team from every club/team permission this account holds ANYWHERE
  // (including a completely unrelated club's full roster), so this list --
  // and every fixture-request row read from it below -- would show data
  // that has nothing to do with the currently active context. See
  // app/(app)/dashboard/page.tsx's getDashboardData for the same fix
  // applied earlier via getTeamsForActiveContext.
  const myTeams = await getTeamsForActiveContext(supabase, ctx, activeContext)
  const teamIds = myTeams.map((t) => t.id)

  const requests: RequestRowData[] = []
  const nonOvalball: NonOvalballRowData[] = []
  const rejected: RejectedRowData[] = []

  if (teamIds.length > 0) {
    // opponent_club_id distinguishes a real Ovalball opponent (someone to
    // actually receive/accept this) from one arranged against a directory-
    // only, unactivated club -- the second case can never be "sent" to
    // anyone, so it's routed to the non-Ovalball list below instead of
    // the main actionable one.
    const { data: outgoing } = await supabase
      .from("fixture_requests")
      .select(
        "id, venue_preference, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text, opponent_club_id)"
      )
      .in("requesting_team_id", teamIds)
      .eq("status", "sent")

    for (const r of outgoing ?? []) {
      if (r.fixture_request_groups?.opponent_club_id) {
        requests.push({
          id: r.id,
          direction: "outgoing",
          teamDisplayName: r.teams?.display_name ?? "Team",
          opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
          proposedDate: r.fixture_request_groups?.proposed_date ?? "",
          venuePreference: r.venue_preference,
        })
      } else {
        nonOvalball.push({
          id: r.id,
          teamDisplayName: r.teams?.display_name ?? "Team",
          opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
          proposedDate: r.fixture_request_groups?.proposed_date ?? "",
          venuePreference: r.venue_preference,
        })
      }
    }

    const { data: incoming } = await supabase
      .from("fixture_requests")
      .select(
        "id, venue_preference, teams!fixture_requests_target_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)"
      )
      .in("target_team_id", teamIds)
      .eq("status", "sent")

    for (const r of incoming ?? []) {
      requests.push({
        id: r.id,
        direction: "incoming",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups?.proposed_date ?? "",
        venuePreference: r.venue_preference,
      })
    }
  }

  // Rejected requests must stay VISIBLE, not vanish the moment they're
  // declined (Central Fixture Participant Resolution follow-up: "Rejected
  // must be a real, visible status"). A `fixtures` row is only ever created
  // on Accept, so there is no `fixtures.status` value this can live on --
  // the request itself (`fixture_requests.status = 'declined'`) is the
  // correct and only place this state exists, and this is where it must
  // stay visible. Scoped to the last 30 days so this section doesn't grow
  // unbounded forever.
  if (teamIds.length > 0) {
    const thirtyDaysAgoDate = new Date()
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30)
    const thirtyDaysAgo = thirtyDaysAgoDate.toISOString()
    const { data: declinedOutgoing } = await supabase
      .from("fixture_requests")
      .select("id, decided_at, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)")
      .in("requesting_team_id", teamIds)
      .eq("status", "declined")
      .gte("decided_at", thirtyDaysAgo)
    const { data: declinedIncoming } = await supabase
      .from("fixture_requests")
      .select("id, decided_at, teams!fixture_requests_target_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)")
      .in("target_team_id", teamIds)
      .eq("status", "declined")
      .gte("decided_at", thirtyDaysAgo)
    for (const r of declinedOutgoing ?? []) {
      rejected.push({
        id: r.id,
        direction: "outgoing",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups?.proposed_date ?? "",
        decidedAt: r.decided_at,
      })
    }
    for (const r of declinedIncoming ?? []) {
      rejected.push({
        id: r.id,
        direction: "incoming",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups?.proposed_date ?? "",
        decidedAt: r.decided_at,
      })
    }
    rejected.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
  }

  // Group-targeted requests (target_team_id still null, a shared
  // mini-rugby calendar named instead) never match the target_team_id
  // filter above -- without this, an incoming request against one of my
  // club's shared calendars would silently never appear.
  // No `?? manageableClubId(ctx)` fallback -- otherwise a group-targeted
  // request belonging to a DIFFERENT club this account also manages could
  // appear mixed into this list while viewing an unrelated active context.
  const myClubId = activeManageableClubId(ctx, activeContext)
  if (myClubId) {
    const { data: myGroups } = await supabase.from("scheduling_groups").select("id, display_tag").eq("club_id", myClubId)
    const myGroupIds = (myGroups ?? []).map((g) => g.id)
    if (myGroupIds.length > 0) {
      const { data: groupRequests } = await supabase
        .from("fixture_requests")
        .select(
          "id, venue_preference, target_scheduling_group_id, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)"
        )
        .in("target_scheduling_group_id", myGroupIds)
        .eq("status", "sent")

      for (const r of groupRequests ?? []) {
        const groupTag = myGroups?.find((g) => g.id === r.target_scheduling_group_id)?.display_tag ?? null
        const { data: members } = await supabase
          .from("scheduling_group_members")
          .select("teams(id, display_name, age_group)")
          .eq("group_id", r.target_scheduling_group_id!)

        requests.push({
          id: r.id,
          direction: "incoming",
          teamDisplayName: r.teams?.display_name ?? "Team",
          opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
          proposedDate: r.fixture_request_groups?.proposed_date ?? "",
          venuePreference: r.venue_preference,
          schedulingGroupTag: groupTag,
          schedulingGroupMembers: (members ?? []).flatMap((m) => (m.teams ? [{ id: m.teams.id, name: m.teams.display_name, ageGroup: m.teams.age_group }] : [])),
        })
      }
    }
  }

  // A request that named a structured team identity (Phase C: controlled
  // missing-team creation) has no target_team_id yet either -- it never
  // matches the plain incoming-request filter above. !inner is required
  // on the embed for the opponent_club_id filter to actually restrict
  // which rows come back (a plain embed only nulls out non-matching
  // related rows, per the same PostgREST caveat documented in
  // admin/fixtures/actions.ts's searchTeams).
  if (myClubId) {
    const { data: namedIdentityRequests } = await supabase
      .from("fixture_requests")
      .select(
        "id, venue_preference, target_team_age_group, target_team_gender, target_team_squad_designation, created_by, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups!inner(proposed_date, raw_opponent_text, opponent_club_id)"
      )
      .is("target_team_id", null)
      .not("target_team_age_group", "is", null)
      .eq("fixture_request_groups.opponent_club_id", myClubId)
      .eq("status", "sent")

    // Central Fixture Participant Resolution, section 9/10: wording must
    // reflect who initiated the request -- derived from whether the real
    // created_by actor is a Site Admin, never hardcoded into the domain
    // workflow. A request created by an ordinary Club Admin/Fixtures
    // Secretary never matches this, so club-initiated wording is
    // unaffected.
    const creatorIds = [...new Set((namedIdentityRequests ?? []).map((r) => r.created_by))]
    const { data: creatorSiteAdmins } =
      creatorIds.length > 0 ? await supabase.from("site_admins").select("user_id").in("user_id", creatorIds).eq("status", "active") : { data: [] as { user_id: string }[] }
    const siteAdminCreatorIds = new Set((creatorSiteAdmins ?? []).map((a) => a.user_id))

    for (const r of namedIdentityRequests ?? []) {
      const genderLabel = r.target_team_gender === "girls" ? "Girls " : ""
      const identityLabel = `${genderLabel}${r.target_team_age_group}${r.target_team_squad_designation ? ` ${r.target_team_squad_designation}` : ""}`
      // Resolved server-side, once, at render time -- the client component
      // only ever handles the interactive mutation (accept/decline via the
      // one atomic accept_fixture_request_with_team_action), never its own
      // fetch-on-mount loading state.
      const { data: resolved } = await supabase.rpc("check_incoming_request_target", { p_request_id: r.id }).single()
      requests.push({
        id: r.id,
        direction: "incoming",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups.proposed_date ?? "",
        venuePreference: r.venue_preference,
        namedTeamIdentity: identityLabel,
        namedTeamResolution: (resolved?.resolution ?? null) as RequestRowData["namedTeamResolution"],
        namedTeamExistingId: resolved?.existing_team_id ?? null,
        namedTeamMessage: resolved?.message ?? null,
        initiatedBySiteAdmin: siteAdminCreatorIds.has(r.created_by),
        // Creating/reactivating a team is club-structural authority, not
        // ordinary fixture authority -- a Fixtures Secretary can see and
        // accept ordinary requests but must escalate a genuine team
        // action to Club Admin (Central Fixture Participant Resolution).
        canCreateOrReactivateTeam: isClubAdminAnywhere(ctx) || ctx.isSiteAdmin,
      })
    }
  }

  // Action-required (received, awaiting your response) first; already-sent
  // requests are quieter and can wait.
  requests.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "incoming" ? -1 : 1
    return a.proposedDate.localeCompare(b.proposedDate)
  })
  nonOvalball.sort((a, b) => a.proposedDate.localeCompare(b.proposedDate))

  const activeTab = dir === "sent" ? "sent" : dir === "received" ? "received" : "all"
  const visibleRequests = activeTab === "all" ? requests : requests.filter((r) => (activeTab === "received" ? r.direction === "incoming" : r.direction === "outgoing"))
  const receivedCount = requests.filter((r) => r.direction === "incoming").length
  const sentCount = requests.filter((r) => r.direction === "outgoing").length

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Fixtures</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Fixture Requests</h1>
          <p className="mt-2 max-w-md text-sm text-ink/55">
            Two-way requests with other Ovalball clubs &mdash; sent, received, and awaiting a response.
          </p>
        </div>
        {activeContext.kind === "club" && canManageClubFixturesAnywhere(ctx) && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button className="h-10" variant="outline" nativeButton={false} render={<Link href="/fixtures/import" />}>
              Import fixtures
            </Button>
            <ExportClubFixturesButton />
            {myTeams.length > 0 && (
              <Button className="h-10" nativeButton={false} render={<Link href="/fixtures/new" />}>
                Request a fixture
              </Button>
            )}
          </div>
        )}
      </div>

      {requests.length > 0 && (
        <div className="mt-6 inline-flex items-center gap-1 rounded-lg border border-ink/10 bg-white p-1">
          {(
            [
              ["all", "All"],
              ["received", `Received${receivedCount ? ` (${receivedCount})` : ""}`],
              ["sent", `Sent${sentCount ? ` (${sentCount})` : ""}`],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={value === "all" ? "/fixtures" : `/fixtures?dir=${value}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                activeTab === value ? "bg-forest-950 text-white" : "text-ink/60 hover:bg-ink/5"
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      {visibleRequests.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">Nothing waiting on you</p>
          <p className="mt-1 text-sm text-ink/55">
            Fixture requests will appear here once a partner club shares availability to request against.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {visibleRequests.map((r) => (
            <RequestRow key={r.id} request={r} canManage={activeContext.kind === "club" && canManageClubFixturesAnywhere(ctx)} />
          ))}
        </ul>
      )}

      {nonOvalball.length > 0 && (
        <details className="mt-10 rounded-lg border border-ink/10 bg-white/60 open:bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink/70 outline-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-pitch-400">
            Non-Ovalball fixtures ({nonOvalball.length})
          </summary>
          <div className="border-t border-ink/10 px-4 py-3">
            <p className="text-xs text-ink/50">
              Arranged with clubs not currently active on Ovalball &mdash; recorded on your calendar, but there is
              no one on Ovalball to deliver a request to.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {nonOvalball.map((r) => (
                <NonOvalballRow key={r.id} request={r} />
              ))}
            </ul>
          </div>
        </details>
      )}
      {rejected.length > 0 && (
        <details className="mt-4 rounded-lg border border-destructive/15 bg-destructive/[0.02] open:bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-destructive/80 outline-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-pitch-400">
            Rejected requests ({rejected.length})
          </summary>
          <div className="border-t border-destructive/10 px-4 py-3">
            <p className="text-xs text-ink/50">Declined in the last 30 days &mdash; distinct from a Cancelled fixture, which was accepted and then called off.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {rejected.map((r) => {
                const date = r.proposedDate ? new Date(r.proposedDate + "T00:00:00") : null
                const dateLabel = date?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) ?? "TBC"
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
                    <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">Rejected</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink/70">
                        {r.teamDisplayName} <span className="text-ink/40">vs</span> {r.opponentText}
                      </p>
                      <p className="text-xs text-ink/45">{dateLabel}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </details>
      )}
    </div>
  )
}
