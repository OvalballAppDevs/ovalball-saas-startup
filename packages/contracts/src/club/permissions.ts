import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { EDITOR_KEYS } from "./permission-groups"

/**
 * ROLES & PERMISSIONS -- THE SHARED CONTRACT (CA-M4).
 *
 * The model, in the product's words:
 *
 *   ROLE      = a default bundle of capabilities. Coach, Team Manager, Fixture Secretary, Club Admin.
 *   DECISION  = a scoped exception on top of the role: ALLOW or WITHHOLD one capability at the club or
 *               at one team. It never changes the role, never rewrites the bundle, never reaches
 *               another scope.
 *   INHERIT   = no decision recorded; the role answers.
 *   RESTORE   = remove the decision (revoke_capability_override). Never an opposite decision.
 *
 * The SERVER computes every effective answer (`internal.capability_decision`) and both clients read the
 * same row shape from `club_person_permissions` / `club_member_capabilities` / `club_team_capabilities`,
 * all of which are one computation (`internal.person_capability_rows`). Nothing in this file decides
 * anything: it reads, it writes through the two canonical operations, and it names things.
 */
type Client = SupabaseClient<Database>

export type PermissionScope = { kind: "club" } | { kind: "team"; teamId: string; teamName: string }

export type PermissionSource = "role" | "granted" | "denied" | "restricted" | "none"
export type DecisionEffect = "grant" | "deny"
/** The three states a control shows: no decision (the role answers), allowed explicitly, withheld explicitly. */
export type PermissionState = "inherit" | "allow" | "withhold"

export interface PermissionDecision {
  id: string
  effect: DecisionEffect
  /** "CLUB", "TEAM" or "SITE" (Ovalball). */
  level: string
  reason: string | null
  grantedAt: string
  grantedBy: string | null
  expiresAt: string | null
  /** Derived here from `expiresAt` -- an expired row stays `active` in the table but no longer answers. */
  expired: boolean
}

export interface PermissionRow {
  key: string
  label: string
  description: string
  domain: string
  /** The server's answer now. */
  effective: boolean
  decisiveRule: string | null
  reasonCode: string | null
  source: PermissionSource
  /** What the person's roles supply at this scope, with every decision ignored. */
  roleDefault: boolean
  /** The role that supplies it ("Coach"), when one does. */
  roleDefaultRole: string | null
  decision: PermissionDecision | null
  /** Whether the viewer may decide this row here (server-computed; the write decides again). */
  editable: boolean
}

export interface PermissionScopeOption {
  kind: "club" | "team"
  teamId: string | null
  teamName: string | null
}

