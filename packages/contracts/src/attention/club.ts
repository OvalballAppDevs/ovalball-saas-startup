import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { attentionItem, type AttentionItem } from "./model"
import { dispensationWaitingDetail, dispensationWaitingTitle, readDispensationsWaiting, type DispensationWaiting } from "../team/dispensation"
import { resultsWaitingOn } from "../team/overview"

type Client = SupabaseClient<Database>

/**
 * A CLUB'S ATTENTION: the queues a club administrator answers, read from the records that hold them.
 *
 * ONE AUTHORITY PROBE, then only the reads that probe allows. Each queue is the canonical table's own
 * pending state -- `club_join_requests` through `list_pending_club_join_requests`, `fixture_requests`
 * still `sent` to one of the club's sides, a kick-off the OTHER club proposed, a result the other club
 * submitted, a partnership asked of us, a player asking to join. Nothing is counted the viewer may
 * not see: a queue behind a capability this person does not hold is simply absent.
 *
 * WHAT IS NOT HERE, deliberately: tournament invitations and competition verifications (their
 * readers are not yet shared), season handover blockers (a desk job the app hands to the web), and
 * safeguarding queues -- guardian link approvals are read on the Guardians & Players screens
 * themselves (CA-M11.1) rather than counted here. An age-grade DISPENSATION waiting for this person's
 * decision is counted, one item per request, named "Dispensation requested for <child>" and opening the
 * record itself: the server's `dispensation_decisions_waiting` says which -- the club's Safeguarding
 * Officer and its Club Admins, never the person who asked or the child's family -- and a decided request
 * is simply no longer there (docs/mobile/CA_M8_NOTIFICATIONS_ACTION_CENTRE_MAP.md records each).
 */
export const CLUB_ATTENTION_KEYS = {
  joinRequests: "people.member.view",
  playerJoinRequests: "club.roster.manage",
  requestRespond: "fixture.request.respond",
  fixtureEdit: "fixture.fixture.edit",
  resultRecord: "fixture.result.record",
  partners: "club.partners.manage",
  tournamentManage: "tournament.tournament.manage",
  dispensationApproveClub: "fixture.dispensation.approve_club",
  dispensationDecide: "safeguarding.dispensation.decide",
} as const

