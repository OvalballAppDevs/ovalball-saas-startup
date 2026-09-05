import { CLUB_ROLE_LABEL, teamPermissionLabel } from "@/lib/permissions/role-labels"

import type { SessionContext } from "./session-context"

/**
 * The active-context resolution rules -- deliberately its own tiny,
 * dependency-free module (no "server-only", no cookies(), no Supabase
 * client), mirroring the established site-admin-context-rule.ts pattern,
 * so this has permanent, standalone-runnable regression coverage
 * (active-context.verify.ts) independent of the server-boundary wrapper
 * (active-context.ts) that re-exports it.
 */

/**
 * "parent" was added alongside the other three -- a view_only team
 * permission previously had NO context kind at all (listSwitchableContexts
 * unconditionally skipped it, with this exact file's own prior comment
 * claiming "a Parent/Player has nothing to switch INTO, they only ever
 * view"). That was structural, not just untested: no account, however many
 * OTHER roles it held, could ever see a "Parent View" in the switcher,
 * because ActiveContextKind itself had no fourth value to represent one.
 * "parent" is presentation/default-scope only, exactly like "club"/"team"/
 * "site_admin" already are -- selecting it changes navigation, framing,
 * and which team's read-only data a page defaults to, never what any
 * server-side permission check actually allows (RLS and every capability
 * check remain the real, unaffected authorization boundary).
 */
export type ActiveContextKind = "site_admin" | "club" | "team" | "parent" | "player"

export interface SwitchableContext {
  /**
   * Stable identity for the cookie and the switcher UI -- "site_admin" |
   * "club:<id>" | "team:<id>" | "parent:<id>" | "parent:<playerId>:<teamId>"
   * | "player:<id>". A guardian-relationship-sourced "parent" context is
   * keyed by BOTH playerId and teamId (Side Project 1 integration,
   * Section 17): a Guardian with two children on the SAME team must get
   * two distinct switchable contexts, never one that silently collapses
   * onto whichever child's relationship happened to be read last. The
   * legacy team_permissions.view_only fallback path (no Guardian
   * relationship, Section 40/41 compatibility) has no player to key on and
   * keeps its original 2-part "parent:<teamId>" shape -- the two paths
   * never coexist for the same team (see the guardianTeamIds dedupe below),
   * so there is no collision between them.
   */
  key: string
  kind: ActiveContextKind
  id: string | null
  /** The specific child (Guardian-sourced "parent" context) or this user's own linked player ("player" context) this context represents. Null for "club"/"team"/"site_admin", and for a legacy view_only-sourced "parent" context with no Guardian relationship to derive a player from. Presentation/default-scope only, exactly like every other field here -- never an authorization input. */
  playerId: string | null
  /** "What is being viewed" -- the club or team display name, reused as-is by dashboard-data.ts/build-nav-items.ts as the page header and nav club name. Deliberately NEVER includes the child's name (unlike switcherLabel below): those consumers expect a plain club/team name, and two children on the same team correctly share this same label -- the key, not the label, is what keeps them switchable as distinct contexts. */
  label: string
  /** The text the context switcher's OWN dropdown list renders (Side Project 1 integration, Section 17) -- identical to `label` for every kind except a guardian-relationship-sourced "parent" context, where it's "<child's first name> — <team>" so two children on the same team read as two distinct rows instead of an unlabelled duplicate. Only the switcher list itself reads this; every other consumer (headers, nav) uses `label`. */
  switcherLabel: string
  roleLabel: string
  logoUrl: string | null
  /** The owning club, resolved once at push time from whichever source produced this context (club membership, team_permissions, guardianRelationships, or linkedPlayerTeams) -- never re-derived by looking a team back up in team_permissions, which doesn't exist for a Guardian/Player-sourced context. null only for "site_admin" (no ambient club) or the empty fallback context. */
  clubId: string | null
}

export const ACTIVE_CONTEXT_COOKIE = "ovalball_ctx"

