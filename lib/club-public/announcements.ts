import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { priorityLabel } from "@/lib/club-content/vocabulary"
import type { Database } from "@/types/database.types"

/**
 * THE ONE LIVE-ANNOUNCEMENTS QUERY.
 *
 * The club's public homepage and the signed-in club desk on the dashboard both
 * read notices through here, so "what is showing now" has one answer. Like the
 * news layer, it always asks for PUBLISHED notices inside their window
 * explicitly -- an editor's RLS would otherwise hand them their drafts -- and
 * leaves PUBLIC vs MEMBERS to RLS.
 */

export interface ClubAnnouncement {
  id: string
  title: string
  body: string | null
  priority: "NORMAL" | "IMPORTANT" | "URGENT"
  priorityLabel: string
  teamName: string | null
  expiresAt: string | null
  link: { label: string; href: string; external: boolean } | null
  membersOnly: boolean
}

const PRIORITY_RANK = { URGENT: 0, IMPORTANT: 1, NORMAL: 2 } as const

export async function listLiveAnnouncements(supabase: SupabaseClient<Database>, clubId: string, limit = 6): Promise<ClubAnnouncement[]> {
  const nowIso = new Date().toISOString()
  const { data } = await supabase
    .from("club_announcements")
    .select("id, title, body, priority, visibility, expires_at, link_label, link_url, teams(display_name)")
    .eq("club_id", clubId)
    .eq("status", "PUBLISHED")
    .lte("starts_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("starts_at", { ascending: false })
    .limit(limit)

  return (data ?? [])
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      priority: a.priority as ClubAnnouncement["priority"],
      priorityLabel: priorityLabel(a.priority),
      teamName: a.teams?.display_name ?? null,
      expiresAt: a.expires_at,
      link: a.link_label && a.link_url ? { label: a.link_label, href: a.link_url, external: /^https:\/\//.test(a.link_url) } : null,
      membersOnly: a.visibility === "MEMBERS",
    }))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
}
