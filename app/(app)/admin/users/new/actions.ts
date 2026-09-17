"use server"

import { revalidatePath } from "next/cache"

import { createAuthIdentity, deleteUnusedAuthIdentity, normaliseEmail } from "@/lib/admin/create-identity"
import { requireSiteCapability } from "@/lib/auth/require-capability"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"

const MIN_REASON = 10

export interface IntendedAssignment {
  kind: "CLUB_MEMBERSHIP" | "CLUB_ROLE" | "TEAM_ROLE" | "GUARDIAN_LINK"
  clubId?: string
  teamId?: string
  playerId?: string
  roleKey?: string
  relationshipType?: string
}

export type CreateUserResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; existingUserId?: string }

/**
 * CREATE USER (Phase 2 Q.2).
 *
 * The ordering matters and is the reason this reads the way it does:
 *
 *   1. the capability check here refuses early and says something useful;
 *   2. the service role creates the auth identity and NOTHING else;
 *   3. site_register_created_identity does everything that confers
 *      authority, re-checking site.users.create itself -- step 1 is a
 *      courtesy, step 3 is the boundary;
 *   4. if step 3 fails, the auth identity from step 2 is removed, but only
 *      if nobody has ever signed into it.
 *
 * The setup link is emailed and never returned here. There is deliberately
 * no Copy Setup Link: the whole point of the link is that it proves the
 * person holds the address, and a link the administrator can read is a link
 * the administrator can use.
 */
export async function createUser(input: {
  email: string
  firstName: string
  surname: string
  dateOfBirth?: string | null
  reason: string
  intended?: IntendedAssignment[]
}): Promise<CreateUserResult> {
  const supabase = await createClient()

  const allowed = await requireSiteCapability(supabase, "site.users.create")
  if (!allowed.ok) return { ok: false, error: allowed.error }

  const email = normaliseEmail(input.email ?? "")
  if (!email.includes("@")) return { ok: false, error: "That does not look like an email address." }
  if (!input.firstName?.trim() || !input.surname?.trim()) {
    return { ok: false, error: "A person needs a first name and a surname." }
  }
  if ((input.reason ?? "").trim().length < MIN_REASON) {
    return { ok: false, error: `Give a fuller reason — at least ${MIN_REASON} characters, so the record makes sense later.` }
  }

  const created = await createAuthIdentity(email)
  if (!created.ok) {
    if (created.code === "ALREADY_EXISTS") {
      return {
        ok: false,
        error: "Somebody already uses that email address on Ovalball.",
        existingUserId: created.existingUserId ?? undefined,
      }
    }
    return { ok: false, error: toPublicSubmissionError() }
  }

  const { error } = await supabase.rpc("site_register_created_identity", {
    p_user_id: created.userId,
    p_first_name: input.firstName.trim(),
    p_surname: input.surname.trim(),
    // Omitted rather than nulled: the RPC defaults it, and a date of birth
    // is genuinely optional at creation -- it is required before the person
    // can hold authority, which D-S5-1 enforces where it belongs.
    ...(input.dateOfBirth ? { p_dob: input.dateOfBirth } : {}),
    p_reason: input.reason.trim(),
    p_intended: (input.intended ?? []).map((a) => ({
      kind: a.kind,
      club_id: a.clubId ?? null,
      team_id: a.teamId ?? null,
      player_id: a.playerId ?? null,
      role_key: a.roleKey ?? null,
      relationship_type: a.relationshipType ?? null,
    })),
  })

  if (error) {
    console.error("site_register_created_identity failed:", error)
    // Q.2 failure handling. The account exists in Supabase Auth but has no
    // profile worth keeping and nobody has used it, so it goes rather than
    // sitting in the list as a person who never was.
    await deleteUnusedAuthIdentity(created.userId)
    if (error.code === "42501" || error.code === "22023" || error.code === "23505") {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: toPublicSubmissionError() }
  }

  revalidatePath("/admin/users")
  return { ok: true, userId: created.userId }
}

/** Rotates the setup invitation for somebody who never finished setting up. */
export async function resendAccountSetup(userId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const allowed = await requireSiteCapability(supabase, "site.invitations.manage")
  if (!allowed.ok) return { ok: false, error: allowed.error }
  if (reason.trim().length < MIN_REASON) {
    return { ok: false, error: `Give a fuller reason — at least ${MIN_REASON} characters, so the record makes sense later.` }
  }

  const { error } = await supabase.rpc("site_resend_account_setup", { p_user_id: userId, p_reason: reason.trim() })
  if (error) {
    console.error("site_resend_account_setup failed:", error)
    if (error.code === "42501" || error.code === "22023" || error.code === "23514") {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/users/${userId}`)
  return { ok: true }
}