/**
 * Every context this session may deliberately "operate as" or "view as" --
 * club-wide authority (Club Admin/Fixture Secretary), each team-scoped
 * assignment with real operational permission, each canonical Guardian
 * relationship as its own "parent" context, each canonical linked-Player
 * team membership as its own "player" context, and Site Admin. A plain
 * BASIC_USER club membership isn't listed: there is no "operate as" mode
 * for it, only ambient access.
 *
 * Guardian/Player relationships (Relationship Registry §11/§19/§20) are
 * the CANONICAL source for "parent"/"player" contexts going forward. A
 * legacy team_permissions.view_only row that has NOT been linked to a
 * Guardian relationship for the same team is kept as a compatibility
 * fallback (Master Pass §40/§41: existing playground data is never
 * silently discarded or guessed at) -- but the moment a real Guardian
 * relationship exists for a (user, team) pair, that richer, provably-
 * correct source is used instead and the legacy row for the SAME team is
 * not duplicated into a second "parent" context.
 */
export function listSwitchableContexts(ctx: SessionContext): SwitchableContext[] {
  const out: SwitchableContext[] = []
  for (const m of ctx.clubMemberships) {
    if (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY") {
      out.push({
        key: `club:${m.clubId}`,
        kind: "club",
        id: m.clubId,
        playerId: null,
        label: m.clubName,
        switcherLabel: m.clubName,
        roleLabel: CLUB_ROLE_LABEL[m.role],
        logoUrl: m.clubLogoUrl,
        clubId: m.clubId,
      })
    }
  }
  for (const tp of ctx.teamPermissions) {
    if (tp.permission === "view_only") continue // handled below, guardian-first with legacy fallback
    out.push({
      key: `team:${tp.teamId}`,
      kind: "team",
      id: tp.teamId,
      playerId: null,
      label: tp.teamDisplayName,
      switcherLabel: tp.teamDisplayName,
      roleLabel: teamPermissionLabel(tp.permission),
      logoUrl: null,
      clubId: tp.clubId,
    })
  }

  const guardianTeamIds = new Set(ctx.guardianRelationships.map((g) => g.teamId))
  for (const g of ctx.guardianRelationships) {
    out.push({
      // Side Project 1 integration: playerId included so two children on
      // the SAME team resolve to two distinct, independently-switchable
      // contexts rather than colliding on one key. `label` stays the
      // plain team name (every header/nav consumer expects that); only
      // switcherLabel names the specific child, so the dropdown list
      // itself can tell two same-team children apart.
      key: `parent:${g.playerId}:${g.teamId}`,
      kind: "parent",
      id: g.teamId,
      playerId: g.playerId,
      label: g.teamDisplayName,
      switcherLabel: `${g.playerFirstName} — ${g.teamDisplayName}`,
      roleLabel: "Parent/Guardian",
      logoUrl: null,
      clubId: g.clubId,
    })
  }
  for (const tp of ctx.teamPermissions) {
    if (tp.permission !== "view_only") continue
    if (guardianTeamIds.has(tp.teamId)) continue // superseded by the canonical Guardian relationship for the same team
    out.push({
      key: `parent:${tp.teamId}`,
      kind: "parent",
      id: tp.teamId,
      playerId: null,
      label: tp.teamDisplayName,
      switcherLabel: tp.teamDisplayName,
      roleLabel: teamPermissionLabel(tp.permission),
      logoUrl: null,
      clubId: tp.clubId,
    })
  }

  for (const pt of ctx.linkedPlayerTeams) {
    out.push({
      key: `player:${pt.teamId}`,
      kind: "player",
      id: pt.teamId,
      playerId: pt.playerId,
      label: pt.teamDisplayName,
      switcherLabel: pt.teamDisplayName,
      roleLabel: "Player",
      logoUrl: null,
      clubId: pt.clubId,
    })
  }

  if (ctx.isSiteAdmin) {
    out.push({ key: "site_admin", kind: "site_admin", id: null, playerId: null, label: "Ovalball", switcherLabel: "Ovalball", roleLabel: "Site Admin", logoUrl: null, clubId: null })
  }
  return out
}

