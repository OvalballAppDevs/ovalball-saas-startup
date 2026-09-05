import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { resolvePersonalAvatarUrl } from "@/lib/app-context/personal-avatar"
import { getSessionContext } from "@/lib/app-context/session-context"
import { parseRememberCookie, REMEMBER_COOKIE_NAME } from "@/lib/supabase/remember"
import { createClient } from "@/lib/supabase/server"

import { AvatarForm } from "./avatar-form"
import { EmailChangeForm } from "./email-change-form"
import { NotificationPreferencesSection } from "./notification-preferences-section"
import { PersonalDetailsForm } from "./personal-details-form"
import { PhoneNumberForm } from "./phone-number-form"
import { SecuritySection } from "./security-section"
import { SignOutButton } from "./sign-out-button"

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const initialRemember = parseRememberCookie(cookieStore.get(REMEMBER_COOKIE_NAME)?.value)
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "first_name, surname, phone_number, avatar_storage_path, date_of_birth, address_line_1, address_line_2, address_line_3, town, county, postcode, country"
    )
    .eq("id", user.id)
    .maybeSingle()

  // Avatar-initials seed only -- deliberately NOT a friendly placeholder
  // sentence like "Your profile" (UserAvatar has no way to tell a real
  // two-word name from a two-word placeholder, and would render "YP").
  // An empty string here correctly falls through to UserAvatar's own "?".
  const avatarSeed = [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || ctx.firstName || ""
  const avatarUrl = resolvePersonalAvatarUrl(supabase, profile?.avatar_storage_path)

  const [{ data: topicRows }, { data: preferenceRows }] = await Promise.all([
    supabase.from("notification_topics").select("key, label, description, mandatory, email_ready, push_ready").order("sort_order"),
    supabase.from("notification_preferences").select("topic_key, in_app_enabled").eq("user_id", user.id),
  ])
  const preferenceByTopic = new Map((preferenceRows ?? []).map((p) => [p.topic_key, p.in_app_enabled]))
  const notificationTopics = (topicRows ?? []).map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    mandatory: t.mandatory,
    emailReady: t.email_ready,
    pushReady: t.push_ready,
    // Absent row = on (Section 44's forward-compatible opt-out default),
    // matching internal.should_deliver_notification()'s own fallback.
    inAppEnabled: preferenceByTopic.get(t.key) ?? true,
  }))

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Profile</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Edit Personal Profile</h1>

      <div className="mt-6">
        <AvatarForm initialUrl={avatarUrl} name={avatarSeed} />
      </div>

      {(ctx.clubMemberships.length > 0 || ctx.teamPermissions.length > 0) && (
        <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
          <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Your roles</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink/70">
            {ctx.clubMemberships
              .filter((m) => m.role !== "BASIC_USER")
              .map((m) => (
                <li key={m.clubId}>
                  {m.clubName} — {m.role === "CLUB_ADMIN" ? "Club Admin" : "Fixture Secretary"}
                </li>
              ))}
            {ctx.teamPermissions.map((tp) => (
              <li key={tp.teamId}>
                {tp.teamDisplayName} — {tp.permission}
              </li>
            ))}
            {ctx.isSiteAdmin && <li>Site Admin</li>}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <PersonalDetailsForm
          initial={{
            firstName: profile?.first_name ?? "",
            surname: profile?.surname ?? "",
            addressLine1: profile?.address_line_1 ?? "",
            addressLine2: profile?.address_line_2 ?? "",
            addressLine3: profile?.address_line_3 ?? "",
            town: profile?.town ?? "",
            county: profile?.county ?? "",
            postcode: profile?.postcode ?? "",
            country: profile?.country ?? "",
          }}
          dateOfBirth={profile?.date_of_birth ?? null}
        />
      </div>

      <PhoneNumberForm initialPhone={profile?.phone_number ?? null} />

      <div className="mt-6">
        <EmailChangeForm currentEmail={user.email ?? ""} />
      </div>

      <div className="mt-6">
        <NotificationPreferencesSection topics={notificationTopics} />
      </div>

      <div className="mt-6">
        <SecuritySection initialRemember={initialRemember} />
      </div>

      <div className="mt-8">
        <SignOutButton />
      </div>
    </div>
  )
}
