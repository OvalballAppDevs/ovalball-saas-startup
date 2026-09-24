import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * INVITATION PREVIEW -- what a link or a code is allowed to say before anyone accepts it.
 *
 * `preview_invitation` is callable by anybody holding the secret and answers the same thing to an
 * anonymous holder and a signed-in one: the kind, what it opens, who sent it, when it lapses and whether
 * it is still usable. Never the invited email, never a child's name, never an id. A token that matches
 * nothing is an EMPTY result, not an error, so a probe learns nothing from the shape of the answer.
 */

export type InvitationKind =
  | "SITE_ADMIN"
  | "ACCOUNT_SETUP"
  | "CLUB_STAFF"
  | "SAFEGUARDING_OFFICER"
  | "GUARDIAN"
  | "PLAYER_ACCOUNT"
  | "TEAM_JOIN_CODE"
  | "CLUB_REFERRAL"
  | "GOVERNING_BODY_OFFICER"

/** `usable` is the only state that may be accepted. The rest are read back from the record. */
export type InvitationState = "usable" | "expired" | "used" | "revoked" | "redeemed"

export type InvitationPreview = {
  kind: InvitationKind | string
  scopeLabel: string
  inviterLabel: string | null
  expiresAt: string | null
  state: InvitationState
}

/** The verb an invitation carries, in the person's own terms. Shared with the website's landing. */
export const INVITATION_PURPOSE: Record<InvitationKind, string> = {
  CLUB_STAFF: "take on a role at this club",
  GOVERNING_BODY_OFFICER: "help run this organisation",
  GUARDIAN: "set up a parent or guardian account",
  PLAYER_ACCOUNT: "set up a player account",
  TEAM_JOIN_CODE: "join this team",
  SAFEGUARDING_OFFICER: "take on the Safeguarding Officer role",
  SITE_ADMIN: "help administer Ovalball",
  ACCOUNT_SETUP: "set up your Ovalball account",
  CLUB_REFERRAL: "bring your club onto Ovalball",
}

/** The fallback says less rather than something wrong: an unknown kind is still a real invitation. */
export const FALLBACK_PURPOSE = "join them on Ovalball"

export function invitationPurpose(kind: string): string {
  return (INVITATION_PURPOSE as Record<string, string>)[kind] ?? FALLBACK_PURPOSE
}

/** The invitation's secret is never persisted, so it is passed as a value and forgotten. */
export type InvitationSecret = { token?: string | null; code?: string | null }

export function hasInvitationSecret(secret: InvitationSecret | null | undefined): secret is InvitationSecret {
  return Boolean(secret && ((secret.token && secret.token.trim()) || (secret.code && secret.code.trim())))
}

/** A human code is ten characters; whitespace and case are the person's, not the code's. */
export function normaliseInvitationCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase()
}

export function interpretPreview(rows: unknown): InvitationPreview | null {
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row || typeof row !== "object") return null
  const r = row as Record<string, unknown>
  const state = typeof r.state === "string" ? r.state : null
  if (!state) return null
  return {
    kind: typeof r.kind === "string" ? r.kind : "",
    scopeLabel: typeof r.scope_label === "string" && r.scope_label ? r.scope_label : "Ovalball",
    inviterLabel: typeof r.inviter_label === "string" && r.inviter_label ? r.inviter_label : null,
    expiresAt: typeof r.expires_at === "string" ? r.expires_at : null,
    state: (["usable", "expired", "used", "revoked", "redeemed"].includes(state) ? state : "expired") as InvitationState,
  }
}

export async function previewInvitation(supabase: SupabaseClient, secret: InvitationSecret): Promise<InvitationPreview | null> {
  const token = secret.token?.trim() || null
  const code = secret.code ? normaliseInvitationCode(secret.code) : null
  if (!token && !code) return null
  const { data, error } = await supabase.rpc("preview_invitation", { p_token: token, p_code: code })
  if (error) return null
  return interpretPreview(data)
}

/**
 * The words for an invitation that cannot be accepted. One sentence per state, none of which names
 * who was invited. `null` means it can be accepted.
 */
export function unusableInvitationWording(preview: InvitationPreview | null, secret: InvitationSecret): { title: string; body: string } | null {
  const byCode = Boolean(secret.code && !secret.token)
  if (!preview) {
    return {
      title: byCode ? "That code doesn't work" : "This link can't be used",
      body: `It may have been used already, withdrawn, or ${byCode ? "typed incorrectly" : "copied incompletely"}. Ask whoever invited you to send it again.`,
    }
  }
  switch (preview.state) {
    case "usable":
      return null
    case "expired":
      return { title: "This invitation has expired", body: "Ask whoever invited you to send a new one." }
    case "revoked":
      return { title: "This invitation was withdrawn", body: "Whoever sent it has taken it back. Ask them to send a new one if you still need it." }
    case "used":
    case "redeemed":
      return { title: "This invitation has already been used", body: "If that was you, sign in and it will be waiting. Otherwise ask whoever invited you to send a new one." }
  }
}
