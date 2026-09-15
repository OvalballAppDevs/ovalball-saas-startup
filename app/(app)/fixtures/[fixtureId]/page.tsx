import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Settings2 } from "lucide-react"

import { AttendancePanel } from "@/components/fixtures/match-centre/attendance-panel"
import { MatchCentreHero } from "@/components/fixtures/match-centre/hero"
import { MatchConditions } from "@/components/fixtures/match-centre/match-conditions"
import { MessageOpposition } from "@/components/fixtures/match-centre/message-opposition"
import { MessagingPanel, type FixtureMessageRow } from "@/components/fixtures/match-centre/messaging-panel"
import { listOppositionContacts } from "./opposition-contacts"
import { ParticipantList } from "@/components/fixtures/match-centre/participant-list"
import { getFixtureForecast } from "@/lib/weather/fixture-forecast"

import { CommunicationPanel } from "./communication-panel"
import { getMatchCentreContext } from "@/lib/app-context/match-centre-data"
import { resolvePersonalAvatarUrls } from "@/lib/app-context/personal-avatar"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

// Reachable from the Calendar, the Fixtures list, Fixture Management and an
// attendance-invitation notification, so it needs its own tab name. Static
// rather than generateMetadata: the fixture's own identity would be a better
// title, but building it means a second authorised read purely for a tab
// label, and this page is already one resolver call.
export const metadata = { title: "Match Centre" }

/**
 * MATCH CENTRE -- one fixture, one page, every role.
 *
 * ONE SHARED SURFACE. There is no per-role Match Centre -- no parent, player,
 * staff or admin variant of this component tree -- and no role branch choosing
 * between trees. Everybody who can open this fixture sees the same structure
 * in the same order; CAPABILITY decides which sections their viewer's data and
 * actions put in front of them, and capability is resolved server-side by
 * getMatchCentreContext, never from a role name in the browser.
 * (scripts/verify-match-centre-shared.mjs enforces this structurally, and is
 * blunt enough to flag the role-prefixed names even inside a comment -- which
 * is why this paragraph describes them rather than spelling them out.)
 *
 * CONTEXT NEVER SUPPRESSES A CAPABILITY. A club admin who also plays keeps
 * their fixture controls while they are looking at the game as a player. That
 * was tried the other way round for exactly one iteration and reverted: the
 * fuller page is the good one, and the way to make surfaces consistent is for
 * other viewers to inherit it wherever their capabilities allow, never to
 * level it down.
 *
 * THE PAGE IS A PRESENTATION SURFACE, NOT AN EDITING AUTHORITY. It reads the
 * canonical fixture and writes exactly two things a participant owns: their
 * own availability, and a message to an audience they are authorised to
 * address. Everything else about the fixture -- kick-off, venue, pitch, MEET
 * TIME, status, result -- is edited in Fixture Management, which owns the
 * record. Meet time in particular used to be editable here, which made the
 * surface the whole club READS the fixture on the one place that could CHANGE
 * one of its fields.
 *
 * THE SHAPE, top to bottom, and why it is this order:
 *
 *   1. the matchday card -- who is playing, when, and the viewer's own answer,
 *      because the invitation and the reply to it are one object
 *   2. match conditions -- where it is, what the pitch is, what the weather
 *      will do: one question, so one section
 *   3. who's in -- the squad and its counts together, staff-gated
 *   4. the conversation -- ONE messaging surface: the thread everybody reads
 *      and writes in, with the staff announcement composer folded into the
 *      same section rather than standing as a second card
 */
