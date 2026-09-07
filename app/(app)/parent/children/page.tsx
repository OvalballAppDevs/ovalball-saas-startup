import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"

import { UserAvatar } from "@/components/profile/user-avatar"

import { AddChildForm } from "./add-child-form"
import { AddGuardianControl, ChildAvatarControl, WithdrawRequestButton } from "./child-controls"
import { InviteLoginButton } from "./invite-login-button"

interface ChildRow {
  playerId: string
  firstName: string
  surname: string
  dateOfBirth: string | null
  teamStatus: "active" | "pending" | "none"
  teamLabel: string | null
  hasLogin: boolean
  avatarUrl: string | null
  hasAvatar: boolean
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

  const { data: guardianLinks } = await supabase
    .from("guardians")
    .select("player_id, players(id, first_name, surname, date_of_birth, user_id, avatar_storage_path)")
    .eq("guardian_user_id", user.id)
    .eq("status", "active")

  // Applications this parent has in flight. Neutral by construction: the RPC
  // returns only what they submitted plus a status, never whether the child
  // was matched to an existing record.
  const { data: pendingRequests } = await supabase.rpc("my_guardian_link_requests")
  const pending = (pendingRequests ?? []).filter((r) => r.status === "PENDING")

  const playerIds = (guardianLinks ?? []).map((g) => g.player_id)

  const { data: memberships } =
    playerIds.length > 0
      ? await supabase.from("player_team_memberships").select("player_id, status, teams(display_name, category, age_group, gender, squad_designation)").in("player_id", playerIds).in("status", ["active", "pending"])
      : { data: [] }

  const membershipByPlayerId = new Map<string, { status: "active" | "pending"; label: string }>(
    (memberships ?? []).map((m) => [m.player_id, { status: m.status as "active" | "pending", label: m.teams?.display_name ?? "Team" }])
  )

  // Youth photos live in a PRIVATE bucket, so each one is a short-lived
  // signed URL minted for this viewer, never a public link that would work
  // for anyone who copied it.
  const avatarUrlByPlayerId = new Map<string, string>()
  for (const g of guardianLinks ?? []) {
    const path = g.players?.avatar_storage_path
    if (!path) continue
    const { data } = await supabase.storage.from("player-avatars").createSignedUrl(path, 3600)
    if (data?.signedUrl) avatarUrlByPlayerId.set(g.player_id, data.signedUrl)
  }

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
        avatarUrl: avatarUrlByPlayerId.get(g.player_id) ?? null,
        hasAvatar: Boolean(g.players!.avatar_storage_path),
      }
    })
    .sort((a, b) => a.firstName.localeCompare(b.firstName))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" />
        Dashboard
      </Link>

      <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Your family</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Your children</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        Add your child&rsquo;s details to create or connect their Ovalball player profile. We&rsquo;ll use their date of birth to place them in the correct rugby age group for the season.
      </p>

      {children.length > 0 && (
        <ul className="mt-8 flex flex-col gap-2">
          {children.map((child) => (
            <li key={child.playerId} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {/* The CHILD's own picture. Never the guardian's -- an
                      adult's face captioned with a child's name is the
                      defect this whole phase was opened on. */}
                  <UserAvatar avatarUrl={child.avatarUrl} name={`${child.firstName} ${child.surname}`} size="md" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {child.firstName} {child.surname}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {child.teamStatus === "active" && child.teamLabel && `${child.teamLabel} · Active`}
                      {child.teamStatus === "pending" && `${child.teamLabel} · Pending club approval`}
                      {child.teamStatus === "none" && "Pending club team assignment"}
                      {child.hasLogin ? " · Has their own Ovalball login" : ""}
                    </p>
                    <div className="mt-2">
                      <ChildAvatarControl playerId={child.playerId} hasAvatar={child.hasAvatar} />
                    </div>
                  </div>
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
              <div className="mt-3 border-t border-ink/8 pt-3">
                <AddGuardianControl playerId={child.playerId} childFirstName={child.firstName} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Applications in flight. A pending request must be VISIBLE and must
          not look like a linked child: it grants nothing, and pretending
          otherwise would be the same dishonesty as the old "sign out and
          back in" message. */}
      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Awaiting verification</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {pending.map((r) => (
              <li key={r.request_id} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-900">{r.child_label ?? "Your request"}</p>
                    <p className="mt-0.5 text-sm text-amber-900/80">
                      {r.kind === "ADDITIONAL_GUARDIAN"
                        ? `Waiting for this guardian relationship to be approved at ${r.club_name}.`
                        : `We've received your request and need to verify the relationship. ${r.club_name} will be in touch.`}
                    </p>
                  </div>
                  <WithdrawRequestButton requestId={r.request_id} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">Add a child</h2>
        <AddChildForm />
      </section>
    </div>
  )
}
