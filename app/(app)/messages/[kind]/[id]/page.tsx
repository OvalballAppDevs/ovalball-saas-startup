import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { reconcileOverdueFixtureResults } from "@/lib/app-context/reconcile-results"
import { resolveParticipantIdentities } from "@/lib/app-context/resolve-identities"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { teamPermissionLabel } from "@/lib/permissions/role-labels"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { markConversationRead, type ConversationKind } from "../../actions"
import { ConversationThread, type ThreadMessage } from "./conversation-thread"
import { FixtureResultPanel, type FixtureResultData } from "./fixture-result-panel"
import { CompetitionInlineEdit } from "./competition-inline-edit"
import { PitchInlineEdit } from "./pitch-inline-edit"
import { KickoffInlineEdit } from "./kickoff-inline-edit"
import { FixtureConversationHeader } from "./presence-panel"

const STATUS_LABELS: Record<string, string> = {
  sent: "Awaiting response",
  pending: "Awaiting response",
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

const STATUS_BADGE_STYLE: Record<string, string> = {
  accepted: "bg-pitch-600/10 text-pitch-700",
  Booked: "bg-pitch-600/10 text-pitch-700",
  Completed: "bg-forest-800/10 text-forest-800",
  sent: "bg-amber-500/10 text-amber-700",
  pending: "bg-amber-500/10 text-amber-700",
  Planned: "bg-amber-500/10 text-amber-700",
  counter_proposed: "bg-amber-500/10 text-amber-700",
  declined: "bg-destructive/10 text-destructive",
  cancelled: "bg-destructive/10 text-destructive",
  Cancelled: "bg-destructive/10 text-destructive",
  expired: "bg-ink/8 text-ink/50",
}

/**
 * Section 26-30: this thread's header (myTeamName/opponentName/teams[])
 * previously showed the raw teams.display_name -- which a B/C squad's
 * display alias never touches, since aliasing is deliberately a separate
 * table that only changes what's printed, never the canonical row (see
 * lib/teams/compact-label.ts's own doc comment). Resolves through the
 * SAME fullTeamLabel every other surface (Calendar, Teams, Fixture
 * Management, Pitch Allocation) already reads a team through, with the
 * alias applied when one exists. Falls back to raw display_name only for
 * a genuinely unmapped/legacy row (no category at all).
 */
function teamLabel(t: { display_name: string; category: string; age_group: string | null; gender: string | null; squad_designation: string | null } | null | undefined, alias: string | null): string | undefined {
  if (!t) return undefined
  if (!t.category) return t.display_name
  return fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, alias })
}

interface ThreadHeader {
  /** The real, shared conversation identity -- both mirror rows of a two-sided fixture resolve to the SAME value. Null for a request-stage thread (fixture_request_id-keyed, not mirrored). */
  conversationId: string | null
  myTeamName: string
  myClubName: string
  myClubId: string | null
  myClubLogoUrl: string | null
  opponentName: string
  opponentClubName: string
  opponentClubLogoUrl: string | null
  date: string | null
  kickoffTime: string | null
  status: string
  clubIds: string[]
  teams: { id: string; displayName: string; clubName: string; clubId?: string }[]
  pitch: string | null
  pitchId: string | null
  homeClubId: string | null
  homeAway: string | null
  rugbyCode: string
  competitionEditionId: string | null
  competitionName: string | null
  canEditCompetition: boolean
  kickoffAmendment: {
    proposedDate: string
    proposedTime: string | null
    proposedByClubId: string | null
    proposedByMe: boolean
  } | null
  result: FixtureResultData | null
}