export default async function FixtureMatchCentrePage({ params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const resolution = await getMatchCentreContext(supabase, user.id, fixtureId)
  if (resolution.status === "not_found") notFound()
  const { context } = resolution

  // Audience sizes for the communication section. The RPC returns NULLs for a
  // caller without fixture-management capability, so an unauthorized viewer
  // gets no metric at all rather than an authoritative zero.
  const { data: counts } = await supabase.rpc("fixture_communication_counts", { p_fixture_id: fixtureId }).maybeSingle()

  // DERIVED data, resolved server-side from the fixture's canonical kickoff
  // and its venue's coordinates. Never throws: every failure -- no credential,
  // timeout, 429, malformed payload -- comes back as a state, so a weather
  // outage can never take this page with it.
  const weather = await getFixtureForecast({
    kickoffDate: context.fixture.kickoffDate,
    kickoffTime: context.fixture.kickoffTime,
    latitude: context.venue.latitude,
    longitude: context.venue.longitude,
  })

  const oppositionContacts = await listOppositionContacts(fixtureId)

  let messages: FixtureMessageRow[] = []
  if (context.messaging.canView) {
    const { data: rows } = await supabase
      .from("fixture_messages")
      .select("id, body, created_at, sender_user_id, reported_at")
      .eq("fixture_id", fixtureId)
      // A removed message stays in the table -- it is frequently the evidence
      // for whatever it was removed over -- but it is not shown.
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(50)

    const senderIds = Array.from(new Set((rows ?? []).map((m) => m.sender_user_id)))
    // get_conversation_participant_names, NOT a direct profiles select.
    // profiles_select_self_or_admin restricts a table read to your own row, so
    // a plain select resolved every OTHER person in the thread to nothing and
    // the conversation rendered as a wall of "Someone" -- caught in UAT. This
    // is the canonical SECURITY DEFINER path, scoped to the clubs actually
    // party to this fixture, which is exactly the scope a fixture thread has.
    const conversationClubIds = [context.homeSide.clubId, context.awaySide.clubId].filter((c): c is string => Boolean(c))
    const { data: senderProfiles } =
      senderIds.length > 0 && conversationClubIds.length > 0
        ? await supabase.rpc("get_conversation_participant_names", { p_user_ids: senderIds, p_club_ids: conversationClubIds })
        : { data: [] as { user_id: string; first_name: string | null; surname: string | null; avatar_storage_path: string | null }[] }
    const senderById = new Map((senderProfiles ?? []).map((p) => [p.user_id, p]))
    const senderAvatars = await resolvePersonalAvatarUrls(supabase, (senderProfiles ?? []).map((p) => p.avatar_storage_path))

    messages = (rows ?? []).map((m) => {
      const sender = senderById.get(m.sender_user_id)
      const first = sender?.first_name ?? ""
      const surname = sender?.surname ?? ""
      const name = `${first} ${surname}`.trim()
      return {
        id: m.id,
        // An image message may legitimately have no caption -- see 20270239000000.
        body: m.body ?? "",
        createdAt: m.created_at,
        senderName: name.length > 0 ? name : "Someone",
        senderUserId: m.sender_user_id,
        // The account's own picture, signed under the private avatars bucket's policy (a minor's is not offered
        // to people outside their family and staff). A player's photo lives in its own bucket and is deliberately
        // not reachable from here: a message thread is not a roster.
        senderAvatarUrl: sender?.avatar_storage_path ? (senderAvatars.get(sender.avatar_storage_path) ?? null) : null,
        senderInitials: `${first[0] ?? ""}${surname[0] ?? ""}`.toUpperCase() || "?",
        isOwn: m.sender_user_id === user.id,
        reported: m.reported_at !== null,
      }
    })
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-28">
      {/* pb-28 clears the global "Ask Ovie" floating widget, which sits fixed
          bottom-right on every page -- without it, the messaging compose row's
          Send button sits directly underneath it at narrow viewports
          (confirmed overlapping via getBoundingClientRect during UAT), an
          inaccessible, unclickable control. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/fixtures" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> Fixtures
        </Link>
        {/* The route back to the record. Presentation only -- Fixture
            Management enforces its own authority on arrival -- but offered
            only to a viewer who already holds fixture-management capability,
            so it is not a dead end for everybody else. */}
        {context.actions.canManageFixture && (
          <Link
            href={`/admin/fixtures/${context.fixture.fixtureId}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/12 px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-ink/[0.03] hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
          >
            <Settings2 className="size-4" aria-hidden="true" />
            Manage Fixture
          </Link>
        )}
      </div>

      {/* 1. THE MATCHDAY CARD. The viewer's own availability is rendered
             inside it, joined to the fixture it answers. */}
      <MatchCentreHero fixture={context.fixture} homeSide={context.homeSide} awaySide={context.awaySide} venueName={context.venue.name}>
        <AttendancePanel
          fixtureId={context.fixture.fixtureId}
          entries={context.attendance.mine}
          fixtureCancelled={context.fixture.status === "CANCELLED"}
        />
      </MatchCentreHero>

      {/* 2. WHERE, AND WHAT IT WILL BE LIKE THERE. */}
      <MatchConditions venue={context.venue} pitch={context.pitch} weather={weather} />

      {/* 3. THE SQUAD. Renders nothing at all without the capability, rather
             than a "not available in this view" placeholder -- a viewer who
             cannot see the roster is not missing a feature, they are simply
             not staff, and telling them so on every fixture is noise. */}
      <ParticipantList participants={context.participants} counts={context.attendance.counts} canView={context.actions.canViewParticipants} />

      {/* 4. ONE messaging surface. The conversation is the thread everybody
             reads and writes in; the staff announce composer is folded into
             the same section as an action rather than living as a second
             card with its own textarea.

             They are NOT the same thing and are not merged into one control:
             posting here is a message in a thread, which reaches whoever
             comes and reads it, while an announcement is a NOTIFICATION
             delivered through the safeguarding-aware recipient model, so it
             reaches a guardian who never opens the app. Collapsing the second
             into the first would quietly stop families being told things. */}
      {/* CONTACTING THE OTHER SIDE is a communication action, so it sits with
          the messaging section rather than among the fixture controls. It
          renders nothing unless the server found somebody: most fixtures name
          their opponent from the Club Directory, where there is no account to
          message. */}
      <MessageOpposition contacts={oppositionContacts} />

      <MessagingPanel
        fixtureId={context.fixture.fixtureId}
        conversation={context.messaging}
        initialMessages={messages}
        announce={
          context.actions.canManageFixture ? (
            <CommunicationPanel
              fixtureId={context.fixture.fixtureId}
              outstandingCount={counts?.outstanding_count ?? null}
              attendingCount={counts?.attending_count ?? null}
              teamCount={counts?.team_count ?? null}
            />
          ) : null
        }
      />
    </div>
  )
}