const FALLBACK_CONTEXT: SwitchableContext = { key: "none", kind: "club", id: null, playerId: null, label: "Ovalball", switcherLabel: "Ovalball", roleLabel: "Member", logoUrl: null, clubId: null }

/**
 * The cookie is a per-viewer UI preference, never an authorization input --
 * an invalid, stale, or tampered value here can only pick which of the
 * session's OWN real contexts is highlighted; it can never grant one that
 * getSessionContext (the real, server-derived source of truth) didn't
 * already return. Default (no cookie, or a stale one naming a context this
 * session no longer has): club-wide authority first, then team, then
 * Site Admin -- deliberately never defaulting straight to Site Admin even
 * when available, so the broader admin view is always an explicit choice.
 */
export function resolveActiveContext(ctx: SessionContext, cookieKey: string | null): SwitchableContext {
  const available = listSwitchableContexts(ctx)
  if (available.length === 0) return FALLBACK_CONTEXT
  if (cookieKey) {
    const found = available.find((c) => c.key === cookieKey)
    if (found) return found
  }
  return available.find((c) => c.kind === "club") ?? available.find((c) => c.kind === "team") ?? available[0]
}

/**
 * The one club id a page should treat as "my club" -- the active
 * context's own club for a club context, the owning club of the active
 * context's team for a team context, or null for Site Admin (no ambient
 * club scope) or a session with nothing switchable at all. This is a UI
 * default only, exactly like the context it reads: it never widens or
 * narrows what any RLS policy or RPC actually authorizes, it only picks
 * WHICH of the session's real club/team authorities a page defaults to
 * acting on behalf of. Replaces the old `manageableClubId(ctx)` /
 * `clubMemberships[0]` pattern, which always resolved to the session's
 * FIRST club regardless of which context the person had actually
 * switched to.
 */
export function activeClubId(ctx: SessionContext, activeContext: SwitchableContext): string | null {
  // Simply the club resolved once at push time in listSwitchableContexts --
  // never re-derived by looking a team back up in team_permissions, which
  // has no row at all for a Guardian- or linked-Player-sourced "parent"/
  // "player" context (they're independent relationships, not team
  // permissions). `ctx` is accepted for signature stability even though
  // it's no longer read here.
  void ctx
  return activeContext.clubId
}

/**
 * Like activeClubId, but only for call sites that use the result to
 * authorize a club-wide write (document upload, partner-club actions,
 * etc.) -- replaces the old `manageableClubId(ctx)` pattern, which always
 * granted-by-selection the session's FIRST club-wide-authority club
 * regardless of which one the person had actually switched to. Returns
 * null unless the ACTIVE CONTEXT ITSELF is a "club" context AND the
 * session genuinely holds CLUB_ADMIN/FIXTURE_SECRETARY at the resolved
 * club. The `kind === "club"` check matters even when the resolved club id
 * is correct: a multi-role account viewing this exact club through its
 * "parent" (view_only) or "team" context must NOT regain club-wide write
 * authority just because a club_memberships row with CLUB_ADMIN happens to
 * also exist for the same club under a DIFFERENT context -- Parent View
 * leaking a "Request a fixture" button was exactly this bug, found live
 * (test.burnley.admin, who also holds Club Admin at Burnley, saw a write
 * button on /fixtures while switched into their Burnley U12 Parent View).
 * This is still only a UI-layer convenience (the real boundary stays
 * whatever RLS/RPC check the write itself performs), but it means the app
 * never offers a write "as" a club the CURRENTLY ACTIVE context doesn't
 * itself represent.
 */
export function activeManageableClubId(ctx: SessionContext, activeContext: SwitchableContext): string | null {
  if (activeContext.kind !== "club") return null
  const clubId = activeClubId(ctx, activeContext)
  if (!clubId) return null
  const hasAuthority = ctx.clubMemberships.some((m) => m.clubId === clubId && (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY"))
  return hasAuthority ? clubId : null
}
