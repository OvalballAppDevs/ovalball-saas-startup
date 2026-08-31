import { redirect } from "next/navigation"

import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { SignOutButton } from "./sign-out-button"

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Account</p>
      <h1 className="mt-2 font-display text-display-l text-ink">{ctx.firstName ?? "Your account"}</h1>
      <p className="mt-1 text-sm text-ink/50">{user.email}</p>

      {(ctx.clubMemberships.length > 0 || ctx.teamPermissions.length > 0) && (
        <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
          <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Your roles</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink/70">
            {ctx.clubMemberships
              .filter((m) => m.role !== "BASIC_USER")
              .map((m) => (
                <li key={m.clubId}>
                  {m.clubName} — {m.role === "CLUB_ADMIN" ? "Club Admin" : "Fixture Secretary"}
                </li>
              ))}
            {ctx.teamPermissions.map((tp) => (
              <li key={tp.teamId}>
                {tp.teamDisplayName} — {tp.permission}
              </li>
            ))}
            {ctx.isSiteAdmin && <li>Site Admin</li>}
          </ul>
        </div>
      )}

      <div className="mt-8">
        <SignOutButton />
      </div>
    </div>
  )
}
