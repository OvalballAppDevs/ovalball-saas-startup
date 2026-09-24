import type { ActiveContextKind } from "../active-context-rules"
import type { ParentAttention } from "../parent/home"
import type { FamilySubscription } from "../subscriptions/family"
import { attentionItem, type AttentionItem } from "./model"

/**
 * A FAMILY'S ATTENTION, in the shared shape.
 *
 * Two canonical sources and no more: an availability question the family has not answered
 * (`attendanceAttention`, the rule the website's own count uses) and a membership that needs setting
 * up or has failed (`loadFamilySubscription`, the same GoCardless record the website reads). A
 * guardian link request is a club's job, not a parent's; a fixture request is never a family's;
 * neither appears here -- see the note in `parent/home.ts`.
 */
export function familyAttentionItems(
  attention: ParentAttention[],
  subscriptions: FamilySubscription[],
  context: { kind: ActiveContextKind; clubId: string | null }
): AttentionItem[] {
  const availability = attention.map((row) =>
    attentionItem({
      sourceType: row.item?.kind === "training" ? "training_availability" : "fixture_availability",
      sourceId: row.item?.eventId ?? row.key,
      playerKey: row.playerId,
      context: { kind: context.kind, clubId: context.clubId, teamId: row.item?.teamId ?? null, playerId: row.playerId },
      priority: row.urgent ? "urgent" : "needs_action",
      title: row.label,
      summary: row.detail,
      destination: row.item
        ? row.item.kind === "training"
          ? { kind: "training", sessionId: row.item.eventId }
          : { kind: "fixture", fixtureId: row.item.eventId }
        : { kind: "calendar" },
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
        title: s.attention === "failed" ? `${s.playerName}'s membership payment failed` : `Set up ${s.playerName}'s membership`,
        summary: s.programmeName,
        // Provider-hosted: a mandate is entered on GoCardless's own pages, so this is the web page.
        destination: { kind: "web", href: `/parent/players/${s.playerId}/subscription` },
        createdAt: null,
        dueAt: null,
        count: 1,
        capability: null,
      })
    )

  return [...availability, ...money]
}
