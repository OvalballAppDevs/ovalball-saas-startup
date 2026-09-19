import { redirect } from "next/navigation"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { requireSiteCapability } from "@/lib/auth/require-capability"
import { createClient } from "@/lib/supabase/server"

import { CreateUserForm, type WizardOptions } from "./create-user-form"

export const metadata = { title: "Create User" }

export default async function CreateUserPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  // site.users.create is held by SITE_FULL alone. This decides whether the
  // page renders; site_register_created_identity decides whether anything
  // happens, and asks the same question again.
  const allowed = await requireSiteCapability(supabase, "site.users.create")
  if (!allowed.ok) redirect("/admin/users")

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Create User</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        For somebody who needs an Ovalball account but has no way to make one themselves. They receive a setup link by
        email and choose their own password and authenticator — you never see either, and there is no link to copy.
      </p>

      <CreateUserForm options={await loadWizardOptions(supabase)} />

      <p className="mt-6 text-xs text-ink-muted">
        Looking for somebody who already has an account?{" "}
        <Link href="/admin/users" className="underline">
          Users &amp; Access
        </Link>
      </p>
    </div>
  )
}

/**
 * SLICE 7e (S7-6). AB.4's Assignments step needs the same catalogues the Users &
 * Access tabs use, loaded on the server so the browser never has to be trusted
 * with "which clubs exist". Every one of these reads through ordinary RLS; none
 * of them is authority, and the RPC re-decides each assignment on its own
 * capability regardless of what this form offered.
 */
async function loadWizardOptions(supabase: Awaited<ReturnType<typeof createClient>>): Promise<WizardOptions> {
  const [clubRows, teamRows, playerRows, roleRows] = await Promise.all([
    supabase.from("clubs").select("id, club_directory(name)"),
    supabase.from("teams").select("id, display_name, clubs(club_directory(name))").eq("active", true),
    supabase.from("players").select("id, first_name, surname").eq("active", true).limit(500),
    supabase.from("role_definitions").select("role_key, label, scope").eq("visible", true),
  ])

  const roles = roleRows.data ?? []
  return {
    clubs: (clubRows.data ?? []).map((row) => ({
      id: row.id,
      name: (row.club_directory as { name: string } | null)?.name ?? "(unnamed club)",
    })),
    teams: (teamRows.data ?? []).map((row) => ({
      id: row.id,
      name: row.display_name ?? "(unnamed team)",
      clubName: ((row.clubs as { club_directory: { name: string } | null } | null)?.club_directory?.name) ?? "",
    })),
    players: (playerRows.data ?? []).map((row) => ({
      id: row.id,
      name: [row.first_name, row.surname].filter(Boolean).join(" "),
    })),
    // A CLUB_OR_TEAM role (Volunteer) legitimately belongs in both lists.
    clubRoles: roles.filter((r) => r.scope === "CLUB" || r.scope === "CLUB_OR_TEAM").map((r) => ({ key: r.role_key, label: r.label })),
    teamRoles: roles.filter((r) => r.scope === "TEAM" || r.scope === "CLUB_OR_TEAM").map((r) => ({ key: r.role_key, label: r.label })),
  }
}
