import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { attentionItem, type AttentionItem } from "./model"

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
 * anything safeguarding -- guardian link approvals and dispensations stay on the website's own
 * surfaces (docs/mobile/CA_M8_NOTIFICATIONS_ACTION_CENTRE_MAP.md records each).
 */
export const CLUB_ATTENTION_KEYS = {
  joinRequests: "people.member.view",
  playerJoinRequests: "club.roster.manage",
  requestRespond: "fixture.request.respond",
  fixtureEdit: "fixture.fixture.edit",
  resultRecord: "fixture.result.record",
  partners: "club.partners.manage",
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
      ? supabase.from("fixture_requests").select("id, created_at").in("target_team_id", teamIds).eq("status", "sent").then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; created_at: string }[]),
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
          .select("id, kickoff_date, result_submitted_by_club_id")
          .or(sides)
          .eq("result_status", "awaiting_confirmation")
          .then((r) => (r.data ?? []).filter((f) => f.result_submitted_by_club_id !== clubId))
      : Promise.resolve([] as { id: string; kickoff_date: string }[]),
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
        destination: { kind: "web", href: "/people" },
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
        destination: { kind: "web", href: "/club/join-requests" },
        createdAt: null,
        dueAt: null,
        count: playerJoins,
        capability: CLUB_ATTENTION_KEYS.playerJoinRequests,
      })
    )
  }

  for (const r of requests) {
    items.push(
      attentionItem({
        sourceType: "fixture_request",
        sourceId: r.id,
        context: ctx,
        priority: "needs_action",
        title: "A club has asked one of your sides for a fixture",
        summary: "Accept or decline the request",
        destination: { kind: "conversation", conversationKind: "request", conversationId: r.id },
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
        destination: { kind: "fixture", fixtureId: f.id },
        createdAt: null,
        dueAt: f.kickoff_date,
        count: 1,
        capability: CLUB_ATTENTION_KEYS.fixtureEdit,
      })
    )
  }

  for (const f of results) {
    items.push(
      attentionItem({
        sourceType: "result_confirmation",
        sourceId: f.id,
        context: ctx,
        priority: "needs_action",
        title: "A result is waiting for your confirmation",
        summary: `Match on ${longDate(f.kickoff_date)}`,
        destination: { kind: "fixture", fixtureId: f.id },
        createdAt: null,
        dueAt: f.kickoff_date,
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
        destination: { kind: "web", href: "/partner-clubs" },
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
