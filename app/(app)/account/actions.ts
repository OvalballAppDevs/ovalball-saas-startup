"use server"

import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { reissueAuthCookiesWithRememberPreference, REMEMBER_COOKIE_NAME } from "@/lib/supabase/remember"

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/")
}

/**
 * Affects the CURRENT device/session only -- this device's own auth
 * cookies are re-issued immediately with the new lifetime; no other
 * signed-in device is touched (a separate "Sign out other devices"
 * action would be needed for that, and isn't built yet).
 */
export async function setRememberPreference(remember: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const cookieStore = await cookies()
  cookieStore.set(REMEMBER_COOKIE_NAME, remember ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 400,
  })
  await reissueAuthCookiesWithRememberPreference(cookieStore, remember)

  return { ok: true }
}

/**
 * Toggles one notification topic's in-app delivery for the signed-in
 * user via the canonical set_notification_preference() RPC -- the
 * mandatory "Account and security" topic is rejected server-side
 * regardless of what the client sends (Section 43: optional preferences
 * must never suppress mandatory notices).
 */
export async function setNotificationPreference(topicKey: string, inAppEnabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_notification_preference", { p_topic_key: topicKey, p_in_app_enabled: inAppEnabled })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/account")
  return { ok: true }
}

export type UpdatePhoneResult = { ok: true } | { ok: false; error: string }

/**
 * profiles_update_self_or_admin already restricts this to your own row --
 * a phone number you add here is private by default (profiles_select_
 * self_or_admin) and only ever leaves your profile when you deliberately
 * share a Contact Card into a specific fixture conversation.
 */
export async function updateOwnPhoneNumber(phone: string): Promise<UpdatePhoneResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const trimmed = phone.trim()
  const { error } = await supabase
    .from("profiles")
    .update({ phone_number: trimmed || null })
    .eq("id", user.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export type UpdateProfileResult = { ok: true } | { ok: false; error: string }

export interface PersonalDetailsInput {
  firstName: string
  surname: string
  addressLine1: string
  addressLine2: string
  addressLine3: string
  town: string
  county: string
  postcode: string
  country: string
}

/** profiles_update_self_or_admin restricts this to your own row -- never DOB (view-only, set at signup) and never email (its own secure Auth flow below). */
export async function updatePersonalDetails(input: PersonalDetailsInput): Promise<UpdateProfileResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }
  if (!input.firstName.trim() || !input.surname.trim()) return { ok: false, error: "First name and surname are required." }

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: input.firstName.trim(),
      surname: input.surname.trim(),
      address_line_1: input.addressLine1.trim() || null,
      address_line_2: input.addressLine2.trim() || null,
      address_line_3: input.addressLine3.trim() || null,
      town: input.town.trim() || null,
      county: input.county.trim() || null,
      postcode: input.postcode.trim() || null,
      country: input.country.trim() || null,
    })
    .eq("id", user.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}

export type UploadAvatarResult = { ok: true; url: string } | { ok: false; error: string }

/** Own-path-only storage policies (avatars_insert_self etc.) are the real boundary -- upload-then-link, matching every other image upload this session. */
export async function uploadAvatar(formData: FormData): Promise<UploadAvatarResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const file = formData.get("avatar")
  if (!(file instanceof File)) return { ok: false, error: "No file provided." }
  if (file.size > MAX_AVATAR_BYTES) return { ok: false, error: "Photo must be under 2MB." }
  const extension = ALLOWED_AVATAR_TYPES[file.type]
  if (!extension) return { ok: false, error: "Photo must be PNG, JPEG, or WEBP." }

  const { data: existing } = await supabase.from("profiles").select("avatar_storage_path").eq("id", user.id).maybeSingle()

  const path = `${user.id}/avatar-${Date.now()}.${extension}`
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) return { ok: false, error: "Couldn't upload the photo. Please try again." }

  const { error: updateError } = await supabase.from("profiles").update({ avatar_storage_path: path }).eq("id", user.id)
  if (updateError) {
    await supabase.storage.from("avatars").remove([path])
    return { ok: false, error: updateError.message }
  }

  if (existing?.avatar_storage_path && existing.avatar_storage_path !== path) {
    await supabase.storage.from("avatars").remove([existing.avatar_storage_path])
  }

  // The sidebar identity is rendered by the root (app) layout, which Next.js
  // caches across client-side navigation -- without this, the new avatar
  // only ever shows on the Profile page itself (via its own client-side
  // optimistic state) until a hard reload breaks the stale layout cache.
  revalidatePath("/", "layout")

  return { ok: true, url: supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl }
}

export async function removeAvatar(): Promise<UpdateProfileResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { data: existing } = await supabase.from("profiles").select("avatar_storage_path").eq("id", user.id).maybeSingle()
  const { error } = await supabase.from("profiles").update({ avatar_storage_path: null }).eq("id", user.id)
  if (error) return { ok: false, error: error.message }
  if (existing?.avatar_storage_path) await supabase.storage.from("avatars").remove([existing.avatar_storage_path])
  revalidatePath("/", "layout")
  return { ok: true }
}

export type ChangeEmailResult = { ok: true } | { ok: false; error: string }

/**
 * The secure Supabase Auth flow -- never a direct profiles/auth.users
 * column write. Sends a confirmation link to the NEW address; the email
 * only actually changes once that link is followed, so this always
 * returns before the change is authoritative.
 */
export async function requestEmailChange(newEmail: string): Promise<ChangeEmailResult> {
  const supabase = await createClient()
  const trimmed = newEmail.trim()
  if (!trimmed || !trimmed.includes("@")) return { ok: false, error: "Enter a valid email address." }

  const { error } = await supabase.auth.updateUser({ email: trimmed })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
