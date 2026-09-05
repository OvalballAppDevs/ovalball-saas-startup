"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"

export type CreateMinimalProfileResult = { ok: true } | { ok: false; error: string }

/**
 * A Site Admin invitation grants global platform access with no club
 * involved at all -- the ordinary signup wizard (which always collects a
 * club) isn't a fit, but the invitee is still a real person and still needs
 * a personal profiles row, not a fake club membership just to get one. This
 * is the minimum viable identity (first + last name, both NOT NULL on
 * profiles) collected on the invite page itself, before acceptance; every
 * other personal-profile field (address, DOB, phone, avatar) stays exactly
 * where it already lives, /account, filled in later at the person's own
 * pace.
 *
 * Deliberately its own insert, not a parameter on accept_site_admin_invitation
 * -- profile identity and site-admin authorization are separate concerns
 * (see the RPC's own design), and this runs under the same
 * profiles_insert_self RLS as every other profile creation path.
 */
export async function createMinimalProfile(firstName: string, surname: string): Promise<CreateMinimalProfileResult> {
  const trimmedFirst = firstName.trim()
  const trimmedSurname = surname.trim()
  if (!trimmedFirst || !trimmedSurname) {
    return { ok: false, error: "Enter your first and last name." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: "You must be signed in." }
  }

  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    first_name: trimmedFirst,
    surname: trimmedSurname,
  })

  if (error) {
    // A profile already existing (e.g. a second tab beat this one to it) is
    // not a real failure -- the invite page just re-renders with the
    // Accept button either way once revalidated.
    if (error.code !== "23505") {
      console.error("createMinimalProfile failed:", error)
      return { ok: false, error: toPublicSubmissionError() }
    }
  }

  revalidatePath("/invite/site-admin/[token]", "page")
  return { ok: true }
}
