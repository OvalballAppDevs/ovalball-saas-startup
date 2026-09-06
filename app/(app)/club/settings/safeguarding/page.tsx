import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../resolve-nav-capabilities"
import { NominateOfficerForm } from "./nominate-form"
import { OfficerRow, type OfficerData } from "./officer-row"

/**
 * Safeguarding Officer Foundation -- Club Admin area. Gated on
 * club.safeguarding.view (read) with club.safeguarding.manage_contact
 * (nominate/invite/edit/deactivate) and club.safeguarding.message
 * (message action) independently checked, matching this page family's
 * own established convention of independent booleans per action rather
 * than one combined flag.
 */
export default async function SafeguardingOfficerPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)

  const navCaps = await resolveClubSettingsNavCapabilities(supabase, clubId)
  const canView = navCaps.canSafeguarding
  if (!clubId || !canView) redirect("/club/settings")

  const [canManageContact, canMessage] = await Promise.all([
    hasCapability(supabase, "club.safeguarding.manage_contact", "club", { clubId }),
    hasCapability(supabase, "club.safeguarding.message", "club", { clubId }),
  ])

  const { data: officerRows } = await supabase.rpc("get_club_safeguarding_officers", { p_club_id: clubId })
  const officers: OfficerData[] = (officerRows ?? []).map((o) => ({
    id: o.id,
    officerType: o.officer_type as "primary" | "deputy",
    contactName: o.contact_name,
    contactEmail: o.contact_email,
    status: o.status as OfficerData["status"],
    pendingInvitationId: o.pending_invitation_id,
  }))

  const primary = officers.find((o) => o.officerType === "primary")
  const deputy = officers.find((o) => o.officerType === "deputy")

  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Safeguarding Officer</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        {clubName}&rsquo;s designated Safeguarding Officer(s), their Ovalball status, and how to reach them.
      </p>

      <ClubSettingsNav active="safeguarding" {...navCaps} />

      {!primary && (
        <div className="mt-8 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3.5">
          <p className="text-sm font-medium text-ink">No primary Safeguarding Officer</p>
          <p className="mt-1 text-sm text-ink/70">This club currently has no active primary Safeguarding Officer.</p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {officers.map((officer) => (
          <OfficerRow
            key={officer.id}
            officer={officer}
            canManageContact={canManageContact}
            canMessage={canMessage}
          />
        ))}
      </div>

      {canManageContact && (
        <div className="mt-6 flex flex-wrap gap-3">
          {!primary && <NominateOfficerForm clubId={clubId} officerType="primary" />}
          {!deputy && <NominateOfficerForm clubId={clubId} officerType="deputy" />}
        </div>
      )}
    </div>
  )
}
