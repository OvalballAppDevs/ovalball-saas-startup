import type { ActiveContextKind } from "../active-context-rules"
import type { ParentAttention } from "../parent/home"
import type { FamilySubscription } from "../subscriptions/family"
import type { FamilyTeamRequest } from "../team/team-code"
import { matchCentreHref } from "../match-centre/sections"
import { attentionItem, type AttentionItem } from "./model"

/**
 * A FAMILY'S ATTENTION, in the shared shape.
 *
 * Three canonical sources and no more: an availability question the family has not answered
 * (`attendanceAttention`, the rule the website's own count uses), a membership that needs setting
 * up or has failed (`loadFamilySubscription`, the same GoCardless record the website reads), and a
 * child's own request for a team place that waits for this parent (`family_team_requests`,
 * 20270741000000). A guardian link request is a club's job, not a parent's; a fixture request is
 * never a family's; neither appears here -- see the note in `parent/home.ts`.
 */
export function familyAttentionItems(
  attention: ParentAttention[],
  subscriptions: FamilySubscription[],
  context: { kind: ActiveContextKind; clubId: string | null },
  teamRequests: FamilyTeamRequest[] = []
): AttentionItem[] {
  const availability = attention.map((row) =>
    attentionItem({
      sourceType:
        row.item?.kind === "training"
          ? "training_availability"
          : row.item?.kind === "tournament"
            ? "tournament_availability"
            : "fixture_availability",
      sourceId: row.item?.eventId ?? row.key,
      playerKey: row.playerId,
      context: { kind: context.kind, clubId: context.clubId, teamId: row.item?.teamId ?? null, playerId: row.playerId },
      priority: row.urgent ? "urgent" : "needs_action",
      title: row.label,
      summary: row.detail,
      href: row.item
        ? row.item.kind === "training"
          ? `/training/${row.item.eventId}`
          : row.item.kind === "tournament"
            ? `/tournaments/${row.item.eventId}`
            : // The question is about attendance, so it opens the Match Centre's Attendance section.
              matchCentreHref(row.item.eventId, "attendance")
        : "/calendar",
      createdAt: null,
      dueAt: row.item?.date ?? null,
      count: 1,
      capability: "matchcentre.attendance.respond",
    })
  )

  const money = subscriptions
    .filter((s) => s.attention !== "none")
    .map((s) =>
      attentionItem({
        sourceType: "family_subscription",
        sourceId: s.playerId,
        context: { kind: context.kind, clubId: s.clubId, teamId: null, playerId: s.playerId },
        // A failed collection is money the club is missing; setting up is the family's job to start.
        priority: s.attention === "failed" ? "urgent" : "needs_action",
        title:
          s.attention === "failed"
            ? `${s.playerName}'s membership payment failed`
            : s.attention === "start_required"
              ? `Start ${s.playerName}'s membership`
              : `Set up ${s.playerName}'s membership`,
        summary: s.programmeName,
        // Provider-hosted: a mandate is entered on GoCardless's own pages, so this is the web page.
        href: `/parent/players/${s.playerId}/subscription`,
        createdAt: null,
        dueAt: null,
        count: 1,
        capability: null,
      })
    )

  const requests = teamRequests.map((r) =>
    attentionItem({
      sourceType: "team_place_confirmation",
      sourceId: r.membershipId,
      context: { kind: context.kind, clubId: r.clubId, teamId: r.teamId, playerId: r.playerId },
      priority: "needs_action",
      title: `Confirm ${r.firstName}'s request`,
      summary: r.clubName ? `${r.teamLabel} at ${r.clubName}` : r.teamLabel,
      href: teamRequestHref(r.membershipId),
      createdAt: r.requestedAt,
      dueAt: null,
      count: 1,
      capability: null,
    })
  )

  return [...requests, ...availability, ...money]
}

/** Where a parent answers their child's own team request -- one address for both clients. */
export function teamRequestHref(membershipId: string): string {
  return `/parent/team-requests?request=${encodeURIComponent(membershipId)}`
}
