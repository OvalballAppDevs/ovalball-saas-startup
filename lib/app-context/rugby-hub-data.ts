import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { SessionContext } from "./session-context"

/**
 * Rugby Hub real data layer (Rugby Hub Phase 2, Side Project 3 Stages 6/7
 * real integration). Implements the typed provider contracts SP3 designed
 * in isolation (ovalball-rugby-knowledge/lib/rugby-hub/{rugby-hub-context,
 * safeguarding-officer,club-visibility}.ts, audited for shape, never
 * imported) against Main's real session, teams, and the regulatory schema
 * ported in Phase 2's own migrations.
 *
 * The whole SP3-local demo mechanism (scenarios.ts's fixed scenario/
 * audience allowlist, the cookie-based scenario switcher, SP3TestContext
 * Provider) is deliberately NOT ported -- it has no equivalent in
 * production, per SP3's own Integration Manifest ("must be deleted, not
 * adapted"). The one real replacement need it stood in for -- letting a
 * viewer with more than one relevant team choose which one they mean -- is
 * met here by getRugbyHubTeamOptions, which lists the viewer's OWN real
 * teams, never an invented scenario.
 */

export type RugbyCode = "union" | "league"
export type RugbyHubAudience = "PARENT" | "PLAYER" | "COACH" | "TEAM_ADMIN" | "CLUB_ADMIN" | "GENERAL"

/** One real team the current viewer may pick as "whose Rugby Hub am I viewing" -- the only thing the browser ever supplies (an opaque, already-authorized team_id), never a raw rugby_code or identity. */
export interface RugbyHubTeamOption {
  teamId: string
  clubId: string
  teamDisplayName: string
  clubName: string
}

/** Shared by every Rugby Hub page: the cookie-selected team if it's still one of the viewer's real options, else their first real option, else null (no real relationship at all). */
export async function resolveActiveRugbyHubTeamId(supabase: SupabaseClient<Database>, ctx: SessionContext, cookieTeamId: string | undefined): Promise<string | null> {
  const options = await getRugbyHubTeamOptions(supabase, ctx)
  return options.find((t) => t.teamId === cookieTeamId)?.teamId ?? options[0]?.teamId ?? null
}

/**
 * Derives the real RugbyHubAudience for THIS viewer on THIS specific team,
 * from their own real session relationships -- never a client-supplied
 * value. Phase 3's real content import ported genuine PARENT- and
 * PLAYER-audience copy specifically so this mechanism would have real
 * content to exercise; every page previously called the safeguarding/
 * welfare resolvers with a hardcoded "GENERAL" audience, which made that
 * ported copy permanently unreachable (a real gap this Phase 4 audit
 * found via live UAT, fixed here rather than left as dead content).
 *
 * Precedence, most specific relationship first: the viewer's own linked
 * player record on this team (PLAYER) outranks a guardian relationship
 * (PARENT), which outranks team-scoped staff authority (COACH/TEAM_ADMIN),
 * which outranks club-wide authority (CLUB_ADMIN). A person who is both,
 * e.g. a guardian who also coaches the team, sees the PARENT-authored
 * wording -- the family-safety framing is the more relevant one for a
 * safeguarding/welfare page specifically. Falls back to GENERAL when
 * nothing more specific applies (staff roles with no authored COACH/
 * TEAM_ADMIN/CLUB_ADMIN copy already resolve to GENERAL server-side via
 * each resolver's own coalesce(requested, general) fallback).
 */
export function resolveRugbyHubAudience(ctx: SessionContext, team: RugbyHubTeamOption): RugbyHubAudience {
  if (ctx.linkedPlayerTeams.some((p) => p.teamId === team.teamId)) return "PLAYER"
  if (ctx.guardianRelationships.some((g) => g.teamId === team.teamId)) return "PARENT"
  const teamPermission = ctx.teamPermissions.find((t) => t.teamId === team.teamId)?.permission
  if (teamPermission === "team_admin" || teamPermission === "manager") return "TEAM_ADMIN"
  if (teamPermission === "coach") return "COACH"
  // Club-wide authority (a Club Admin reaching this team purely via
  // clubMemberships, with no per-team teamPermissions row of their own --
  // the same real relationship 1d75bec's own fix accounts for elsewhere).
  if (ctx.clubMemberships.some((m) => m.clubId === team.clubId && m.role === "CLUB_ADMIN")) return "CLUB_ADMIN"
  return "GENERAL"
}

/**
 * Every real team the viewer may reasonably mean by "my Rugby Hub":
 * guardian relationships, their own linked player, explicit team-scoped
 * permissions, AND every active team at a club they hold club-wide
 * membership at (a Club Admin's authority comes from clubMemberships, not
 * a per-team row -- missing this branch was a real bug caught live in
 * UAT: a real Club Admin saw "no team relationship" despite genuinely
 * managing the club).
 */
