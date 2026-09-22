import { notFound, redirect } from "next/navigation"
import Link from "next/link"

import { PageIdentity } from "@/components/shell/page-identity"
import { workspaceLabel } from "@/lib/app-context/workspace-label"
import { cookies } from "next/headers"
import { ChevronLeft, ChevronRight, Newspaper, UserPlus, Users } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { formatGenderLabel } from "@/lib/teams/labels"

import { teamJoinCodes } from "./join-code-actions"
import { loadAgenda } from "@/lib/agenda/load"
import { teamAgendaWindows } from "@/lib/teams/team-overview"
import { loadMyPlayerAgeGradeStatus, loadTeamAgeGradeAttention } from "@/lib/teams/age-grade"
import type { AgendaScope } from "@/lib/agenda/scope"
import type { FamilyChild } from "@/lib/parent/family-agenda"
import { MyChildAgeGradeNote, TeamAgeGradeAttentionPanel } from "@/components/teams/team-age-grade"
import { TeamRelationshipBadges } from "@/components/teams/team-relationship-badges"
import { TeamWhatsNext } from "@/components/teams/team-whats-next"
import { TeamSubscriptionsSection } from "@/components/teams/team-subscriptions-section"
import { loadTeamSubscriptions } from "@/lib/teams/team-subscriptions"
import { answerablePlayerIds, type TeamRelationship } from "@/lib/teams/team-relationship"
import { JoinCodeSection } from "./join-code-section"
import { TeamIdentitySection } from "./team-identity-section"
import { TeamLifecycleSection, type RestorableFixtureRow } from "./team-lifecycle-section"

