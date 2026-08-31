import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { canManageClubFixturesAnywhere, getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { CreateTeamForm } from "./create-team-form"

export default async function TeamsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  if (!canManageClubFixturesAnywhere(ctx)) redirect("/dashboard")

  const clubId = ctx.clubMemberships[0]?.clubId
  const isClubAdmin = ctx.clubMemberships.some((m) => m.role === "CLUB_ADMIN")

  const { data: teams } = clubId
    ? await supabase
        .from("teams")
        .select("id, display_name, category, age_group, squad_designation, gender, active")
        .eq("club_id", clubId)
        .order("category")
        .order("age_group")
    : { data: [] }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Teams</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Every real playing side has its own calendar and its own team-scoped roles.
      </p>

      {teams && teams.length > 0 ? (
        <ul className="mt-8 flex flex-col gap-2">
          {teams.map((t) => (
            <li key={t.id}>
              <Link
                href={`/teams/${t.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{t.display_name}</p>
                  <p className="text-xs text-ink/50">
                    {[
                      `${t.category === "youth" ? t.age_group : "Senior"}${t.squad_designation ? ` ${t.squad_designation}` : ""}`,
                      t.gender,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!t.active && <span className="text-xs text-ink/40">Archived</span>}
                  <ChevronRight className="size-4 text-ink/30" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">No teams yet</p>
          <p className="mt-1 text-sm text-ink/55">Add your club&apos;s first team below.</p>
        </div>
      )}

      {isClubAdmin && clubId && (
        <div className="mt-6">
          <CreateTeamForm clubId={clubId} />
        </div>
      )}
    </div>
  )
}
