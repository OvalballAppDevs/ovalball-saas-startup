import "server-only"

import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { loadPublicClub, type PublicClub } from "@/lib/club-public/club"
import { getSiteUrlForMetadata } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"

import { mayManageContent, type ContentScope } from "./manage"

/**
 * Where News & Announcements is opened from, and whether this person may.
 *
 * Two consoles, one feature: the club's (Club Settings, scoped to the club
 * the person has switched into) and each team's (the team's own page). Both
 * are gated by the same capability pair the database enforces, and neither
 * is a role check. A console the person may not use redirects; the database
 * would refuse the writes anyway.
 */

export interface NewsConsole {
  supabase: Awaited<ReturnType<typeof createClient>>
  club: PublicClub
  scope: ContentScope
  basePath: string
  /** Teams this person may write for, in display form. */
  teams: { id: string; name: string }[]
  /** The team this console belongs to, when it is a team's. */
  team: { id: string; name: string } | null
  canChooseLeadStory: boolean
  publicOrigin: string
}

async function clubBySlugForId(supabase: NewsConsole["supabase"], clubId: string) {
  const { data } = await supabase.from("clubs").select("slug").eq("id", clubId).maybeSingle()
  return data?.slug ? loadPublicClub(data.slug) : null
}

export async function resolveClubNewsConsole(): Promise<NewsConsole> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)
  if (!clubId) redirect("/club/settings")

  const authority = await mayManageContent(supabase, { clubId, teamId: null })
  if (!authority.club) redirect("/club/settings")

  const club = await clubBySlugForId(supabase, clubId)
  if (!club) redirect("/club/settings")

  const { data: teams } = await supabase.from("teams").select("id, display_name, age_group").eq("club_id", clubId).eq("active", true)
  return {
    supabase,
    club,
    scope: { clubId, teamId: null },
    basePath: "/club/settings/news",
    teams: sortTeams(teams ?? []),
    team: null,
    canChooseLeadStory: true,
    publicOrigin: getSiteUrlForMetadata() ?? "",
  }
}

export async function resolveTeamNewsConsole(teamId: string): Promise<NewsConsole> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: team } = await supabase.from("teams").select("id, club_id, display_name, active").eq("id", teamId).maybeSingle()
  if (!team) notFound()

  // The same active-context rule the team page itself applies: an account
  // switched into another club does not reach this team's console.
  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  if (!ctx.isSiteAdmin && activeClubId(ctx, activeContext) !== team.club_id) redirect(`/teams/${teamId}`)

  const authority = await mayManageContent(supabase, { clubId: team.club_id, teamId })
  if (!authority.team) redirect(`/teams/${teamId}`)

  const club = await clubBySlugForId(supabase, team.club_id)
  if (!club) redirect(`/teams/${teamId}`)

  return {
    supabase,
    club,
    scope: { clubId: team.club_id, teamId },
    basePath: `/teams/${teamId}/news`,
    teams: [{ id: team.id, name: team.display_name }],
    team: { id: team.id, name: team.display_name },
    canChooseLeadStory: authority.club,
    publicOrigin: getSiteUrlForMetadata() ?? "",
  }
}

function sortTeams(rows: { id: string; display_name: string; age_group: string | null }[]) {
  const age = (a: string | null) => (a ? Number(a.replace(/\D/g, "")) || 99 : 99)
  return [...rows]
    .sort((a, b) => age(a.age_group) - age(b.age_group) || a.display_name.localeCompare(b.display_name))
    .map((t) => ({ id: t.id, name: t.display_name }))
}
