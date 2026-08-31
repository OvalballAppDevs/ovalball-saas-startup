import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { resolveParticipantIdentities } from "@/lib/app-context/resolve-identities"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { markConversationRead, type ConversationKind } from "../../actions"
import { ConversationThread, type ThreadMessage } from "./conversation-thread"

const STATUS_LABELS: Record<string, string> = {
  sent: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  counter_proposed: "Counter-proposed",
  Booked: "Confirmed",
  Planned: "Planned",
  Cancelled: "Cancelled",
  Completed: "Completed",
}

interface ThreadHeader {
  myTeamName: string
  opponentName: string
  date: string | null
  status: string
  clubIds: string[]
  teams: { id: string; displayName: string; clubName: string }[]
}

export default async function ConversationThreadPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const { kind: rawKind, id } = await params
  if (rawKind !== "request" && rawKind !== "fixture") notFound()
  const kind = rawKind as ConversationKind

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const myTeamIds = new Set(ctx.teamPermissions.map((tp) => tp.teamId))
  const myClubIds = new Set(ctx.clubMemberships.map((m) => m.clubId))

  let header: ThreadHeader | null = null
  let resultingFixtureId: string | null = null

  if (kind === "request") {
    const { data: r } = await supabase
      .from("fixture_requests")
      .select(
        "status, resulting_fixture_id, requesting_team:teams!fixture_requests_requesting_team_id_fkey(id, display_name, club_id, clubs(club_directory(name))), target_team:teams!fixture_requests_target_team_id_fkey(id, display_name, club_id, clubs(club_directory(name))), fixture_request_groups(proposed_date, raw_opponent_text, requesting_club_id, opponent_club_id)"
      )
      .eq("id", id)
      .maybeSingle()
    if (!r) notFound()
    resultingFixtureId = r.resulting_fixture_id

    const isMine = (teamId: string | null | undefined, clubId: string | null | undefined) =>
      (teamId && myTeamIds.has(teamId)) || (clubId && myClubIds.has(clubId))
    const iAmRequester = isMine(r.requesting_team?.id, r.fixture_request_groups?.requesting_club_id)

    header = {
      myTeamName: (iAmRequester ? r.requesting_team?.display_name : r.target_team?.display_name) ?? "Your team",
      opponentName:
        (iAmRequester ? r.target_team?.display_name : r.requesting_team?.display_name) ??
        r.fixture_request_groups?.raw_opponent_text ??
        "Opponent",
      date: r.fixture_request_groups?.proposed_date ?? null,
      status: r.status,
      clubIds: [r.fixture_request_groups?.requesting_club_id, r.fixture_request_groups?.opponent_club_id].filter(
        (v): v is string => Boolean(v)
      ),
      teams: [r.requesting_team, r.target_team]
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({ id: t.id, displayName: t.display_name, clubName: t.clubs?.club_directory?.name ?? "Ovalball" })),
    }
  } else {
    const { data: f } = await supabase
      .from("fixtures")
      .select(
        "status, kickoff_date, owning_team:teams!fixtures_owning_team_id_fkey(id, display_name, club_id, clubs(club_directory(name))), opponent_team:teams!fixtures_opponent_team_id_fkey(id, display_name, club_id, clubs(club_directory(name))), raw_opposition_text"
      )
      .eq("id", id)
      .maybeSingle()
    if (!f) notFound()

    const isMine = (teamId: string | null | undefined, clubId: string | null | undefined) =>
      (teamId && myTeamIds.has(teamId)) || (clubId && myClubIds.has(clubId))
    const iAmOwner = isMine(f.owning_team?.id, f.owning_team?.club_id)

    header = {
      myTeamName: (iAmOwner ? f.owning_team?.display_name : f.opponent_team?.display_name) ?? "Your team",
      opponentName: (iAmOwner ? f.opponent_team?.display_name : f.owning_team?.display_name) ?? f.raw_opposition_text,
      date: f.kickoff_date,
      status: f.status,
      clubIds: [f.owning_team?.club_id, f.opponent_team?.club_id].filter((v): v is string => Boolean(v)),
      teams: [f.owning_team, f.opponent_team]
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({ id: t.id, displayName: t.display_name, clubName: t.clubs?.club_directory?.name ?? "Ovalball" })),
    }
  }

  const { data: messages } = await supabase
    .from("fixture_messages")
    .select("id, body, sender_user_id, created_at")
    .eq(kind === "request" ? "fixture_request_id" : "fixture_id", id)
    .order("created_at", { ascending: true })

  const identities = await resolveParticipantIdentities(
    supabase,
    (messages ?? []).map((m) => m.sender_user_id),
    header.clubIds,
    header.teams
  )

  const threadMessages: ThreadMessage[] = (messages ?? []).map((m) => {
    const identity = identities.get(m.sender_user_id)
    return {
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      isOwn: m.sender_user_id === user.id,
      senderName: identity?.name ?? "Ovalball user",
      senderRoleLabel: identity?.roleLabel ?? "Member",
      senderClubName: identity?.clubName ?? "Ovalball",
    }
  })

  await markConversationRead(kind, id)

  const dateLabel = header.date
    ? new Date(header.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : "Date TBC"

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-2xl flex-col px-4 py-6 md:h-screen md:px-8 md:py-10">
      <Link href="/messages" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Messages
      </Link>

      <div className="mt-4 rounded-lg border border-ink/10 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-ink">
              {header.myTeamName} <span className="text-ink/40">vs</span> {header.opponentName}
            </h1>
            <p className="mt-1 text-sm text-ink/55">{dateLabel}</p>
          </div>
          <span className="shrink-0 rounded-full bg-mint-100/60 px-2.5 py-1 text-xs font-medium text-forest-800">
            {STATUS_LABELS[header.status] ?? header.status}
          </span>
        </div>
        {kind === "request" && resultingFixtureId && (
          <Link
            href={`/messages/fixture/${resultingFixtureId}`}
            className="mt-3 inline-block text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
          >
            This fixture is confirmed &mdash; continue the conversation here
          </Link>
        )}
      </div>

      <div className="mt-4 min-h-0 flex-1">
        <ConversationThread kind={kind} id={id} initialMessages={threadMessages} />
      </div>
    </div>
  )
}