function rowFrom(r: Record<string, unknown>): PermissionRow {
  const expiresAt = (r.override_expires_at as string | null) ?? null
  const decision: PermissionDecision | null = r.override_id
    ? {
        id: String(r.override_id),
        effect: r.override_effect === "deny" ? "deny" : "grant",
        level: String(r.override_level ?? ""),
        reason: (r.override_reason as string | null) ?? null,
        grantedAt: String(r.override_granted_at ?? ""),
        grantedBy: (r.override_granted_by as string | null) ?? null,
        expiresAt,
        expired: expiresAt !== null && new Date(expiresAt).getTime() <= Date.now(),
      }
    : null
  return {
    key: String(r.capability_key),
    label: String(r.label ?? r.capability_key),
    description: String(r.description ?? ""),
    domain: String(r.domain ?? ""),
    effective: r.effective === true,
    decisiveRule: (r.decisive_rule as string | null) ?? null,
    reasonCode: (r.reason_code as string | null) ?? null,
    source: (r.source as PermissionSource) ?? "none",
    roleDefault: r.role_default === true,
    roleDefaultRole: (r.role_default_role as string | null) ?? null,
    decision,
    editable: r.editable === true,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The scopes a decision about this person can name: the club, and each team they hold a role on. */
export async function readPersonPermissionScopes(supabase: Client, clubId: string, userId: string): Promise<PermissionScopeOption[]> {
  const { data, error } = await supabase.rpc("club_person_permission_scopes", { p_club_id: clubId, p_user_id: userId })
  if (error) throw error
  return (data ?? []).map((r) => ({ kind: r.scope_type === "team" ? "team" : "club", teamId: r.team_id ?? null, teamName: r.team_display_name ?? null }))
}

/** One person's decidable permissions at one scope -- the audited editor keys only. */
export async function readPersonPermissions(supabase: Client, clubId: string, userId: string, scope: PermissionScope, keys: string[] = EDITOR_KEYS): Promise<PermissionRow[]> {
  const { data, error } = await supabase.rpc("club_person_permissions", {
    p_club_id: clubId,
    p_user_id: userId,
    p_scope_type: scope.kind,
    p_team_id: scope.kind === "team" ? scope.teamId : undefined,
    p_capability_keys: keys,
  })
  if (error) throw error
  return (data ?? []).map((r) => rowFrom(r as unknown as Record<string, unknown>))
}

export interface PermissionGridRow extends PermissionRow {
  userId: string
}

/** Every person at the scope with their rows -- the website's grid. Same computation as the per-person read. */
export async function readPermissionGrid(supabase: Client, clubId: string, teamId: string | null, keys: string[]): Promise<PermissionGridRow[]> {
  const { data, error } = teamId
    ? await supabase.rpc("club_team_capabilities", { p_club_id: clubId, p_team_id: teamId, p_capability_keys: keys })
    : await supabase.rpc("club_member_capabilities", { p_club_id: clubId, p_capability_keys: keys })
  if (error) throw error
  return (data ?? []).map((r) => ({ userId: String((r as { user_id: string }).user_id), ...rowFrom(r as unknown as Record<string, unknown>) }))
}

export interface PermissionCapabilities {
  /** people.capability.manage -- may decide permissions at the club. */
  manage: boolean
  /** people.access.explain -- may see why a person has what they have. */
  explain: boolean
}

export async function readPermissionCapabilities(supabase: Client, clubId: string): Promise<PermissionCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return { manage: false, explain: false }
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { manage: allowed.has("people.capability.manage"), explain: allowed.has("people.access.explain") }
}

export interface AccessHistoryEntry {
  at: string
  eventType: string
  actorName: string
  teamName: string | null
  reason: string | null
  capabilityLabel: string | null
  roleLabel: string | null
}

/** The club's access timeline for one person (`club_access_history`, gated on people.access.explain). */
export async function readAccessHistory(supabase: Client, clubId: string, userId: string, limit = 25): Promise<AccessHistoryEntry[]> {
  const { data, error } = await supabase.rpc("club_access_history", { p_club_id: clubId, p_subject_user_id: userId, p_limit: limit })
  if (error) throw error
  return (data ?? []).map((h) => ({ at: h.at, eventType: h.event_type, actorName: h.actor_name, teamName: h.team_name ?? null, reason: h.reason ?? null, capabilityLabel: h.capability_key ?? null, roleLabel: h.role_key ?? null }))
}

// ---------------------------------------------------------------------------
// Writes -- the two canonical operations, and nothing else
// ---------------------------------------------------------------------------

/**
 * ALLOW or WITHHOLD one capability for one person at one scope. The server decides the authority, the
 * ceiling, the age rule, the Volunteer rule, the team relationship and the recent authenticator.
 */
export async function decidePermission(supabase: Client, input: { userId: string; key: string; clubId: string; scope: PermissionScope; effect: DecisionEffect; reason: string }): Promise<string> {
  const { data, error } = await supabase.rpc("set_capability_override", {
    p_user_id: input.userId,
    p_capability_key: input.key,
    p_scope_type: input.scope.kind,
    p_club_id: input.clubId,
    // A club decision names no team; the server refuses one.
    p_team_id: (input.scope.kind === "team" ? input.scope.teamId : null) as unknown as string,
    p_effect: input.effect,
    p_reason: input.reason.trim() || undefined,
  })
  if (error) throw error
  return String(data)
}

/** RESTORE DEFAULT: remove the decision so the role answers again. Never records an opposite decision. */
export async function restoreDefault(supabase: Client, overrideId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_capability_override", { p_override_id: overrideId, p_reason: reason.trim() || undefined })
  if (error) throw error
}

/** A whole job at once (club scope only). Every capability goes through set_capability_override. */
export async function applyPermissionPreset(supabase: Client, userId: string, presetKey: string, clubId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("apply_capability_preset", { p_user_id: userId, p_preset_key: presetKey, p_club_id: clubId, p_reason: (reason.trim() || null) as unknown as string })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// The reason rule, the recent-authenticator refusal, the words
// ---------------------------------------------------------------------------

/**
 * The server's own rule, stated once: a club or team WITHHOLD needs a reason ("Give a reason for
 * withholding this permission."); an ALLOW and a RESTORE take one when offered. These two operations
 * are deliberately not in REASON_REQUIRED_OPERATIONS, which lists the `internal.require_reason` callers
 * and is assertion-locked to them; the rule here is set_capability_override's own.
 */
export function permissionReasonRule(action: "allow" | "withhold" | "restore"): "required" | "optional" {
  return action === "withhold" ? "required" : "optional"
}

/** The sentence the server raises when a recent authenticator is required (internal.require_recent_aal2). */
export const RECENT_AUTH_SENTENCE = "Enter a code from your authenticator to continue."

export function isRecentAuthRefusal(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string }
  return e.code === "42501" && (e.message ?? "").includes(RECENT_AUTH_SENTENCE)
}

/**
 * What a person reads when a decision is refused. The override operations raise product-language
 * sentences on purpose ("Ovalball has withheld this permission at a higher level…", "You cannot change
 * your own permissions."), so those are shown as they are; anything else falls back to the caller's
 * sentence rather than to a code or a table name.
 */
export function permissionErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (isRecentAuthRefusal(error)) return "Recent verification is required before changing this permission."
  if (e.code === "42501" && /not authorised to see/i.test(e.message ?? "")) return "You do not have access to this person's permissions."
  if (e.code === "42501" && /not authorised to change|not authorized/i.test(e.message ?? "")) return "You no longer have permission to change access for this club."
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}

