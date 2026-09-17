import "server-only"

import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { getSupabaseUrl } from "@/lib/supabase/env"
import type { Database } from "@/types/database.types"

/**
 * CREATE USER (Phase 2 Q.2), step 4 -- and deliberately nothing else.
 *
 * This module is the ONLY place in Create User where the service role is
 * used, and the only thing it does with it is ask Supabase Auth for an
 * identity. It never writes a profile, a membership, a role, a guardian
 * link or a site_admins row. Everything that confers authority happens
 * afterwards in public.site_register_created_identity, under the ordinary
 * capability rules, so the elevated client never decides anything.
 *
 * The split is the whole point. If the service role also made people Club
 * Admins, a bug in the route handler would be an authority bug instead of a
 * failed insert, and the audit trail would record the platform doing it
 * rather than the administrator who asked.
 *
 * There is no password here and no metadata. `email_confirm: false` is
 * deliberate: the person proves they hold the address by following the
 * setup link, which is the same evidence any other route requires. An
 * administrator typing an address is not proof of anything.
 */

export type CreateIdentityResult =
  | { ok: true; userId: string }
  | { ok: false; code: "ALREADY_EXISTS"; existingUserId: string | null }
  | { ok: false; code: "FAILED"; message: string }

function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY. Create User needs it to register the auth identity -- see .env.example.",
    )
  }
  return createSupabaseClient<Database>(getSupabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Normalised the way the database stores it, so "A.Smith@Example.COM " and "a.smith@example.com" are one person. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * ID-6: an address that already belongs to somebody is never quietly turned
 * into a second account. The caller offers Open Existing User instead, which
 * is the only correct answer -- a duplicate identity is the one mistake here
 * that cannot be undone by deleting a row, because the two of them start
 * accumulating separate history immediately.
 */
export async function findIdentityByEmail(email: string): Promise<string | null> {
  const { data, error } = await admin()
    .from("profiles")
    .select("id")
    .eq("email", normaliseEmail(email))
    .maybeSingle()
  if (error) {
    console.error("findIdentityByEmail failed:", error)
    return null
  }
  return data?.id ?? null
}

export async function createAuthIdentity(email: string): Promise<CreateIdentityResult> {
  const normalised = normaliseEmail(email)

  const existing = await findIdentityByEmail(normalised)
  if (existing) return { ok: false, code: "ALREADY_EXISTS", existingUserId: existing }

  const { data, error } = await admin().auth.admin.createUser({
    email: normalised,
    email_confirm: false,
    user_metadata: {},
  })

  if (error || !data?.user) {
    // Supabase reports a duplicate as an ordinary error; it is not one, and
    // the caller has a much better answer for it than "something went wrong".
    if (error?.message?.toLowerCase().includes("already been registered")) {
      return { ok: false, code: "ALREADY_EXISTS", existingUserId: await findIdentityByEmail(normalised) }
    }
    console.error("createAuthIdentity failed:", error)
    return { ok: false, code: "FAILED", message: error?.message ?? "The identity could not be created." }
  }

  return { ok: true, userId: data.user.id }
}

/**
 * Q.2 failure handling: if registering the identity fails after the auth user
 * was created, the half-made account is removed rather than left behind --
 * but only when it has never been used. An account with a session is somebody
 * who has already signed in, and deleting it would be destroying a real
 * person's record to tidy up after a failed form.
 */
export async function deleteUnusedAuthIdentity(userId: string): Promise<void> {
  const client = admin()
  const { data } = await client.auth.admin.getUserById(userId)
  if (!data?.user) return
  if (data.user.last_sign_in_at) {
    console.error("deleteUnusedAuthIdentity refused: the account has been signed into", userId)
    return
  }
  const { error } = await client.auth.admin.deleteUser(userId)
  if (error) console.error("deleteUnusedAuthIdentity failed:", error)
}
