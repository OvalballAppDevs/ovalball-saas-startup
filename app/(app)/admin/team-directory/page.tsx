import { redirect } from "next/navigation"
import { ListTree } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { AddTeamTypeDialog } from "./add-team-type-dialog"
import { DeactivateTeamTypeButton } from "./deactivate-team-type-button"

const GROUP_LABELS: Record<string, string> = {
  youth: "Youth / age-grade",
  colts: "Colts",
  senior: "Senior",
}

/**
 * Site Admin Team Directory -- the GLOBAL canonical team catalogue every
 * club-level Add Team/claim/signup picker reads from live. Two distinct
 * operations here, never conflated: adding a global type (this page,
 * manage_team_catalogue capability only) vs. a club actually activating a
 * team for itself (the existing, unrelated Add Team flow on /teams --
 * unaffected by this page). Every active Site Admin can VIEW this
 * directory; only one with the specific manage_team_catalogue grant
 * (see /admin/site-admins) can add or deactivate a type.
 */
export default async function TeamDirectoryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const ctx = activeSiteAdmin.ctx

  const { data: types } = await supabase
    .from("canonical_team_types")
    .select("id, key, label, category, age_group, gender, fixed_squad_designation, allows_squads, is_active, sort_order")
    .order("sort_order")

  const byCategory = new Map<string, typeof types>()
  for (const t of types ?? []) {
    const list = byCategory.get(t.category) ?? []
    list.push(t)
    byCategory.set(t.category, list)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ListTree className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Team Directory</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        The closed, global list of real team identities Ovalball supports &mdash; the exact same list every club&apos;s
        Add Team screen and the signup team checklist read from live. Adding a type here never creates a team for any
        club; each club still activates it separately, on its own Add Team screen.
      </p>

      {!ctx.manageTeamCatalogue && (
        <p className="mt-6 rounded-lg border border-forest-800/20 bg-forest-800/5 px-4 py-3 text-sm text-forest-800">
          You can view the Team Directory. Adding or deactivating a global type requires the Team Directory management
          capability &mdash; a Full Site Admin can grant it from Site Admin Management.
        </p>
      )}

      {ctx.manageTeamCatalogue && (
        <div className="mt-8">
          <AddTeamTypeDialog />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-6">
        {["youth", "colts", "senior"].map((category) => {
          const rows = byCategory.get(category) ?? []
          if (rows.length === 0) return null
          return (
            <div key={category}>
              <p className="text-xs font-medium tracking-[0.06em] text-ink/40 uppercase">{GROUP_LABELS[category]}</p>
              <div className="mt-2 overflow-hidden rounded-lg border border-ink/10 bg-white">
                <ul className="divide-y divide-ink/5">
                  {rows.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-medium ${t.is_active ? "text-ink" : "text-ink/40 line-through"}`}>{t.label}</p>
                        <p className="text-xs text-ink/40">
                          {t.key}
                          {t.allows_squads && " · B/C squads allowed"}
                          {!t.is_active && " · Deactivated"}
                        </p>
                      </div>
                      {ctx.manageTeamCatalogue && t.is_active && <DeactivateTeamTypeButton id={t.id} label={t.label} />}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
