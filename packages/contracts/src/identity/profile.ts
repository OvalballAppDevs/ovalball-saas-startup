import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * A PERSON'S OWN PROFILE (CA-M9): the fields the website's Account page lets a person change
 * themselves, through the same RLS-scoped `profiles` row (`profiles_update_self_or_admin`).
 *
 * WHAT IS HERE: name and phone number -- the two things a coach needs right and a person can correct
 * on a phone. WHAT IS NOT: email (an auth flow, on the website), the date of birth (never edited
 * here), the postal address (a desk job), and anything about memberships, teams or roles, which are
 * never a profile's to change. The name is normalised server-side by the one normaliser.
 */
export interface MyProfile {
  firstName: string
  surname: string
  phoneNumber: string | null
  email: string | null
  avatarStoragePath: string | null
}

export async function readMyProfile(supabase: Client, userId: string): Promise<MyProfile | null> {
  const { data, error } = await supabase.from("profiles").select("first_name, surname, phone_number, email, avatar_storage_path").eq("id", userId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    firstName: data.first_name ?? "",
    surname: data.surname ?? "",
    phoneNumber: data.phone_number ?? null,
    email: data.email ?? null,
    avatarStoragePath: data.avatar_storage_path ?? null,
  }
}

export async function updateMyName(supabase: Client, userId: string, firstName: string, surname: string): Promise<void> {
  const first = firstName.trim()
  const last = surname.trim()
  if (!first || !last) throw new Error("Both names are needed.")
  const { error } = await supabase.from("profiles").update({ first_name: first, surname: last }).eq("id", userId)
  if (error) throw error
}

export async function updateMyPhone(supabase: Client, userId: string, phoneNumber: string | null): Promise<void> {
  const value = phoneNumber?.trim() || null
  const { error } = await supabase.from("profiles").update({ phone_number: value }).eq("id", userId)
  if (error) throw error
}