export async function getRugbyHubTeamOptions(supabase: SupabaseClient<Database>, ctx: SessionContext): Promise<RugbyHubTeamOption[]> {
  const seen = new Map<string, RugbyHubTeamOption>()
  for (const g of ctx.guardianRelationships) {
    seen.set(g.teamId, { teamId: g.teamId, clubId: g.clubId, teamDisplayName: g.teamDisplayName, clubName: g.clubName })
  }
  for (const p of ctx.linkedPlayerTeams) {
    seen.set(p.teamId, { teamId: p.teamId, clubId: p.clubId, teamDisplayName: p.teamDisplayName, clubName: p.clubName })
  }
  for (const t of ctx.teamPermissions) {
    if (!seen.has(t.teamId)) seen.set(t.teamId, { teamId: t.teamId, clubId: t.clubId, teamDisplayName: t.teamDisplayName, clubName: t.clubName })
  }

  if (ctx.clubMemberships.length > 0) {
    const { data: clubTeams } = await supabase
      .from("teams")
      .select("id, display_name, club_id")
      .in("club_id", ctx.clubMemberships.map((m) => m.clubId))
      .eq("active", true)
    const clubNameById = new Map(ctx.clubMemberships.map((m) => [m.clubId, m.clubName]))
    for (const t of clubTeams ?? []) {
      if (!seen.has(t.id)) seen.set(t.id, { teamId: t.id, clubId: t.club_id, teamDisplayName: t.display_name, clubName: clubNameById.get(t.club_id) ?? "Club" })
    }
  }

  return Array.from(seen.values())
}

export interface RugbyHubIdentityContext {
  rugbyCode: RugbyCode | null
  regulatoryIdentityId: string | null
  mappingType: "DIRECT" | "DERIVED_COMPOSITE" | "NO_DIRECT_MAPPING" | "REVIEW_REQUIRED" | null
}

export async function getRugbyHubIdentityContext(supabase: SupabaseClient<Database>, teamId: string): Promise<RugbyHubIdentityContext> {
  const { data } = await supabase.rpc("get_rugby_hub_identity_context", { p_team_id: teamId }).maybeSingle()
  return {
    rugbyCode: (data?.rugby_code as RugbyCode) ?? null,
    regulatoryIdentityId: data?.regulatory_identity_id ?? null,
    mappingType: (data?.mapping_type as RugbyHubIdentityContext["mappingType"]) ?? null,
  }
}

export type RulesRow = Database["public"]["Functions"]["get_rugby_hub_rules"]["Returns"][number]
export type SafeguardingContentRow = Database["public"]["Functions"]["get_rugby_hub_safeguarding_content"]["Returns"][number]
export type SafeguardingRouteRow = Database["public"]["Functions"]["get_rugby_hub_safeguarding_routes"]["Returns"][number]
export type WelfareRow = Database["public"]["Functions"]["get_rugby_hub_welfare"]["Returns"][number]

export interface SourceMetadata {
  title: string
  authorityName: string
  canonicalUrl: string
}

/**
 * Every Rugby Hub domain query returns exactly one of these four states --
 * never a bare row array a page has to interpret itself. "empty": the
 * regulatory identity is real and mapped, but no PUBLISHED content exists
 * yet. "no-mapping": the identity itself is NO_DIRECT_MAPPING. "error": the
 * call failed outright. Distinguishing these three (plus real content) is
 * the entire point of this type -- a resolver failure must never render as
 * "no rules apply".
 */
export type DomainResult<TRow> = { status: "content"; rows: TRow[] } | { status: "empty" } | { status: "no-mapping" } | { status: "error" }

/** Age-grade RULES is always identity-scoped -- a NO_DIRECT_MAPPING team has no age-grade rules of play to show, by design, never a guessed one. */
export async function getRulesBundle(supabase: SupabaseClient<Database>, teamId: string, identity: RugbyHubIdentityContext): Promise<DomainResult<RulesRow>> {
  if (identity.mappingType === "NO_DIRECT_MAPPING") return { status: "no-mapping" }
  if (!identity.rugbyCode) return { status: "error" }
  const { data, error } = await supabase.rpc("get_rugby_hub_rules", { p_team_id: teamId })
  if (error) return { status: "error" }
  if (!data || data.length === 0) return { status: "empty" }
  return { status: "content", rows: data }
}

export async function getSafeguardingContent(supabase: SupabaseClient<Database>, teamId: string, audience: RugbyHubAudience): Promise<DomainResult<SafeguardingContentRow>> {
  const { data, error } = await supabase.rpc("get_rugby_hub_safeguarding_content", { p_team_id: teamId, p_audience: audience })
  if (error) return { status: "error" }
  if (!data || data.length === 0) return { status: "empty" }
  return { status: "content", rows: data }
}

