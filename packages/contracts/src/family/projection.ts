import type { SupabaseClient } from "@supabase/supabase-js"

import type { SwitchableContext } from "../active-context-rules"
import { resolveFamilyScope, type FamilyChild } from "../agenda/family-scope"
import type { Database } from "../database"
import type { SessionContext } from "../session-context"
import { resolvePlayerAvatarUrls } from "./avatars"

/**
 * ONE ANSWER TO "WHO ARE MY CHILDREN, AND HOW IS EACH OF THEM SHOWN".
 *
 * WHAT THIS IS. A PRESENTATION projection over canonical family scope. It adds
 * nothing to what `resolveFamilyScope` already proved -- the same children, the
 * same teams -- and resolves the one thing a screen cannot do for itself: a
 * child's photograph, which lives in a private bucket and needs a signed URL.
 *
 * WHAT THIS IS NOT, and the distinction matters more than the code. It is not an
 * authority layer. Every read behind every surface that consumes it is still
 * decided by RLS and by `internal.can`; this only decides how a child is DRAWN.
 * If it were ever asked "may I do X for this child", the answer would be coming
 * from the wrong place.
 *
 * WHY IT EXISTS AT ALL. Five mobile surfaces -- Home, Fixtures, Calendar, Match
 * Centre, Training Centre -- each need the same four facts about a child: the
 * canonical id, the name to print, the picture to draw, and the side they play
 * for. Each resolving them separately is how one screen shows "Pippa", the next
 * "Pippa Krzysik", and a third an initials disc because it never asked for the
 * photograph.
 *
 * THE CHILDREN COME FROM `resolveFamilyScope` AND NOWHERE ELSE. Never from a
 * shared club, a surname, a team membership alone, a fixture, a cached id or a
 * deep link. A client-supplied player id can only ever be CHECKED against this
 * list, never used to fetch.
 */

export interface FamilyMember {
  /** The canonical `players.id`. The only id any surface should carry. */
  playerId: string
  firstName: string
  fullName: string
  /**
   * WHAT A CHIP SAYS. The first name where it is unambiguous within this family,
   * and the full name where two children share one -- because "Harry · Harry" is
   * not a filter.
   */
  shortLabel: string
  teamId: string
  teamName: string
  clubId: string
  clubName: string
  /**
   * THE CHILD'S OWN PICTURE, signed, or null.
   *
   * Null is the norm and is a first-class rendering: youth participation never
   * requires a photograph, and initials are the honest answer rather than a
   * degraded one. Never the guardian's picture, and never a crest.
   */
  avatarUrl: string | null
  initials: string
}

export interface FamilyProjection {
  members: FamilyMember[]
  /** True when a child filter is worth drawing at all. One child needs no chooser. */
  hasChoice: boolean
}

export const EMPTY_FAMILY: FamilyProjection = { members: [], hasChoice: false }

/**
 * Build the projection for whichever context is selected.
 *
 * ONE ROUND TRIP FOR THE PICTURES, whatever the family size -- a guardian of
 * three should not cost three storage calls, and a guardian of none costs
 * nothing at all.
 */
export async function loadFamilyProjection(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  activeContext: SwitchableContext
): Promise<FamilyProjection> {
  return projectFamily(resolveFamilyScope(ctx, activeContext), await resolveAvatars(supabase, ctx, activeContext))
}

async function resolveAvatars(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  activeContext: SwitchableContext
): Promise<Map<string, string>> {
  const children = resolveFamilyScope(ctx, activeContext)
  if (children.length === 0) return new Map()
  return resolvePlayerAvatarUrls(
    supabase,
    children.map((c) => c.avatarStoragePath)
  )
}

/**
 * The pure half, so the projection's rules can be tested without a database.
 *
 * Exported because the shape decisions below -- which name a chip carries, when
 * a chooser is worth drawing -- are product rules rather than plumbing, and a
 * rule that needs a Supabase client to assert is a rule nobody asserts.
 */
export function projectFamily(children: FamilyChild[], avatarUrls: Map<string, string>): FamilyProjection {
  if (children.length === 0) return EMPTY_FAMILY

  const members = children.map((child) => ({
    playerId: child.playerId,
    firstName: child.firstName,
    fullName: child.fullName,
    shortLabel: shortLabelFor(child, children),
    teamId: child.teamId,
    teamName: child.teamName,
    clubId: child.clubId,
    clubName: child.clubName,
    avatarUrl: child.avatarStoragePath ? (avatarUrls.get(child.avatarStoragePath) ?? null) : null,
    initials: initialsFor(child),
  }))

  /*
    ONE CHILD IS NOT A CHOICE. A filter between one thing and itself is a control
    that cannot do anything, and the rule is explicit: do not clutter a
    single-child parent's screen with a selector.

    DISTINCT CHILDREN, not rows. A child on two teams is two `FamilyChild`
    entries and still one child -- offering "Pippa · Pippa" would be offering a
    team selector wearing a child's name, which is the exact thing this must not
    become.
  */
  const distinct = new Set(members.map((m) => m.playerId))
  return { members, hasChoice: distinct.size > 1 }
}

/**
 * IS THIS ID ONE OF MINE?
 *
 * The one thing a client-supplied player id may be used for. A restored
 * selection, a deep link or a tampered request is checked against the resolved
 * family -- never fetched, and never shown as a selected chip naming somebody
 * this person does not hold.
 */
export function isInScope(projection: FamilyProjection, playerId: string | null | undefined): boolean {
  if (!playerId) return false
  return projection.members.some((m) => m.playerId === playerId)
}

/**
 * The selection a surface should actually use, given what it was handed.
 *
 * Returns null -- meaning ALL CHILDREN -- for anything out of scope. Silently
 * normalising rather than erroring is deliberate: a parent returning to the app
 * after a child's place ended should see their family, not a failure about an id
 * they never typed.
 */
export function normaliseSelection(projection: FamilyProjection, playerId: string | null | undefined): string | null {
  return isInScope(projection, playerId) ? (playerId as string) : null
}

/** The member a selection names, or null for "all children". */
export function selectedMember(projection: FamilyProjection, playerId: string | null): FamilyMember | null {
  if (!playerId) return null
  return projection.members.find((m) => m.playerId === playerId) ?? null
}

/** Every team the selected child -- or the whole family -- plays for. What a narrowing surface filters on. */
export function teamIdsForSelection(projection: FamilyProjection, playerId: string | null): string[] {
  const relevant = playerId ? projection.members.filter((m) => m.playerId === playerId) : projection.members
  return Array.from(new Set(relevant.map((m) => m.teamId)))
}

/**
 * First name where it is unambiguous in THIS family, full name where it is not.
 *
 * Siblings sharing a first name is uncommon and entirely real -- blended
 * families, a child named after a parent. A chip row reading "Harry · Harry" is
 * worse than a long one.
 */
function shortLabelFor(child: FamilyChild, all: FamilyChild[]): string {
  const clash = all.some(
    (other) => other.playerId !== child.playerId && other.firstName.toLowerCase() === child.firstName.toLowerCase()
  )
  return clash ? child.fullName : child.firstName
}

function initialsFor(child: FamilyChild): string {
  return `${child.firstName[0] ?? ""}${child.surname[0] ?? ""}`.toUpperCase() || "?"
}
