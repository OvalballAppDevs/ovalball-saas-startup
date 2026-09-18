import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { PENDING_CONFIRMATION_EXPLANATION } from "@/lib/permissions/role-presentation"
import { resolveClubSafeguardingAppointments } from "@/lib/safeguarding/club-appointments"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../resolve-nav-capabilities"
import { NominateOfficerForm } from "./nominate-form"
import { OfficerRow, type OfficerData } from "./officer-row"

export const metadata = { title: "Safeguarding | Club Settings" }

/**
 * Safeguarding Officer Foundation -- Club Admin area. Identity/Auth Slice 4G retired the three
 * transitional club.safeguarding.* keys this page used to ask (AA.3 row 4g), so it now asks the
 * canonical ones: safeguarding.officer.nominate to reach the page and to nominate, invite, edit or
 * deactivate, and safeguarding.conversation.start to message the officer. They are still checked
 * independently, matching this page family's convention of a boolean per action rather than one
 * combined flag.
 *
 * Nothing on this page appoints anybody any more. A nomination enters PENDING_CONFIRMATION and
 * confers nothing until Ovalball confirms it (AN-6).
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
    hasCapability(supabase, "safeguarding.officer.nominate", "club", { clubId }),
    hasCapability(supabase, "safeguarding.conversation.start", "club", { clubId }),
  ])

  // TWO RECORDS, AND THIS PAGE USED TO READ ONLY ONE.
  //
  // `get_club_safeguarding_officers` returns the CONTACT register -- the name and
  // address a club publishes -- which is written by the invite-an-outsider path.
  // Nominating an EXISTING member goes through the 4G state machine in
  // `role_assignments` and writes no contact row, so every such nomination was
  // invisible here and the page told the club it had no Safeguarding Officer at
  // all. That is not "no officer yet"; it is "an appointment is in progress and
  // this screen cannot see it", and it was the screen that owns the appointment.
  const [{ data: officerRows }, appointments] = await Promise.all([
    supabase.rpc("get_club_safeguarding_officers", { p_club_id: clubId }),
    resolveClubSafeguardingAppointments(supabase, clubId),
  ])
  const officers: OfficerData[] = (officerRows ?? []).map((o) => ({
    id: o.id,
    officerType: o.officer_type as "primary" | "deputy",
    contactName: o.contact_name,
    contactEmail: o.contact_email,
    status: o.status as OfficerData["status"],
    pendingInvitationId: o.pending_invitation_id,
  }))

  const pending = appointments.filter((a) => a.confirmationState === "PENDING_CONFIRMATION")
  const confirmed = appointments.filter((a) => a.confirmationState !== "PENDING_CONFIRMATION")
  const heldFor = (type: string) =>
    officers.some((o) => o.officerType === type) || appointments.some((a) => a.officerType === type)
  // "No primary officer" and "nominate a primary officer" now ask the same
  // question of the same two records, so the page cannot offer to nominate
  // somebody it is already showing as nominated.
  const primary = heldFor("primary")
  const deputy = heldFor("deputy")
  const officerTypeLabel = (t: string) => (t === "deputy" ? "Deputy Safeguarding Officer" : "Safeguarding Officer")

  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Safeguarding Officer</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        {clubName}&rsquo;s designated Safeguarding Officer(s), their Ovalball status, and how to reach them.
      </p>

      <ClubSettingsNav active="safeguarding" {...navCaps} />

      {!primary && (
        <div className="mt-8 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3.5">
          <p className="text-sm font-medium text-ink">No primary Safeguarding Officer</p>
          <p className="mt-1 text-sm text-ink/70">This club currently has no active primary Safeguarding Officer.</p>
        </div>
      )}

      {/* THE MIDDLE OF THE STATE MACHINE, VISIBLE AT LAST.
          A nomination is neither "nobody" nor "the Safeguarding Officer". It is a
          named person the club has put forward, waiting on Ovalball, holding none
          of the authority yet -- and all three of those facts are stated here
          rather than left to be inferred from a screen that showed nothing. */}
      {pending.length > 0 && (
        <section className="mt-8" aria-labelledby="pending-appointments">
          <h2 id="pending-appointments" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Awaiting Confirmation
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {pending.map((a) => (
              <li key={a.assignmentId} className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    {a.personName ?? a.email ?? "A club member"} &mdash; {officerTypeLabel(a.officerType)}
                  </p>
                  <p className="text-xs font-medium text-ink/70">Pending confirmation</p>
                </div>
                <p className="mt-1 text-sm text-ink/70">{PENDING_CONFIRMATION_EXPLANATION}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A confirmed appointment made from inside the club has no contact row of
          its own, so it would otherwise be as invisible as a pending one. */}
      {confirmed.length > 0 && (
        <section className="mt-6" aria-labelledby="confirmed-appointments">
          <h2 id="confirmed-appointments" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Confirmed Appointments
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {confirmed.map((a) => (
              <li key={a.assignmentId} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    {a.personName ?? a.email ?? "A club member"} &mdash; {officerTypeLabel(a.officerType)}
                  </p>
                  <p className="text-xs font-medium text-forest-800">{a.state === "SUSPENDED" ? "Suspended" : "Confirmed"}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