export async function getSafeguardingRoutes(supabase: SupabaseClient<Database>, teamId: string): Promise<DomainResult<SafeguardingRouteRow>> {
  const { data, error } = await supabase.rpc("get_rugby_hub_safeguarding_routes", { p_team_id: teamId })
  if (error) return { status: "error" }
  if (!data || data.length === 0) return { status: "empty" }
  return { status: "content", rows: data }
}

export async function getWelfareBundle(supabase: SupabaseClient<Database>, teamId: string, audience: RugbyHubAudience): Promise<DomainResult<WelfareRow>> {
  const { data, error } = await supabase.rpc("get_rugby_hub_welfare", { p_team_id: teamId, p_audience: audience })
  if (error) return { status: "error" }
  if (!data || data.length === 0) return { status: "empty" }
  return { status: "content", rows: data }
}

/** One batched call for every distinct source_key a page needs to cite -- never one call per card. */
export async function getSourceMetadata(supabase: SupabaseClient<Database>, sourceKeys: (string | null)[]): Promise<Map<string, SourceMetadata>> {
  const unique = Array.from(new Set(sourceKeys.filter((key): key is string => !!key)))
  const map = new Map<string, SourceMetadata>()
  if (unique.length === 0) return map
  const { data, error } = await supabase.rpc("resolve_public_source_metadata", { p_source_keys: unique })
  if (error || !data) return map
  for (const row of data) map.set(row.source_key, { title: row.title, authorityName: row.authority_name, canonicalUrl: row.canonical_url })
  return map
}

// ---------------------------------------------------------------------
// Safeguarding Officer projection -- real bridge to public.club_
// safeguarding_officers (Main's own real, already-shipped feature).
// ---------------------------------------------------------------------

export type SafeguardingOfficerRegistrationState = "ACTIVE" | "PENDING" | "INACTIVE"
export type MessageMode = "OVALBALL" | "EMAIL"

export interface SafeguardingOfficerProjection {
  clubId: string
  safeguardingOfficerAssignmentId: string
  officerDisplayName: string
  officerType: "primary" | "deputy"
  registrationState: SafeguardingOfficerRegistrationState
  acceptedOvalballUserId: string | null
  messageMode: MessageMode
  contactEmail: string
}

/**
 * Main's own architecture doc (docs/architecture/safeguarding-officer-
 * model.md) already sketched a flatter contract for this exact seam
 * ("Rugby Hub integration contract for SP3 Stage 7") -- this bridges that
 * to SP3's richer expected shape (officerType/registrationState/assignment
 * id), both genuinely derivable from the same real
 * club_safeguarding_officers row, rather than picking one shape and
 * discarding information the other actually needs.
 */
export async function getSafeguardingOfficerProjections(supabase: SupabaseClient<Database>, clubId: string): Promise<SafeguardingOfficerProjection[]> {
  const { data } = await supabase
    .from("club_safeguarding_officers")
    .select("id, club_id, officer_type, contact_name, contact_email, user_id, status")
    .eq("club_id", clubId)

  return (data ?? []).map((row) => ({
    clubId: row.club_id,
    safeguardingOfficerAssignmentId: row.id,
    officerDisplayName: row.contact_name,
    officerType: row.officer_type as "primary" | "deputy",
    registrationState: row.status === "active" ? "ACTIVE" : row.status === "inactive" ? "INACTIVE" : "PENDING",
    acceptedOvalballUserId: row.status === "active" ? row.user_id : null,
    messageMode: row.status === "active" && row.user_id ? "OVALBALL" : "EMAIL",
    contactEmail: row.contact_email,
  }))
}

/** Primary sorts before deputy; inactive assignments are never presented as an available contact. */
export function contactableOfficers(all: SafeguardingOfficerProjection[]): SafeguardingOfficerProjection[] {
  return all.filter((o) => o.registrationState !== "INACTIVE").sort((a, b) => (a.officerType === b.officerType ? 0 : a.officerType === "primary" ? -1 : 1))
}

// ---------------------------------------------------------------------
// Club visibility -- SP3's own real, already-decided policy (Stage 7):
// every module Ovalball actually ships today is safety-relevant, so every
// one is MANDATORY_PLATFORM_VISIBLE. No club preference table exists in
// Main for this, and none is added here -- there is nothing optional to
// gate yet. The CLUB_CONFIGURABLE mechanism SP3 designed for a genuinely
// optional future module (spec section 14) is not built until a real
// optional module exists to need it.
// ---------------------------------------------------------------------

export type RugbyHubModule = "AGE_GRADE_RULES" | "SAFEGUARDING" | "PLAYER_WELFARE"

export function isModuleVisible(hasPublishedContent: boolean): boolean {
  return hasPublishedContent
}