export default async function ConversationThreadPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const { kind: rawKind, id } = await params
  if (rawKind !== "request" && rawKind !== "fixture" && rawKind !== "club") notFound()
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

  if (kind === "fixture") await reconcileOverdueFixtureResults(supabase)

  if (kind === "request") {
    const { data: r } = await supabase
      .from("fixture_requests")
      .select(
        "status, resulting_fixture_id, requesting_team:teams!fixture_requests_requesting_team_id_fkey(id, display_name, club_id, category, age_group, gender, squad_designation, clubs(logo_storage_path, club_directory(name, logo_storage_path))), target_team:teams!fixture_requests_target_team_id_fkey(id, display_name, club_id, category, age_group, gender, squad_designation, clubs(logo_storage_path, club_directory(name, logo_storage_path))), fixture_request_groups(proposed_date, raw_opponent_text, requesting_club_id, opponent_club_id)"
      )
      .eq("id", id)
      .maybeSingle()
    if (!r) notFound()
    resultingFixtureId = r.resulting_fixture_id

    const isMine = (teamId: string | null | undefined, clubId: string | null | undefined) =>
      (teamId && myTeamIds.has(teamId)) || (clubId && myClubIds.has(clubId))
    const iAmRequester = isMine(r.requesting_team?.id, r.fixture_request_groups?.requesting_club_id)
    const myTeam = iAmRequester ? r.requesting_team : r.target_team
    const opponentTeam = iAmRequester ? r.target_team : r.requesting_team

    const requestTeamIds = [r.requesting_team?.id, r.target_team?.id].filter((v): v is string => Boolean(v))
    const { data: requestAliasRows } = requestTeamIds.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", requestTeamIds) : { data: [] }
    const requestAliasByTeamId = new Map((requestAliasRows ?? []).map((a) => [a.team_id, a.alias]))

    header = {
      conversationId: null,
      myTeamName: teamLabel(myTeam, myTeam ? (requestAliasByTeamId.get(myTeam.id) ?? null) : null) ?? "Your team",
      myClubName: myTeam?.clubs?.club_directory?.name ?? "Ovalball",
      myClubId: myTeam?.club_id ?? null,
      myClubLogoUrl: logoUrl(supabase, myTeam?.clubs?.logo_storage_path ?? myTeam?.clubs?.club_directory?.logo_storage_path),
      opponentName: teamLabel(opponentTeam, opponentTeam ? (requestAliasByTeamId.get(opponentTeam.id) ?? null) : null) ?? r.fixture_request_groups?.raw_opponent_text ?? "Opponent",
      opponentClubName: opponentTeam?.clubs?.club_directory?.name ?? "Ovalball",
      opponentClubLogoUrl: logoUrl(supabase, opponentTeam?.clubs?.logo_storage_path ?? opponentTeam?.clubs?.club_directory?.logo_storage_path),
      date: r.fixture_request_groups?.proposed_date ?? null,
      kickoffTime: null,
      status: r.status,
      clubIds: [r.fixture_request_groups?.requesting_club_id, r.fixture_request_groups?.opponent_club_id].filter(
        (v): v is string => Boolean(v)
      ),
      teams: [r.requesting_team, r.target_team]
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({ id: t.id, displayName: teamLabel(t, requestAliasByTeamId.get(t.id) ?? null) ?? t.display_name, clubName: t.clubs?.club_directory?.name ?? "Ovalball", clubId: t.club_id })),
      pitch: null,
      pitchId: null,
      homeClubId: null,
      homeAway: null,
      rugbyCode: "",
      competitionEditionId: null,
      competitionName: null,
      canEditCompetition: false,
      kickoffAmendment: null,
      result: null,
    }
  } else if (kind === "club") {
    const { data: cc } = await supabase
      .from("club_conversations")
      .select(
        "id, status, requesting_club_id, recipient_club_id, requesting_club:clubs!club_conversations_requesting_club_id_fkey(logo_storage_path, club_directory(name, logo_storage_path)), recipient_club:clubs!club_conversations_recipient_club_id_fkey(logo_storage_path, club_directory(name, logo_storage_path))"
      )
      .eq("id", id)
      .maybeSingle()
    if (!cc) notFound()

    const iAmRequesting = myClubIds.has(cc.requesting_club_id)
    const myClub = iAmRequesting ? cc.requesting_club : cc.recipient_club
    const opponentClub = iAmRequesting ? cc.recipient_club : cc.requesting_club

    header = {
      conversationId: cc.id,
      myTeamName: "",
      myClubName: myClub?.club_directory?.name ?? "Ovalball",
      myClubId: iAmRequesting ? cc.requesting_club_id : cc.recipient_club_id,
      myClubLogoUrl: logoUrl(supabase, myClub?.logo_storage_path ?? myClub?.club_directory?.logo_storage_path),
      opponentName: "",
      opponentClubName: opponentClub?.club_directory?.name ?? "Ovalball",
      opponentClubLogoUrl: logoUrl(supabase, opponentClub?.logo_storage_path ?? opponentClub?.club_directory?.logo_storage_path),
      date: null,
      kickoffTime: null,
      status: cc.status,
      clubIds: [cc.requesting_club_id, cc.recipient_club_id],
      teams: [],
      pitch: null,
      pitchId: null,
      homeClubId: null,
      homeAway: null,
      rugbyCode: "",
      competitionEditionId: null,
      competitionName: null,
      canEditCompetition: false,
      kickoffAmendment: null,
      result: null,
    }
  } else {
    // Split into a flat-column query and a nested-relations query -- one
    // combined select with this many columns plus this much join nesting
    // pushes TypeScript's type inference past its recursion limit
    // ("Type instantiation is excessively deep and possibly infinite").
    // The relations query is also given an explicit .returns<T>() shape
    // (matching exactly what it selects) so its own join nesting alone
    // doesn't hit the same limit.
    interface FixtureFlatRow {
      conversation_id: string
      status: string
      kickoff_date: string
      kickoff_time: string | null
      home_away: string | null
      pitch_allocation: string | null
      pitch_id: string | null
      home_score: number | null
      away_score: number | null
      result_status: string | null
      result_submitted_by_club_id: string | null
      result_amendment_proposed_home_score: number | null
      result_amendment_proposed_away_score: number | null
      result_deadline_at: string | null
      kickoff_amendment_proposed_date: string | null
      kickoff_amendment_proposed_time: string | null
      kickoff_amendment_proposed_by_club_id: string | null
      competition_edition_id: string | null
      raw_opposition_text: string
    }

    interface FixtureRelationsRow {
      competition_editions: { competitions: { name: string | null } | null; seasons: { name: string | null } | null } | null
      owning_team: {
        id: string
        display_name: string
        club_id: string
        rugby_code: string
        category: string
        age_group: string | null
        gender: string | null
        squad_designation: string | null
        clubs: { logo_storage_path: string | null; club_directory: { name: string | null; logo_storage_path: string | null } | null } | null
      } | null
      opponent_team: {
        id: string
        display_name: string
        club_id: string
        category: string
        age_group: string | null
        gender: string | null
        squad_designation: string | null
        clubs: { logo_storage_path: string | null; club_directory: { name: string | null; logo_storage_path: string | null } | null } | null
      } | null
    }

    // The Supabase client is cast to `any` for these two calls only -- the
    // combination of this project's now-large schema and a 3-level-deep
    // nested join select (owning_team -> clubs -> club_directory) pushes
    // TypeScript's type-checker past its recursion limit even with
    // .returns<T>() applied (that only overrides the FINAL type; the
    // expensive part is resolving the intermediate .select() string into
    // a type at all). Real type safety is kept at the consumption site via
    // the explicit FixtureFlatRow/FixtureRelationsRow interfaces above,
    // which match exactly what each query selects.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate escape hatch, see comment above; real safety is the FixtureFlatRow/FixtureRelationsRow cast below.
    const untypedSupabase = supabase as unknown as { from: (table: string) => any }
    const [{ data: f }, { data: fRelations }] = (await Promise.all([
      untypedSupabase
        .from("fixtures")
        .select(
          "conversation_id, status, kickoff_date, kickoff_time, home_away, pitch_allocation, pitch_id, home_score, away_score, result_status, result_submitted_by_club_id, result_amendment_proposed_home_score, result_amendment_proposed_away_score, result_deadline_at, kickoff_amendment_proposed_date, kickoff_amendment_proposed_time, kickoff_amendment_proposed_by_club_id, competition_edition_id, raw_opposition_text"
        )
        .eq("id", id),
      untypedSupabase
        .from("fixtures")
        .select(
          "competition_editions(competitions(name), seasons(name)), owning_team:teams!fixtures_owning_team_id_fkey(id, display_name, club_id, rugby_code, category, age_group, gender, squad_designation, clubs(logo_storage_path, club_directory(name, logo_storage_path))), opponent_team:teams!fixtures_opponent_team_id_fkey(id, display_name, club_id, category, age_group, gender, squad_designation, clubs(logo_storage_path, club_directory(name, logo_storage_path)))"
        )
        .eq("id", id),
    ])) as [{ data: FixtureFlatRow[] | null }, { data: FixtureRelationsRow[] | null }]
    const fRow = f?.[0] ?? null
    const fRelationsRow = fRelations?.[0] ?? null
    if (!fRow || !fRelationsRow) notFound()

    const isMine = (teamId: string | null | undefined, clubId: string | null | undefined) =>
      (teamId && myTeamIds.has(teamId)) || (clubId && myClubIds.has(clubId))
    const iAmOwner = isMine(fRelationsRow.owning_team?.id, fRelationsRow.owning_team?.club_id)
    const myTeam = iAmOwner ? fRelationsRow.owning_team : fRelationsRow.opponent_team
    const opponentTeam = iAmOwner ? fRelationsRow.opponent_team : fRelationsRow.owning_team
    // home_away on this row is always the OWNING team's designation --
    // flip it for the opponent side's perspective when that's "my" side.
    const myHomeAway = fRow.home_away === "Home" || fRow.home_away === "Away" ? (iAmOwner ? fRow.home_away : fRow.home_away === "Home" ? "Away" : "Home") : null

    const fixtureTeamIds = [fRelationsRow.owning_team?.id, fRelationsRow.opponent_team?.id].filter((v): v is string => Boolean(v))
    const { data: fixtureAliasRows } = fixtureTeamIds.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", fixtureTeamIds) : { data: [] }
    const fixtureAliasByTeamId = new Map((fixtureAliasRows ?? []).map((a) => [a.team_id, a.alias]))

    header = {
      conversationId: fRow.conversation_id,
      myTeamName: teamLabel(myTeam, myTeam ? (fixtureAliasByTeamId.get(myTeam.id) ?? null) : null) ?? "Your team",
      myClubName: myTeam?.clubs?.club_directory?.name ?? "Ovalball",
      myClubId: myTeam?.club_id ?? null,
      myClubLogoUrl: logoUrl(supabase, myTeam?.clubs?.logo_storage_path ?? myTeam?.clubs?.club_directory?.logo_storage_path),
      opponentName: teamLabel(opponentTeam, opponentTeam ? (fixtureAliasByTeamId.get(opponentTeam.id) ?? null) : null) ?? fRow.raw_opposition_text,
      opponentClubName: opponentTeam?.clubs?.club_directory?.name ?? fRow.raw_opposition_text ?? "Opponent",
      opponentClubLogoUrl: logoUrl(supabase, opponentTeam?.clubs?.logo_storage_path ?? opponentTeam?.clubs?.club_directory?.logo_storage_path),
      date: fRow.kickoff_date,
      kickoffTime: fRow.kickoff_time,
      status: fRow.status,
      clubIds: [fRelationsRow.owning_team?.club_id, fRelationsRow.opponent_team?.club_id].filter((v): v is string => Boolean(v)),
      teams: [fRelationsRow.owning_team, fRelationsRow.opponent_team]
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({ id: t.id, displayName: teamLabel(t, fixtureAliasByTeamId.get(t.id) ?? null) ?? t.display_name, clubName: t.clubs?.club_directory?.name ?? "Ovalball", clubId: t.club_id })),
      pitch: fRow.pitch_allocation,
      pitchId: fRow.pitch_id,
      homeClubId: fRow.home_away === "Home" ? fRelationsRow.owning_team?.club_id ?? null : fRow.home_away === "Away" ? fRelationsRow.opponent_team?.club_id ?? null : null,
      homeAway: myHomeAway,
      rugbyCode: fRelationsRow.owning_team?.rugby_code ?? "",
      competitionEditionId: fRow.competition_edition_id,
      competitionName: fRelationsRow.competition_editions
        ? `${fRelationsRow.competition_editions.competitions?.name ?? ""} · ${fRelationsRow.competition_editions.seasons?.name ?? ""}`
        : null,
      canEditCompetition: Boolean(iAmOwner),
      kickoffAmendment:
        fRow.kickoff_amendment_proposed_date !== null
          ? {
              proposedDate: fRow.kickoff_amendment_proposed_date,
              proposedTime: fRow.kickoff_amendment_proposed_time,
              proposedByClubId: fRow.kickoff_amendment_proposed_by_club_id,
              proposedByMe: fRow.kickoff_amendment_proposed_by_club_id !== null && myClubIds.has(fRow.kickoff_amendment_proposed_by_club_id),
            }
          : null,
      result: {
        status: fRow.result_status ?? "none",
        homeScore: fRow.home_score,
        awayScore: fRow.away_score,
        amendmentHomeScore: fRow.result_amendment_proposed_home_score,
        amendmentAwayScore: fRow.result_amendment_proposed_away_score,
        myHomeAway,
        kickoffPassed:
          Boolean(fRow.kickoff_date) &&
          (fRow.kickoff_time
            ? new Date(`${fRow.kickoff_date}T${fRow.kickoff_time}`) <= new Date()
            : new Date(`${fRow.kickoff_date}T23:59:59`) <= new Date()),
        isCancelled: fRow.status === "Cancelled",
        rugbyCode: (fRelationsRow.owning_team?.rugby_code as "union" | "league" | undefined) ?? "union",
        deadlineAt: fRow.result_deadline_at,
        submittedByMe: fRow.result_submitted_by_club_id !== null && myClubIds.has(fRow.result_submitted_by_club_id),
      },
    }
  }

  const { data: homeClubPitches } = header.homeClubId
    ? await supabase
        .from("club_pitches")
        .select("id, display_name")
        .eq("club_id", header.homeClubId)
        .eq("active", true)
        .order("sort_order")
    : { data: null }

  // For a fixture thread, read by conversation_id (shared by both mirror
  // rows of one real fixture) rather than the specific row's own id --
  // fixture_id on each message row is only "which side's action created
  // it", never the read boundary; conversation_id is.
  let messagesQuery = supabase
    .from("fixture_messages")
    .select(
      "id, body, sender_user_id, created_at, kind, deleted_at, deleted_by_role, fixture_message_attachments(id, storage_path, original_filename, mime_type, size_bytes), fixture_message_document_refs(document_id, club_documents(id, title, category, mime_type, size_bytes, original_filename, storage_path)), fixture_message_contact_cards(display_name_snapshot, role_snapshot, club_name_snapshot, team_name_snapshot, telephone_snapshot)"
    )
    .order("created_at", { ascending: true })
  messagesQuery =
    kind === "request" ? messagesQuery.eq("fixture_request_id", id) : messagesQuery.eq("conversation_id", header.conversationId ?? id)
  const { data: messages } = await messagesQuery

  const identities = await resolveParticipantIdentities(
    supabase,
    (messages ?? []).map((m) => m.sender_user_id),
    header.clubIds,
    header.teams
  )

  const threadMessages: ThreadMessage[] = await Promise.all(
    (messages ?? []).map(async (m) => {
      const identity = identities.get(m.sender_user_id)
      const attachmentRow = m.fixture_message_attachments ?? null
      const attachment = attachmentRow
        ? {
            id: attachmentRow.id,
            filename: attachmentRow.original_filename,
            mimeType: attachmentRow.mime_type,
            sizeBytes: attachmentRow.size_bytes,
            signedUrl: (
              await supabase.storage.from("fixture-attachments").createSignedUrl(attachmentRow.storage_path, 3600)
            ).data?.signedUrl ?? null,
          }
        : null
      const doc = m.fixture_message_document_refs?.club_documents ?? null
      const documentShare = doc
        ? {
            id: doc.id,
            title: doc.title,
            category: doc.category,
            filename: doc.original_filename,
            mimeType: doc.mime_type,
            sizeBytes: doc.size_bytes,
            signedUrl: (await supabase.storage.from("club-documents").createSignedUrl(doc.storage_path, 3600)).data?.signedUrl ?? null,
          }
        : null
      const cardRow = m.fixture_message_contact_cards ?? null
      const contactCard = cardRow
        ? {
            displayName: cardRow.display_name_snapshot,
            roleLabel: cardRow.role_snapshot,
            clubName: cardRow.club_name_snapshot,
            teamName: cardRow.team_name_snapshot,
            telephone: cardRow.telephone_snapshot,
          }
        : null
      const isOwn = m.sender_user_id === user.id
      const isDeleted = Boolean(m.deleted_at)
      // Tombstone text substitutes for the real body the moment
      // deleted_at is set -- Section 85/86: normal participants (and this
      // query, which every consumer of ThreadMessage reads from) never see
      // the original content again once deleted; it survives only in the
      // raw fixture_messages row for an authorized moderator querying
      // directly (never exposed through this page).
      const body = isDeleted ? (m.deleted_by_role === "moderator" ? "Message has been deleted by admin." : "Message has been deleted by user.") : m.body
      return {
        id: m.id,
        body,
        createdAt: m.created_at,
        isOwn,
        isOwnClub: Boolean(identity?.clubId && identity.clubId === header.myClubId),
        isSystemEvent: m.kind === "system_event",
        isDeleted,
        canDelete: isOwn && !isDeleted,
        canReport: !isOwn && !isDeleted && m.kind !== "system_event",
        senderName: identity?.name ?? "Ovalball user",
        senderRoleLabel: identity?.roleLabel ?? "Member",
        senderClubName: identity?.clubName ?? "Ovalball",
        senderAvatarUrl: identity?.avatarUrl ?? null,
        attachment: isDeleted ? null : attachment,
        documentShare: isDeleted ? null : documentShare,
        contactCard: isDeleted ? null : contactCard,
      }
    })
  )

  // Real participants -- everyone with actual authorized access to this
  // conversation (can_access_fixture_conversation's own boundary: club
  // admins/fixture secretaries at either club, team officials on either
  // team), never every club member. Deduped by user, grouped by club.
  const participantUserIds = new Set<string>()
  const clubOfficialsQuery =
    header.clubIds.length > 0
      ? await supabase
          .from("club_memberships")
          .select("user_id, role, club_id, clubs(club_directory(name))")
          .in("club_id", header.clubIds)
          .in("role", ["CLUB_ADMIN", "FIXTURE_SECRETARY"])
          .eq("status", "active")
      : { data: [] }
  const teamIdsForParticipants = header.teams.map((t) => t.id)
  const teamOfficialsQuery =
    teamIdsForParticipants.length > 0
      ? await supabase
          .from("team_permissions")
          .select("permission, team_id, club_memberships!inner(user_id, status, club_id, clubs(club_directory(name)))")
          .in("team_id", teamIdsForParticipants)
          .in("permission", ["team_admin", "coach", "manager"])
          .eq("club_memberships.status", "active")
      : { data: [] }

  const participants: { userId: string; name: string; roleLabel: string; clubId: string; clubName: string }[] = []
  const profileIdsNeeded = new Set<string>()
  for (const row of clubOfficialsQuery.data ?? []) {
    if (participantUserIds.has(row.user_id)) continue
    participantUserIds.add(row.user_id)
    profileIdsNeeded.add(row.user_id)
    participants.push({
      userId: row.user_id,
      name: "",
      roleLabel: row.role === "CLUB_ADMIN" ? "Club Admin" : "Fixtures Admin",
      clubId: row.club_id,
      clubName: row.clubs?.club_directory?.name ?? "Ovalball",
    })
  }
  for (const row of teamOfficialsQuery.data ?? []) {
    const membership = row.club_memberships as unknown as { user_id: string; club_id: string; clubs: { club_directory: { name: string } | null } | null } | null
    if (!membership || participantUserIds.has(membership.user_id)) continue
    participantUserIds.add(membership.user_id)
    profileIdsNeeded.add(membership.user_id)
    participants.push({
      userId: membership.user_id,
      name: "",
      roleLabel: teamPermissionLabel(row.permission),
      clubId: membership.club_id,
      clubName: membership.clubs?.club_directory?.name ?? "Ovalball",
    })
  }
  // Explicitly-added participants (see "Add a participant") -- a fellow
  // club member with no CLUB_ADMIN/FIXTURE_SECRETARY/team-official role who
  // was deliberately granted access to this one conversation. club_id here
  // is resolved from their own active membership, not assumed from the
  // fixture's clubIds (an added person's club is already constrained to
  // one of header.clubIds by add_fixture_conversation_participant itself).
  const { data: addedRows } = await supabase
    .from("fixture_conversation_participants")
    .select("user_id")
    .eq(kind === "request" ? "fixture_request_id" : "fixture_id", id)
  const addedUserIds = (addedRows ?? []).map((r) => r.user_id).filter((uid) => !participantUserIds.has(uid))
  const { data: addedMemberships } =
    addedUserIds.length > 0 && header.clubIds.length > 0
      ? await supabase
          .from("club_memberships")
          .select("user_id, club_id, clubs(club_directory(name))")
          .in("user_id", addedUserIds)
          .in("club_id", header.clubIds)
          .eq("status", "active")
      : { data: [] }
  const addedMembershipByUser = new Map((addedMemberships ?? []).map((m) => [m.user_id, m]))
  for (const userId of addedUserIds) {
    const membership = addedMembershipByUser.get(userId)
    if (!membership || participantUserIds.has(userId)) continue
    participantUserIds.add(userId)
    profileIdsNeeded.add(userId)
    participants.push({
      userId,
      name: "",
      roleLabel: "Added to conversation",
      clubId: membership.club_id,
      clubName: membership.clubs?.club_directory?.name ?? "Ovalball",
    })
  }

  // profiles_select_self_or_admin blocks a plain SELECT of anyone else's
  // row (same gap resolve-identities.ts/conversations.ts already work
  // around) -- resolve through the same SECURITY DEFINER RPC, scoped to
  // this conversation's own clubs.
  const { data: participantProfiles } =
    profileIdsNeeded.size > 0 && header.clubIds.length > 0
      ? await supabase.rpc("get_conversation_participant_names", { p_user_ids: [...profileIdsNeeded], p_club_ids: header.clubIds })
      : { data: [] }
  const participantNameById = new Map(
    (participantProfiles ?? []).map((p) => [p.user_id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Ovalball user"])
  )
  const participantLastActiveById = new Map((participantProfiles ?? []).map((p) => [p.user_id, p.last_active_at]))
  for (const p of participants) p.name = participantNameById.get(p.userId) ?? "Ovalball user"

  // Subscription state (mute/leave) -- SUBSCRIBED is separate from CAN
  // ACCESS: someone who left no longer shows as an active participant,
  // but their role-derived or explicit-grant access is untouched.
  const { data: subscriptionRows } = await supabase
    .from("fixture_conversation_subscriptions")
    .select("user_id, muted, left_at")
    .eq(kind === "request" ? "fixture_request_id" : "fixture_id", id)
  const leftUserIds = new Set((subscriptionRows ?? []).filter((s) => s.left_at !== null).map((s) => s.user_id))
  const myMuted = (subscriptionRows ?? []).find((s) => s.user_id === user.id)?.muted ?? false
  const myLeft = leftUserIds.has(user.id)

  const participantsWithPresence = participants
    .filter((p) => !leftUserIds.has(p.userId))
    .map((p) => ({ ...p, lastActiveAt: participantLastActiveById.get(p.userId) ?? null }))
  const presenceTopic = `presence:${kind === "fixture" ? "f" : kind === "club" ? "c" : "r"}:${kind === "fixture" || kind === "club" ? (header.conversationId ?? id) : id}`

  // Same "operational contact" resolution the RPCs use server-side --
  // mirrored here purely for the UI (which "..." menu to show); the RPCs
  // themselves are the real authorization boundary regardless.
  const canManageParticipants =
    ctx.isSiteAdmin ||
    ctx.clubMemberships.some((m) => (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY") && header.clubIds.includes(m.clubId)) ||
    ctx.teamPermissions.some(
      (tp) => (tp.permission === "team_admin" || tp.permission === "coach" || tp.permission === "manager") && header.teams.some((t) => t.id === tp.teamId)
    )
  const myManageableClubId =
    ctx.clubMemberships.find((m) => (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY") && header.clubIds.includes(m.clubId))?.clubId ??
    ctx.teamPermissions.find(
      (tp) => (tp.permission === "team_admin" || tp.permission === "coach" || tp.permission === "manager") && header.teams.some((t) => t.id === tp.teamId)
    )?.clubId ??
    null

  await markConversationRead(kind, id)

  const dateLabel =
    kind === "club"
      ? null
      : header.date
        ? new Date(header.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
        : "Date TBC"

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-2xl flex-col px-4 py-6 md:h-screen md:px-8 md:py-10">
      <Link href="/messages" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Messages
      </Link>

      <div className="mt-4 rounded-lg border border-ink/10 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <ClubAvatar logoUrl={header.myClubLogoUrl} name={header.myClubName} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{header.myClubName}</p>
              {header.myTeamName && <p className="truncate text-xs text-ink/50">{header.myTeamName}</p>}
            </div>
          </div>
          <span className="shrink-0 text-ink/30">&harr;</span>
          <div className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2.5 text-right">
            <ClubAvatar logoUrl={header.opponentClubLogoUrl} name={header.opponentClubName} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{header.opponentClubName}</p>
              {header.opponentName && <p className="truncate text-xs text-ink/50">{header.opponentName}</p>}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <FixtureConversationHeader
            topic={presenceTopic}
            myUserId={user.id}
            kind={kind}
            id={id}
            participants={participantsWithPresence}
            canManageParticipants={canManageParticipants}
            myManageableClubId={myManageableClubId}
            myMuted={myMuted}
            myLeft={myLeft}
            dateStatusLine={
              <div className="flex flex-wrap items-center gap-2">
                {dateLabel && <span className="text-sm font-medium text-ink/70">{dateLabel}</span>}
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLE[header.status] ?? "bg-ink/8 text-ink/60"}`}>
                  {STATUS_LABELS[header.status] ?? header.status}
                </span>
                {kind === "fixture" && (
                  <>
                    <KickoffInlineEdit
                      fixtureId={id}
                      kickoffDate={header.date ?? ""}
                      kickoffTime={header.kickoffTime}
                      pendingAmendment={header.kickoffAmendment}
                    />
                    <PitchInlineEdit
                      fixtureId={id}
                      pitch={header.pitch}
                      pitchId={header.pitchId}
                      isHomeFixture={header.homeAway === "Home"}
                      availablePitches={homeClubPitches ?? []}
                    />
                    <CompetitionInlineEdit
                      fixtureId={id}
                      rugbyCode={header.rugbyCode}
                      competitionEditionId={header.competitionEditionId}
                      competitionName={header.competitionName}
                      canEdit={header.canEditCompetition}
                    />
                  </>
                )}
              </div>
            }
          />
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

      {kind === "fixture" && header.result && (
        <div className="mt-3">
          <FixtureResultPanel
            fixtureId={id}
            result={header.result}
            homeClubName={header.result.myHomeAway === "Away" ? header.opponentClubName : header.myClubName}
            awayClubName={header.result.myHomeAway === "Away" ? header.myClubName : header.opponentClubName}
            homeClubLogoUrl={header.result.myHomeAway === "Away" ? header.opponentClubLogoUrl : header.myClubLogoUrl}
            awayClubLogoUrl={header.result.myHomeAway === "Away" ? header.myClubLogoUrl : header.opponentClubLogoUrl}
          />
        </div>
      )}

      <div className="mt-4 min-h-0 flex-1">
        <ConversationThread
          kind={kind}
          id={id}
          initialMessages={threadMessages}
          sendingAsClubName={header.myClubName}
          sendingAsTeamName={header.myTeamName}
          sendingAsClubLogoUrl={header.myClubLogoUrl}
          canCompose={kind !== "club" || header.status === "accepted"}
        />
      </div>
    </div>
  )
}

function logoUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl
}
