import { redirect } from "next/navigation"

import { reconcileOverdueFixtureResults } from "@/lib/app-context/reconcile-results"
import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { FixtureManagementView } from "./fixture-management-view"

export default async function AdminFixturesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
  await reconcileOverdueFixtureResults(supabase)

  const resolvedParams = await searchParams

  return (
    <FixtureManagementView
      supabase={supabase}
      searchParams={resolvedParams}
      scope={{ eyebrow: "Site Admin", importHref: "/admin/fixtures/import", basePath: "/admin/fixtures" }}
    />
  )
}
