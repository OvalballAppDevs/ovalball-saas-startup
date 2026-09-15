import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { hasPlayerCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { PermissionRow, type PermissionRowData } from "./permission-row"

/**
 * The Player Access settings surface (Side Project 1 integration) -- one
 * place a Guardian sets each consent independently (deny-by-default,
 * explicitly a DIFFERENT authorization system from Site Admin
 * capability). get_player_permission_summary() is the one authorization
 * boundary for reading this page's data -- it raises if the caller is
 * neither an active Guardian of this player, the player themselves, nor
 * Site Admin, which this page treats as "not found" rather than leaking
 * whether a given player id even exists.
 */
export default async function PlayerAccessPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [{ data: player }, { data: summary, error: summaryError }] = await Promise.all([
    supabase.from("players").select("id, first_name, surname").eq("id", playerId).maybeSingle(),
    supabase.rpc("get_player_permission_summary", { p_player_id: playerId }),
  ])

  if (!player || summaryError || !summary) notFound()

  // Only this child's own guardian changes anything here (Phase 2 J.6 family.permission.manage, never an
  // administrator): the same canonical answer setPlayerPermission refuses with, for this exact player, whatever
  // context the session is in and whether or not the child has a team place yet.
  const canEdit = await hasPlayerCapability(supabase, "family.permission.manage", playerId)

  const permissions: PermissionRowData[] = summary.map((row) => ({
    key: row.permission_key,
    label: row.label,
    description: row.description,
    effective: row.effective,
    myDecision: row.my_decision,
    coGuardiansPending: row.co_guardians_pending,
  }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" />
        Dashboard
      </Link>

      <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Player access</p>
      <h1 className="mt-2 font-display text-display-l text-ink">
        {player.first_name} {player.surname}
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        {canEdit
          ? "Choose what " + player.first_name + " can see and do on Ovalball. Each of these is independent — allowing one doesn't allow the others."
          : `${player.first_name}'s guardian controls these settings. You can see the current state below.`}
      </p>

      <ul className="mt-8 flex flex-col gap-2">
        {permissions.map((permission) =>
          canEdit ? (
            <PermissionRow key={permission.key} permission={permission} playerId={playerId} />
          ) : (
            <li key={permission.key} className="flex items-start justify-between gap-4 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-ink">{permission.label}</p>
                <p className="mt-0.5 text-sm text-ink-muted">{permission.description}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${permission.effective ? "bg-forest-100 text-forest-800" : "bg-ink/5 text-ink-muted"}`}>
                {permission.effective ? "Allowed" : "Not allowed"}
              </span>
            </li>
          )
        )}
      </ul>

      {!canEdit && <p className="mt-6 text-xs text-ink-muted">Only {player.first_name}&apos;s guardian can change these settings.</p>}

      <div className="mt-8 border-t border-ink/10 pt-6">
        <Link href={`/parent/players/${playerId}/subscription`} className="text-sm font-medium text-forest-800 underline underline-offset-4 hover:text-forest-950">
          Manage {player.first_name}&rsquo;s subscription →
        </Link>
      </div>
    </div>
  )
}