export function stateOf(row: PermissionRow): PermissionState {
  if (!row.decision || row.decision.expired) return "inherit"
  return row.decision.effect === "grant" ? "allow" : "withhold"
}

/** "Allowed" / "Not allowed" -- the effective answer, never inferred from the decision. */
export function effectiveLabel(row: PermissionRow): string {
  return row.effective ? "Allowed" : "Not allowed"
}

/** What the role supplies: "Allowed by Coach", "Allowed by their role", "Not allowed by any role". */
export function roleDefaultSentence(row: PermissionRow): string {
  if (!row.roleDefault) return "Not allowed by any role they hold"
  return row.roleDefaultRole ? `Allowed by ${row.roleDefaultRole}` : "Allowed by their role"
}

/** The source line under a row: where the effective answer came from. */
export function sourceSentence(row: PermissionRow, scope: PermissionScope): string {
  const at = scope.kind === "team" ? ` for ${scope.teamName}` : ""
  switch (row.source) {
    case "role":
      return row.roleDefaultRole ? `From their ${row.roleDefaultRole} role` : "From their role"
    case "granted":
      return `Allowed explicitly${at}`
    case "denied":
      return `Withheld${at}`
    case "restricted":
      return "Restricted by Ovalball"
    default:
      return row.decision?.expired ? "A decision here has expired; the role answers" : "Not from their role"
  }
}

/** Why a row cannot be decided here, when it cannot. */
export function lockSentence(row: PermissionRow): string | null {
  if (row.editable) return null
  if (row.decision?.level === "SITE") return "Ovalball decided this, so it can only be changed by Ovalball."
  return "You cannot change this permission."
}