export default async function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  const { data: team } = await supabase
    .from("teams")
    .select("id, club_id, display_name, rugby_code, category, age_group, squad_designation, gender, active, folded_at, fold_reason")
    .eq("id", teamId)
    .maybeSingle()

  if (!team) notFound()

  const { data: aliasRow } = await supabase.from("team_aliases").select("alias").eq("team_id", teamId).maybeSingle()

  // Scoped to the ACTIVE context's own club, not "does this session hold
  // club-wide fixture authority ANYWHERE" -- the old canManageClubFixturesAnywhere(ctx)
  // + session-wide clubMemberships check meant a multi-role account
  // switched into Parent View (or any unrelated team's context) could
  // still browse and, via canManage below, edit a completely different
  // team's record merely because it also happens to be Club Admin
  // somewhere. See app/(app)/people/page.tsx for the identical leak class
  // found and fixed earlier in this pass.
  const activeClub = activeClubId(ctx, activeContext)

  // Entry is now a capability on THIS team, not a club-wide role held
  // somewhere. A coach assigned to this side sees its people; that is the
  // whole point of the roster. The active-context check stays, so a
  // multi-role account switched into an unrelated club still cannot browse
  // this team -- see app/(app)/people/page.tsx for that leak class.
  // ENTRY IS A CAPABILITY AT THIS TEAM, AND NOTHING ELSE.
  //
  // It used to also require the ACTIVE context's club to be this team's club,
  // which was the right instinct aimed at the wrong conjunct. The leak that
  // rule was written against was a SESSION-WIDE one -- "does this account hold
  // club authority anywhere" -- and `team.team.view` is not that: the engine
  // resolves it at this team, inheriting from this team's club only, so a Club
  // Admin of one club still cannot see another's team.
  //
  // What the extra conjunct did do was lock out the people the team is for. A
  // guardian in All Children mode has NO active club by design -- a family view
  // is deliberately not scoped to one -- so every parent was redirected away
  // from their own child's team page, and so was any player whose active
  // context was their own. Convergence Step 10's browser journey found it at
  // B1: the guardian landed on /dashboard.
  //
  // The club scoping stays exactly where it belongs, on `canManage` below,
  // which is the club-wide authority the original fix was about.
  const canView =
    ctx.siteCapabilities.includes("site.clubs.view") ||
    (await hasCapability(supabase, "team.team.view", "team", { clubId: team.club_id, teamId: team.id }))
  if (!canView) redirect("/teams")

  const canManage = ctx.isSiteAdmin || activeManageableClubId(ctx, activeContext) === team.club_id

  // Deliberately NOT the same flag as canManage. Team settings and folding are
  // club-wide decisions; keeping a team's own roster straight is the team's,
  // and this asks the exact question internal.team_people_authority asks, so
  // the buttons on screen and the writes behind them can never disagree.
  // Team Admin itself is club authority (a Club Admin, or Ovalball's site.team_roles.manage); Team
  // Administration holders assign Coach and Team Manager only. The database refuses the rest regardless.
  // The controls behind this flag are ROSTER controls (Archive, Restore, Approve, Decline), and the writes
  // behind them are refused by internal.team_people_authority, which asks team.roster.manage at the team's
  // scope or inherited from the club. So this asks exactly that, at both scopes, and the buttons on screen
  // cannot disagree with the writes behind them. team.team.manage is the wrong question here: it is team
  // settings (Club Admin and Team Administration), and it would hide the roster from a Team Manager who is
  // allowed to change it, while also not inheriting to a Club Admin who holds it club-wide.
  const canManagePeople =
    ctx.siteCapabilities.includes("site.team_roles.manage") ||
    (await hasCapability(supabase, "team.roster.manage", "team", { clubId: team.club_id, teamId: team.id })) ||
    (await hasCapability(supabase, "team.roster.manage", "club", { clubId: team.club_id }))

  // A join code is a credential for this team, so it is gated on the capability that says so --
  // held either at the team itself or club-wide. This only decides whether to show the section;
  // issue_invitation re-decides it, and it is the boundary.
  const canManageJoinCodes =
    (await hasCapability(supabase, "team.join_code.manage", "team", { clubId: team.club_id, teamId: team.id })) ||
    (await hasCapability(supabase, "team.join_code.manage", "club", { clubId: team.club_id }))

  // Team news: the same capability pair the database's publishing adapter
  // resolves (club.news.manage, or team.news.manage for this team). This
  // only decides whether to show the entry point.
  const canPublishTeamNews =
    (await hasCapability(supabase, "club.news.manage", "club", { clubId: team.club_id })) ||
    (await hasCapability(supabase, "team.news.manage", "team", { clubId: team.club_id, teamId: team.id }))

  // THE ROSTER IS NOT READ HERE ANY MORE. It moved, whole, to /teams/[teamId]/people -- one page, one
  // read. Leaving the query behind would have meant this page fetching a roster it no longer renders
  // on every visit, which is the sort of thing that survives for years because nothing fails.

  // WHAT THIS PERSON IS TO THIS TEAM, from the one canonical reader. Nothing
  // authorises off it -- every control below still asks the capability engine --
  // but a page that cannot say "you are this child's parent" is a page nobody
  // can orient themselves on, which is what Step 0 recorded about this one.
  const { data: relationshipRows } = await supabase.rpc("my_team_relationship", { p_team_id: teamId })
  const relationships: TeamRelationship[] = (relationshipRows ?? []).map((r) => ({
    relationship: r.relationship,
    label: r.label,
    subjectPlayerId: r.subject_player_id,
    subjectName: r.subject_name,
  }))
  const answerable = answerablePlayerIds(relationships)

  // CONVERGENCE STEP 12 -- the age-grade answer, asked for the first time.
  //
  // Staff get only the players who need attention, and only as a status. A family gets the same
  // status for their own child. Both readers refuse an unauthorised viewer server-side, so an empty
  // list here means "nothing to show you", never "hidden in the browser".
  const ageGradeAttention = await loadTeamAgeGradeAttention(supabase, team.id)
  const myChildAgeGrade = (
    await Promise.all(
      relationships
        .filter((r) => r.subjectPlayerId)
        .map((r) => loadMyPlayerAgeGradeStatus(supabase, r.subjectPlayerId as string))
    )
  ).flat()

  // WHAT'S NEXT, from the canonical agenda reader the Calendar and the family
  // agenda already use. A family scope is used where the viewer has one, because
  // that is what puts a player id on each row and makes Step 9's answer control
  // work; otherwise the team's own scope, which carries none and asks nobody to
  // answer anything.
  const todayIso = new Date().toISOString().slice(0, 10)
  const familyChildren: FamilyChild[] = relationships
    .filter((r) => r.subjectPlayerId)
    .map((r) => ({
      playerId: r.subjectPlayerId as string,
      firstName: (r.subjectName ?? "").split(" ")[0] ?? "",
      surname: (r.subjectName ?? "").split(" ").slice(1).join(" "),
      fullName: r.subjectName ?? "",
      teamId: team.id,
      teamName: team.display_name,
      clubId: team.club_id,
      clubName: "",
      avatarStoragePath: null,
    }))

  const agendaScope: AgendaScope =
    familyChildren.length > 0
      ? { kind: "family", children: familyChildren }
      : { kind: "teams", teamIds: [team.id], clubId: team.club_id }

  // SUBSCRIPTIONS, ONLY FOR SOMEBODY WHO MAY SEE THEM.
  //
  // finance.subscription.view is CLUB-scoped -- every finance capability in this product is -- so a
  // team manager who is not also club finance staff gets nothing here and the section does not render.
  // That is the existing authority model, preserved rather than widened: giving team staff a
  // team-level finance capability would be new authority, and new authority is an owner decision.
  const canSeeFinance = await hasCapability(supabase, "finance.subscription.view", "club", { clubId: team.club_id })
  const teamSubscriptions = canSeeFinance ? await loadTeamSubscriptions(supabase, team.id) : null

  const [upcomingRead, recentRead] = await Promise.all([
    // THE SAME WINDOW THE TEAM'S DASHBOARD USES. Sixty days hid a January fixture from a team in
    // September, so this page said "Nothing scheduled yet" about a season that was in fact arranged.
    loadAgenda(supabase, agendaScope, teamAgendaWindows(todayIso).upcoming, { includeTraining: true }),
    loadAgenda(supabase, agendaScope, teamAgendaWindows(todayIso).past, { includeTraining: false }),
  ])
  const upcoming = upcomingRead.items.slice(0, 5)
  const recent = recentRead.items.filter((i) => i.result).slice(0, 3)

  let restorableFixtures: RestorableFixtureRow[] = []
  if (canManage && team.active) {
    const { data: restorable } = await supabase.rpc("list_restorable_fixtures", { p_team_id: teamId })
    restorableFixtures = (restorable ?? []).map((f) => ({
      id: f.id,
      kickoffDate: f.kickoff_date,
      raw: f.raw_opposition_text,
      homeAway: f.home_away as "Home" | "Away",
    }))
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/teams" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" />
        Teams
      </Link>

      {/* A team page IS the team, so its canonical display name stays the heading. The page already
          carried the workspace word; moving it onto the shared primitive is what makes it reach a
          screen reader as part of the heading rather than as text stranded above it. "Folded" stays
          beside the eyebrow because it qualifies the team, not the page. */}
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <PageIdentity workspace={workspaceLabel("team")} title={team.display_name} className="mt-0" />
        {!team.active && (
          <span className="mt-0.5 rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink-muted">Folded</span>
        )}
      </div>

      <TeamRelationshipBadges relationships={relationships} />

      {/* A family's own position on this team, in the same words the club sees. Rendered next to who
          they are to the team, because that is the question it answers. */}
      <MyChildAgeGradeNote rows={myChildAgeGrade} teamId={team.id} />

      <TeamWhatsNext
        upcoming={upcoming}
        recent={recent}
        todayIso={todayIso}
        answerable={answerable}
        returnTo={`/teams/${team.id}`}
      />

      <div className="mt-8">
        {canManage ? (
          <>
            <p className="mb-3 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Team settings</p>
            <TeamIdentitySection
              team={{
                id: team.id,
                fullLabel: fullTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, rugbyCode: team.rugby_code, alias: aliasRow?.alias ?? null }),
                compactLabel: compactTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, rugbyCode: team.rugby_code, alias: aliasRow?.alias ?? null }),
                squadDesignation: team.squad_designation,
                active: team.active,
                alias: aliasRow?.alias ?? null,
              }}
            />
          </>
        ) : (
          <div className="rounded-lg border border-ink/10 bg-white p-6">
            <p className="text-sm text-ink/60">
              {[
                fullTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, rugbyCode: team.rugby_code, alias: aliasRow?.alias ?? null }),
                formatGenderLabel(team.gender),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
      </div>

      {/* Age grade, before the roster it is about. Renders nothing when nothing needs attention. */}
      <TeamAgeGradeAttentionPanel rows={ageGradeAttention} />

      {/* PEOPLE MOVED OUT, because it is recurring work and this page is not.
          A manager looks at the roster most weeks; they set a join code up once. Everyday jobs belong
          in navigation, and this page is what the gear opens -- infrequent team administration. The
          link stays so anybody who knew where it was still finds it. */}
      <Link
        href={`/teams/${team.id}/people`}
        className="mt-8 flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Users aria-hidden="true" className="size-5 shrink-0 text-forest-800" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">People</span>
          <span className="block text-sm text-ink-muted">
            Players, parents and guardians, coaches and managers.
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      </Link>

      {/* PLAYER REQUESTS, in their durable administrative home.
          They left primary navigation because they are occasional -- too small a job to hold a
          permanent place beside Fixtures. They are not hidden: a pending request appears in the team's
          Needs Attention and in its notification, both of which link straight to the decision. This is
          where somebody goes looking for one deliberately. */}
      {canManagePeople && (
        <Link
          href={`/teams/${team.id}/player-requests`}
          className="mt-3 flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <UserPlus aria-hidden="true" className="size-5 shrink-0 text-forest-800" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">Player Requests</span>
            <span className="block text-sm text-ink-muted">Call-ups and requests for this team.</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </Link>
      )}

      {/* Money sits after the people it is about, and before the configuration nobody opens daily. */}
      {teamSubscriptions && <TeamSubscriptionsSection summary={teamSubscriptions} />}

      {canManageJoinCodes && team.active && (
        <JoinCodeSection teamId={team.id} codes={await teamJoinCodes(team.id)} />
      )}

      {canPublishTeamNews && team.active && (
        <Link
          href={`/teams/${team.id}/news`}
          className="mt-8 flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <Newspaper aria-hidden="true" className="size-5 shrink-0 text-forest-800" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">Team News</span>
            <span className="block text-xs text-ink-muted">Publish match reports, updates and notices on the club&apos;s public page.</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </Link>
      )}

      {canManage && (
        <TeamLifecycleSection
          team={{
            teamId: team.id,
            displayName: team.display_name,
            active: team.active,
            foldedAt: team.folded_at,
            foldReason: team.fold_reason,
            restorableFixtures,
          }}
        />
      )}

      {/* THE SENTENCE FOLLOWS THE SAME DECISION THE CONTROLS DO.
          This used to read "Only this club's Club Admin can edit team details or
          assign people", gated on isClubAdminAnywhere -- a SESSION-WIDE flag, and
          nothing to do with authority at this team. A Team Manager therefore read
          that she could not assign people directly beneath the assign control she
          is genuinely entitled to use, because the roster section is gated
          properly on team.roster.manage. One question, two answers, and the wrong
          one in the more visible place.
          It now asks the identical flags the sections themselves ask, so the
          explanation cannot contradict what is on the screen, and it names only
          what is actually withheld. No role is mentioned: naming "Club Admin"
          here is what let copy drift away from the capability engine in the first
          place, and a club that moves team.roster.manage onto another role would
          have been lied to all over again. */}
      {(!canManage || !canManagePeople) && (
        <p className="mt-6 text-xs text-ink-muted">
          {canManagePeople
            ? "You can manage who is in this team. Changing the team's own details is done by the club."
            : canManage
              ? "You can change this team's details. Assigning people to it is done by the club."
              : "You can see this team, but changing its details or who is in it is done by the club."}
        </p>
      )}
    </div>
  )
}
