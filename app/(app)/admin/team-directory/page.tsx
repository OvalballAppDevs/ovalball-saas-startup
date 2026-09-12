import { redirect } from "next/navigation"
import Link from "next/link"
import { ListTree } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"
import { buildDirectory, type DirectoryIdentityRow } from "@/lib/teams/directory-taxonomy"

import { AddTeamTypeDialog } from "./add-team-type-dialog"
import { CODE_LABELS, resolveRugbyCode, TeamDirectoryCodeNav } from "./code-nav"
import { IdentityRow } from "./identity-row"

export const metadata = { title: "Team Directory" }

/**
 * The canonical Team Directory, one rugby code at a time.
 *
 * Union and League are two catalogues. The old page put both in one list and
 * hung "Not offered in Rugby League" off the rows that did not apply, which
 * asked an administrator to read things and then ignore them. Which code an
 * identity belongs to is structural, so the query is scoped to the chosen code
 * and absence is the whole answer.
 *
 * Site Admin is the one place both codes are legitimately managed, and it does
 * so by choosing between them -- never by mixing them. Everywhere else in
 * Ovalball a club only ever sees its own code.
 */
export default async function TeamDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; retired?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard: requires BOTH real Site Admin authority AND
  // that the account has actively switched into Site Admin as its current
  // operating context.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const ctx = activeSiteAdmin.ctx

  const params = await searchParams
  const rugbyCode = resolveRugbyCode(params.code)
  const showRetired = params.retired === "1"

  // Scoped at the query, not in the browser. Loading both catalogues and
  // hiding one is how the other code leaks back in later.
  const { data: rows } = await supabase
    .from("canonical_team_types_by_code")
    .select("id, category, age_group, gender, fixed_squad_designation, allows_squads, is_active, sort_order")
    .eq("rugby_code", rugbyCode)
    .eq("is_offered", true)
    .order("sort_order")

  // Retired identities are a deliberate second view: they are kept so existing
  // history still resolves, and they would otherwise clutter the catalogue an
  // administrator actually works in.
  const { data: retiredRows } = showRetired
    ? await supabase
        .from("canonical_team_types")
        .select("id, category, age_group, gender, fixed_squad_designation, allows_squads, is_active, sort_order")
        .eq("is_active", false)
        .order("sort_order")
    : { data: [] }

  const identities: DirectoryIdentityRow[] = [...(rows ?? []), ...(retiredRows ?? [])].map((r) => ({
    id: r.id!,
    category: r.category!,
    ageGroup: r.age_group,
    gender: r.gender,
    squadDesignation: r.fixed_squad_designation,
    isActive: r.is_active ?? true,
    sortOrder: r.sort_order ?? 0,
  }))

  const sections = buildDirectory(identities, rugbyCode)
  const activeCount = identities.filter((i) => i.isActive).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ListTree className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Team Directory</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Every team identity Ovalball recognises, and the only list a club&apos;s Add Team screen and the signup
        checklist read from. Adding one here never creates a team for any club.
      </p>

      <TeamDirectoryCodeNav active={rugbyCode} showRetired={showRetired} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {activeCount} identit{activeCount === 1 ? "y" : "ies"} in {CODE_LABELS[rugbyCode]}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/admin/team-directory?code=${rugbyCode}${showRetired ? "" : "&retired=1"}`}
            className="text-sm text-forest-800 underline underline-offset-2 hover:text-forest-950"
          >
            {showRetired ? "Hide retired identities" : "Show retired identities"}
          </Link>
          {ctx.manageTeamCatalogue && <AddTeamTypeDialog rugbyCode={rugbyCode} />}
        </div>
      </div>

      {!ctx.manageTeamCatalogue && (
        <p className="mt-4 rounded-lg border border-forest-800/20 bg-forest-800/5 px-4 py-3 text-sm text-forest-800">
          You can read the Team Directory. Adding or retiring an identity needs the Team Directory management
          capability, which a Full Site Admin can grant from Site Admin Management.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6">
        {sections.map(({ group, identities: rowsInGroup }) => (
          <section key={group.key} aria-labelledby={`group-${group.key}`}>
            <h2 id={`group-${group.key}`} className="font-display text-lg text-ink">
              {group.title}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">{group.note}</p>
            <div className="mt-2.5 overflow-hidden rounded-lg border border-ink/10 bg-white">
              <ul className="divide-y divide-ink/8">
                {rowsInGroup.map((identity) => (
                  <IdentityRow
                    key={identity.id}
                    id={identity.id}
                    compact={identity.compact}
                    display={identity.display}
                    isActive={identity.isActive}
                    canManage={ctx.manageTeamCatalogue}
                  />
                ))}
              </ul>
            </div>
          </section>
        ))}

        {sections.length === 0 && (
          <p className="rounded-lg border border-ink/10 bg-white px-4 py-6 text-sm text-ink-muted">
            No identities are offered in {CODE_LABELS[rugbyCode]} yet.
          </p>
        )}
      </div>
    </div>
  )
}
