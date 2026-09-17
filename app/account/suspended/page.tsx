import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"

import { SuspendedSignOutButton } from "./sign-out-button"

export const metadata = { title: "Account Suspended" }

/**
 * THE SUSPENDED LANDING (Phase 2 D.2, third destination).
 *
 * A suspended account can still authenticate -- Ovalball has no service-role key in the app, so it
 * never disables the login itself -- but every protected action fails, because
 * internal.is_account_active() is composed into the resolver chain almost every write policy funnels
 * through. Without this page that person saw a 404 or a broken dashboard and had no idea why.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO
 *
 * It does not say who suspended the account, when, or why. `profiles.state_reason` is written for the
 * administrator who will read the audit trail, not for the person it is about, and repeating it here
 * could disclose a safeguarding matter to the subject of it. It says the account is suspended, that
 * the club or Ovalball can explain, and offers the way out of the session. Sign out is offered
 * because leaving somebody signed in to an account that can do nothing is its own trap.
 *
 * DISABLED lands here too. The distinction between suspended and disabled is meaningful to an
 * administrator and not to the person locked out, and spelling it out would only invite them to argue
 * about the wrong word.
 */
export default async function AccountSuspendedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_state")
    .eq("id", user.id)
    .maybeSingle()

  // Not suspended: do not hold anybody on a page about a state they are not in.
  if (profile && profile.account_state !== "SUSPENDED" && profile.account_state !== "DISABLED") {
    redirect("/dashboard")
  }

  return (
    <AuthShell
      eyebrow="Account"
      title="Your account is suspended"
      subtitle="You can sign in, but you can't do anything until it's lifted."
      panelLine="The season doesn't organise itself."
    >
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-relaxed text-ink/70">
          Nothing has been deleted. Your club membership, teams and history are all still there, and
          they come back exactly as they were when the suspension is lifted.
        </p>
        <p className="text-[15px] leading-relaxed text-ink/70">
          If you don&rsquo;t know why, speak to whoever runs your club. If they can&rsquo;t help,
          Ovalball support can.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {/* /public-support, not /support: the latter is inside the authenticated application
              group, which is the part of the product this person is being kept out of. */}
          <Button variant="outline" className="h-11" nativeButton={false} render={<a href="/public-support" />}>
            Contact Support
          </Button>
          <SuspendedSignOutButton />
        </div>
      </div>
    </AuthShell>
  )
}
