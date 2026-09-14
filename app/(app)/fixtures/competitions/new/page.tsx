import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { resolveOrganiserScope } from "@/lib/competitions/organiser-scope"

import { CompetitionDetailsForm } from "../[editionId]/[step]/step-details"

export const metadata = { title: "New Competition" }

export default async function NewCompetitionPage() {
  const scope = await resolveOrganiserScope()
  if (!scope) redirect("/fixtures")
  // Union and League are isolated: a club sees its own code's team types only;
  // Site Admin chooses between the codes, never a mixed list.
  const codes = scope.siteAdmin ? (["union", "league"] as const) : ([scope.clubRugbyCode ?? "union"] as ("union" | "league")[])
  const [{ data: types }, { data: seasons }] = await Promise.all([
    scope.supabase.from("canonical_team_types_by_code").select("id, label, rugby_code, sort_order").in("rugby_code", [...codes]).eq("is_offered", true).order("sort_order"),
    // The Seasons register: this season and those ahead, never a computed one.
    scope.supabase
      .from("seasons")
      .select("id, name, rugby_code, starts_on, ends_on")
      .in("rugby_code", [...codes])
      .eq("is_regression_fixture", false)
      .gte("ends_on", new Date().toISOString().slice(0, 10))
      .order("starts_on"),
  ])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <Link href="/fixtures/competitions" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Competitions
      </Link>
      <h1 className="mt-2 font-display text-3xl text-ink">New Competition</h1>
      <p className="mt-1 text-sm text-ink-muted">A name and Union or League are needed now. Everything else can be set or changed later.</p>
      <div className="mt-6">
        <CompetitionDetailsForm
          mode="create"
          codes={[...codes]}
          teamTypes={(types ?? []).map((t) => ({ id: t.id as string, label: t.label as string, rugbyCode: t.rugby_code as "union" | "league" }))}
          seasons={(seasons ?? []).map((s) => ({ id: s.id, name: s.name, rugbyCode: s.rugby_code as "union" | "league" }))}
          // A club organises in its own code, so that is not a choice; Site Admin chooses, and nothing is assumed.
          initial={{ name: "", rugbyCode: codes.length === 1 ? codes[0] : null, seasonId: null, canonicalTeamTypeId: null, format: null, teamCount: null, organiserName: null }}
        />
      </div>
    </div>
  )
}