export async function loadClubAttention(supabase: Client, clubId: string, todayIso: string): Promise<AttentionItem[]> {
  const { data: caps } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  const allowed = new Set((caps ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  const may = (key: string) => allowed.has(key)
  const ctx = { kind: "club" as const, clubId, teamId: null, playerId: null }

  const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", clubId)
  const teamIds = (teamRows ?? []).map((t) => t.id)
  const sides = teamIds.length > 0 ? `owning_team_id.in.(${teamIds.join(",")}),opponent_team_id.in.(${teamIds.join(",")})` : null

  const [joins, playerJoins, requests, proposals, results, partners] = await Promise.all([
    may(CLUB_ATTENTION_KEYS.joinRequests) ? supabase.rpc("list_pending_club_join_requests", { p_club_id: clubId }).then((r) => r.data ?? []) : Promise.resolve([]),
    may(CLUB_ATTENTION_KEYS.playerJoinRequests)
      ? supabase.from("player_club_join_requests").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "pending").then((r) => r.count ?? 0)
      : Promise.resolve(0),
    may(CLUB_ATTENTION_KEYS.requestRespond) && teamIds.length > 0
      ? supabase
          .from("fixture_requests")
          .select("id, created_at, group_id, fixture_request_groups(source)")
          .in("target_team_id", teamIds)
          .eq("status", "sent")
          .then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; created_at: string; group_id: string; fixture_request_groups: { source: string | null } | null }[]),
    may(CLUB_ATTENTION_KEYS.fixtureEdit) && sides
      ? supabase
          .from("fixtures")
          .select("id, kickoff_date, kickoff_amendment_proposed_by_club_id")
          .or(sides)
          .not("kickoff_amendment_proposed_at", "is", null)
          .neq("status", "Cancelled")
          .gte("kickoff_date", todayIso)
          .then((r) => (r.data ?? []).filter((f) => f.kickoff_amendment_proposed_by_club_id !== clubId))
      : Promise.resolve([] as { id: string; kickoff_date: string }[]),
    may(CLUB_ATTENTION_KEYS.resultRecord) && sides
      ? supabase
          .from("fixtures")
          .select("id, kickoff_date, result_status, result_submitted_by_club_id, result_amendment_proposed_by_club_id")
          .or(sides)
          .in("result_status", ["awaiting_confirmation", "amendment_pending", "disputed"])
          .then((r) => resultsWaitingOn(clubId, r.data ?? []))
      : Promise.resolve([] as ReturnType<typeof resultsWaitingOn>),
    may(CLUB_ATTENTION_KEYS.partners)
      ? supabase.from("club_partnerships").select("id, created_at").eq("partner_club_id", clubId).eq("status", "pending").then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; created_at: string }[]),
  ])

  const items: AttentionItem[] = []

  if (joins.length > 0) {
    items.push(
      attentionItem({
        sourceType: "club_join_request",
        sourceId: clubId,
        context: ctx,
        priority: "needs_action",
        title: joins.length === 1 ? "1 person is waiting to join the club" : `${joins.length} people are waiting to join the club`,
        summary: joins
          .slice(0, 3)
          .map((j) => `${j.first_name ?? ""} ${j.surname ?? ""}`.trim())
          .filter(Boolean)
          .join(", ") || null,
        href: "/people",
        createdAt: joins.map((j) => j.created_at).sort()[0] ?? null,
        dueAt: null,
        count: joins.length,
        capability: CLUB_ATTENTION_KEYS.joinRequests,
      })
    )
  }

  if (playerJoins > 0) {
    items.push(
      attentionItem({
        sourceType: "player_join_request",
        sourceId: clubId,
        context: ctx,
        priority: "needs_action",
        title: playerJoins === 1 ? "1 player has asked to join the club" : `${playerJoins} players have asked to join the club`,
        summary: "Decide which side each one joins",
        href: "/club/join-requests",
        createdAt: null,
        dueAt: null,
        count: playerJoins,
        capability: CLUB_ATTENTION_KEYS.playerJoinRequests,
      })
    )
  }

  // A SEASON PLANNER CLUB DAY is one ask, however many fixtures it holds: one item, answered on the club day.
  const clubDays = new Map<string, { count: number; createdAt: string }>()
  for (const r of requests) {
    if (r.fixture_request_groups?.source !== "season_planner") continue
    const day = clubDays.get(r.group_id) ?? { count: 0, createdAt: r.created_at }
    day.count += 1
    if (r.created_at < day.createdAt) day.createdAt = r.created_at
    clubDays.set(r.group_id, day)
  }
  for (const [groupId, day] of clubDays) {
    items.push(
      attentionItem({
        sourceType: "club_day",
        sourceId: groupId,
        context: ctx,
        priority: "needs_action",
        title: "A club has sent you a Club Day request",
        summary: `${day.count} ${day.count === 1 ? "fixture waits" : "fixtures wait"} for your answer`,
        href: `/fixtures/club-day/${groupId}`,
        createdAt: day.createdAt,
        dueAt: null,
        count: day.count,
        capability: CLUB_ATTENTION_KEYS.requestRespond,
      })
    )
  }

  for (const r of requests) {
    if (r.fixture_request_groups?.source === "season_planner") continue
    items.push(
      attentionItem({
        sourceType: "fixture_request",
        sourceId: r.id,
        context: ctx,
        priority: "needs_action",
        title: "A club has asked one of your sides for a fixture",
        summary: "Accept or decline the request",
        href: `/messages/request/${r.id}`,
        createdAt: r.created_at,
        dueAt: null,
        count: 1,
        capability: CLUB_ATTENTION_KEYS.requestRespond,
      })
    )
  }

  for (const f of proposals) {
    items.push(
      attentionItem({
        sourceType: "kickoff_proposal",
        sourceId: f.id,
        context: ctx,
        priority: daysUntil(todayIso, f.kickoff_date) <= 3 ? "urgent" : "needs_action",
        title: "The other club has proposed a new kick-off",
        summary: `Match on ${longDate(f.kickoff_date)}`,
        href: `/fixtures/${f.id}`,
        createdAt: null,
        dueAt: f.kickoff_date,
        count: 1,
        capability: CLUB_ATTENTION_KEYS.fixtureEdit,
      })
    )
  }

  // ---- The organiser's tournament results, and the club's own dispensation stages -----------------
  // Each is read from its record: a contested game leaves the list when the organiser settles it, a
  // dispensation when the stage this club decides has been decided.
  const [contested, dispensations] = await Promise.all([
    may(CLUB_ATTENTION_KEYS.tournamentManage)
      ? supabase
          .from("tournaments")
          .select("id")
          .eq("host_club_id", clubId)
          .then(async ({ data: hosted }) => {
            const ids = (hosted ?? []).map((t) => t.id)
            if (ids.length === 0) return [] as { id: string; game_date: string | null }[]
            const { data } = await supabase.from("tournament_games").select("id, game_date").in("tournament_id", ids).in("result_status", ["disputed", "amendment_pending"])
            return data ?? []
          })
      : Promise.resolve([] as { id: string; game_date: string | null }[]),
    // Asked of the server, not of a capability probe: the officer decides through their own key, a Club
    // Admin through theirs, and neither the person who asked nor the child's family is ever offered it.
    readDispensationsWaiting(supabase as unknown as Parameters<typeof readDispensationsWaiting>[0])
      .then((rows) => rows.filter((w) => w.clubId === clubId))
      .catch(() => [] as DispensationWaiting[]),
  ])

  for (const g of contested) {
    items.push(
      attentionItem({
        sourceType: "tournament_result",
        sourceId: g.id,
        context: ctx,
        priority: "needs_action",
        title: "A contested tournament result needs your decision",
        summary: g.game_date ? `Game on ${longDate(g.game_date)}` : null,
        href: `/tournaments/result/${g.id}`,
        createdAt: null,
        dueAt: g.game_date,
        count: 1,
        capability: CLUB_ATTENTION_KEYS.tournamentManage,
      })
    )
  }

  for (const d of dispensations) {
    items.push(
      attentionItem({
        sourceType: "dispensation",
        sourceId: d.id,
        context: ctx,
        priority: "needs_action",
        title: dispensationWaitingTitle(d),
        summary: dispensationWaitingDetail(d),
        href: `/dispensations/${d.id}`,
        createdAt: d.requestedAt,
        dueAt: null,
        count: 1,
        capability: d.decidesAs === "SAFEGUARDING_OFFICER" ? CLUB_ATTENTION_KEYS.dispensationDecide : CLUB_ATTENTION_KEYS.dispensationApproveClub,
      })
    )
  }

  for (const f of results) {
    items.push(
      attentionItem({
        sourceType: "result_confirmation",
        sourceId: f.fixtureId,
        context: ctx,
        priority: "needs_action",
        title:
          f.state === "disputed"
            ? "A disputed result needs agreement"
            : f.state === "amendment"
              ? "A change to a result needs your answer"
              : "A result is waiting for your confirmation",
        summary: `Match on ${longDate(f.dateIso)}`,
        href: `/fixtures/${f.fixtureId}/result`,
        createdAt: null,
        dueAt: f.dateIso,
        count: 1,
        capability: CLUB_ATTENTION_KEYS.resultRecord,
      })
    )
  }

  if (partners.length > 0) {
    items.push(
      attentionItem({
        sourceType: "partner_request",
        sourceId: clubId,
        context: ctx,
        priority: "needs_action",
        title: partners.length === 1 ? "A club has asked to partner with you" : `${partners.length} clubs have asked to partner with you`,
        summary: "Partner clubs share calendars",
        href: "/clubhouse",
        createdAt: partners.map((p) => p.created_at).sort()[0] ?? null,
        dueAt: null,
        count: partners.length,
        capability: CLUB_ATTENTION_KEYS.partners,
      })
    )
  }

  return items
}

function daysUntil(todayIso: string, dateIso: string): number {
  return Math.round((Date.parse(dateIso) - Date.parse(todayIso)) / 86400000)
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
}
