import { redirect } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { getCapabilities, getPermissionGroups } from "./actions"
import { GroupCard } from "./group-card"
import { GroupForm } from "./group-form"

const SCOPE_LABEL: Record<string, string> = { club: "Club-wide groups", team: "Team-scoped groups", global: "Global" }

/** Site Admin only. Groups are a configuration/documentation layer over the real, already-implemented club_memberships.role / team_permissions.permission enforcement -- see actions.ts and the migration comment for the full reasoning. */
export default async function AdminPermissionsPage() {
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

  const [groups, capabilities] = await Promise.all([getPermissionGroups(), getCapabilities()])
  const byScope = new Map<string, typeof groups>()
  for (const g of groups) {
    const list = byScope.get(g.scopeType) ?? []
    list.push(g)
    byScope.set(g.scopeType, list)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-l text-ink">Permission management</h1>
          <p className="mt-2 max-w-xl text-sm text-ink/55">
            Named, documented bundles of what a person can do. Each group still resolves to one of the product&apos;s
            real, already-implemented access levels &mdash; combining existing capabilities into a new group never
            requires a code change; a genuinely new access level always does.
          </p>
        </div>
        <GroupForm capabilities={capabilities} triggerLabel="+ New permission group" />
      </div>

      <div className="mt-8 flex flex-col gap-8">
        {["club", "team"].map((scope) =>
          byScope.get(scope) && byScope.get(scope)!.length > 0 ? (
            <div key={scope}>
              <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">{SCOPE_LABEL[scope]}</h2>
              <div className="mt-3 flex flex-col gap-3">
                {byScope.get(scope)!.map((g) => (
                  <GroupCard key={g.id} group={g} capabilities={capabilities} />
                ))}
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  )
}
