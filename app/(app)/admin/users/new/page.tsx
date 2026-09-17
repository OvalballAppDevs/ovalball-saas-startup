import { redirect } from "next/navigation"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { requireSiteCapability } from "@/lib/auth/require-capability"
import { createClient } from "@/lib/supabase/server"

import { CreateUserForm } from "./create-user-form"

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

      <CreateUserForm />

      <p className="mt-6 text-xs text-ink-muted">
        Looking for somebody who already has an account?{" "}
        <Link href="/admin/users" className="underline">
          Users &amp; Access
        </Link>
      </p>
    </div>
  )
}
