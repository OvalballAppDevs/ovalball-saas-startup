import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"

import { AddChildForm } from "./add-child-form"
import { InviteLoginButton } from "./invite-login-button"

interface ChildRow {
  playerId: string
  firstName: string
  surname: string
  dateOfBirth: string | null
  teamStatus: "active" | "pending" | "none"
  teamLabel: string | null
  hasLogin: boolean
}

/**
 * The Parent's "Your children" surface (Side Project 1 integration) --
 * deliberately a dedicated route (not a nav item, matching how
 * /parent/players/[id]/access and /subscription work) rather than folded
 * into the shared Dashboard's single-active-context switcher, since a
 * Parent may want to see every child at once regardless of which context
 * is currently active. Queries guardians/players directly (not
 * getSessionContext's narrower guardianRelationships, which is derived
 * only from ACTIVE team memberships) so a child with a still-PENDING or
 * not-yet-assigned team membership still shows up here with a truthful
 * status.
 */
export default async function ParentChildrenPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: guardianLinks } = await supabase.from("guardians").select("player_id, players(id, first_name, surname, date_of_birth, user_id)").eq("guardian_user_id", user.id).eq("status", "active")

  const playerIds = (guardianLinks ?? []).map((g) => g.player_id)

  const { data: memberships } =
    playerIds.length > 0
      ? await supabase.from("player_team_memberships").select("player_id, status, teams(display_name, category, age_group, gender, squad_designation)").in("player_id", playerIds).in("status", ["active", "pending"])
      : { data: [] }

  const membershipByPlayerId = new Map<string, { status: "active" | "pending"; label: string }>(
    (memberships ?? []).map((m) => [m.player_id, { status: m.status as "active" | "pending", label: m.teams?.display_name ?? "Team" }])
  )

  const children: ChildRow[] = (guardianLinks ?? [])
    .filter((g) => g.players)
    .map((g): ChildRow => {
      const membership = membershipByPlayerId.get(g.player_id)
      return {
        playerId: g.players!.id,
        firstName: g.players!.first_name,
        surname: g.players!.surname,
        dateOfBirth: g.players!.date_of_birth,
        teamStatus: membership?.status ?? "none",
        teamLabel: membership?.label ?? null,
        hasLogin: g.players!.user_id !== null,
      }
    })
    .sort((a, b) => a.firstName.localeCompare(b.firstName))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Dashboard
      </Link>

      <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Your family</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Your children</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Add your child&rsquo;s details to create or connect their Ovalball player profile. We&rsquo;ll use their date of birth to place them in the correct rugby age group for the season.
      </p>

      {children.length > 0 && (
        <ul className="mt-8 flex flex-col gap-2">
          {children.map((child) => (
            <li key={child.playerId} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {child.firstName} {child.surname}
                  </p>
                  <p className="text-xs text-ink/50">
                    {child.teamStatus === "active" && child.teamLabel && `${child.teamLabel} · Active`}
                    {child.teamStatus === "pending" && `${child.teamLabel} · Pending club approval`}
                    {child.teamStatus === "none" && "Pending club team assignment"}
                    {child.hasLogin ? " · Has their own Ovalball login" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/parent/players/${child.playerId}/access`} className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                    Manage access
                  </Link>
                  {child.teamStatus === "active" && (
                    <Link href={`/parent/players/${child.playerId}/subscription`} className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                      Manage subscription
                    </Link>
                  )}
                  {!child.hasLogin && <InviteLoginButton playerId={child.playerId} playerFirstName={child.firstName} />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Add a child</h2>
        <AddChildForm />
      </section>
    </div>
  )
}
