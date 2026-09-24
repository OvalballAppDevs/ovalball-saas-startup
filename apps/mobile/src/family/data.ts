import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, SessionContext } from "@ovalball/contracts"
import { resolvePlayerAvatarUrls } from "@ovalball/contracts/family/avatars"
import { describeFamily, type FamilyRelationship } from "@ovalball/contracts/family/relationships"
import { resolvePlayerAgeState } from "@ovalball/contracts"

type Client = SupabaseClient<Database>

export interface FamilyRow extends FamilyRelationship {
  avatarUrl: string | null
  /** The child has their own Ovalball login. Null where the row could not be read. */
  hasLogin: boolean | null
}

export interface PendingLinkRequest {
  requestId: string
  kind: string
  status: string
  clubName: string | null
  childLabel: string | null
  awaitingMyAnswer: boolean
  requestedByMe: boolean
}

export interface FamilyScreenData {
  rows: FamilyRow[]
  pending: PendingLinkRequest[]
}

/**
 * THE FAMILY, FOR THE CHILDREN SCREEN (CA-M9). The rows are the session's own proved relationships in
 * plain words; the picture is the canonical child avatar; whether a child has a login is the one fact
 * read from `players` (a guardian may read their own children's rows); the pending requests are the
 * canonical `my_guardian_link_requests`. Nothing else about a relationship is read or shown.
 */
export async function loadFamilyScreen(supabase: Client, ctx: SessionContext): Promise<FamilyScreenData> {
  // EVERY CHILD THIS PERSON LOOKS AFTER, from the canonical relationship rows (RLS: their own), so a
  // child still awaiting a team from the club appears beside the ones already placed. Never the date
  // of birth: the age state is resolved and the date is not read.
  const { data: links } = await supabase.from("guardians").select("player_id").eq("guardian_user_id", ctx.user.id).eq("status", "active")
  const known = new Set(ctx.guardianRelationships.map((g) => g.playerId))
  const unplacedIds = (links ?? []).map((l) => l.player_id).filter((id) => !known.has(id))
  const { data: unplacedRows } = unplacedIds.length
    ? await supabase.from("players").select("id, first_name, surname, avatar_storage_path").in("id", unplacedIds)
    : { data: [] as { id: string; first_name: string; surname: string; avatar_storage_path: string | null }[] }
  const rows = describeFamily(
    ctx,
    (unplacedRows ?? []).map((p) => ({ playerId: p.id, firstName: p.first_name, surname: p.surname, avatarStoragePath: p.avatar_storage_path ?? null, ageState: resolvePlayerAgeState(null, []) }))
  )
  const ids = rows.map((r) => r.playerId)
  const [avatars, players, pending] = await Promise.all([
    resolvePlayerAvatarUrls(supabase, rows.map((r) => r.avatarStoragePath)),
    ids.length ? supabase.from("players").select("id, user_id").in("id", ids) : Promise.resolve({ data: [] as { id: string; user_id: string | null }[] }),
    supabase.rpc("my_guardian_link_requests").then((r) => r.data ?? []),
  ])
  const login = new Map((players.data ?? []).map((p) => [p.id, p.user_id !== null]))
  return {
    rows: rows.map((r) => ({
      ...r,
      avatarUrl: r.avatarStoragePath ? (avatars.get(r.avatarStoragePath) ?? null) : null,
      hasLogin: login.has(r.playerId) ? (login.get(r.playerId) as boolean) : null,
    })),
    pending: pending
      .filter((p) => p.status === "PENDING")
      .map((p) => ({ requestId: p.request_id, kind: p.kind, status: p.status, clubName: p.club_name ?? null, childLabel: p.child_label ?? null, awaitingMyAnswer: p.awaiting_my_answer === true, requestedByMe: p.requested_by_me === true })),
  }
}
