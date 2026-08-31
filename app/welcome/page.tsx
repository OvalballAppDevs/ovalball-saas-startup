import { CalendarDays, MessageSquare, ShieldCheck, Users } from "lucide-react"
import { redirect } from "next/navigation"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"
import { getPendingStatus } from "@/lib/signup/pending-status"

const LOCKED_AREAS = [
  { icon: CalendarDays, label: "Fixtures" },
  { icon: Users, label: "Teams" },
  { icon: ShieldCheck, label: "Partner Clubs" },
  { icon: MessageSquare, label: "Messages" },
]

/**
 * Where /auth/callback sends a newly-confirmed signup. This is the
 * "restricted/provisional Ovalball experience" for a user who can
 * authenticate but whose club access -- claim, join request, or new-club
 * proposal -- is still awaiting human review.
 *
 * The restriction here is presentational (this page simply doesn't render
 * any fixture/messaging/club-management UI), not the actual security
 * boundary: the real boundary is RLS. Even if a user found their way to
 * some other route, club_memberships has no self-serve INSERT (admin-only),
 * and every fixture-request/messaging/club-admin action this product will
 * eventually have is meant to check for an active club_memberships row --
 * this page has nothing to bypass that with, because there is nothing on
 * the client that grants authority in the first place.
 */
export default async function WelcomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/signup")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name")
    .eq("id", user.id)
    .maybeSingle()

  const { data: siteAdminRow } = await supabase
    .from("site_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle()

  const status = await getPendingStatus(supabase, user.id)

  // Approved (an active club_memberships row exists) or Site Admin: the
  // real authenticated product now exists behind /dashboard -- this page
  // is only for the pending/no-request states below.
  if (status.kind === "approved" || siteAdminRow) {
    redirect("/dashboard")
  }

  return (
    <main className="min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <OvalballLogo variant="light" />
      </div>

      <div className="mx-auto max-w-2xl px-4 py-16 md:py-24">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          Welcome to Ovalball
        </p>
        <h1 className="mt-3 font-display text-display-xl text-ink">
          {profile?.first_name ? `Hi ${profile.first_name}.` : "You're in."}
        </h1>

        {(status.kind === "claim-pending" ||
          status.kind === "join-pending" ||
          status.kind === "directory-pending") && (
          <div className="mt-8 flex flex-col gap-6">
            <div className="rounded-lg border border-ink/10 bg-white p-5">
              <p className="text-lg font-medium text-ink">{status.clubName}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="size-2 rounded-full bg-pitch-600" />
                <p className="text-sm font-medium text-forest-800">
                  Club access &mdash; Pending verification
                </p>
              </div>
              <p className="mt-3 max-w-md text-sm text-ink/60">
                {status.kind === "claim-pending" &&
                  `We're reviewing your request to act on behalf of ${status.clubName}.`}
                {status.kind === "join-pending" &&
                  `We've sent your access request to ${status.clubName}'s existing admins.`}
                {status.kind === "directory-pending" &&
                  `We're validating ${status.clubName} before it's added to the Ovalball directory.`}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">
                What happens next
              </p>
              <ol className="mt-3 flex flex-col gap-2 text-sm text-ink/70">
                <li>
                  1. Your account is confirmed &mdash; you can sign in any time.
                </li>
                <li>
                  2.{" "}
                  {status.kind === "join-pending"
                    ? "An existing verified Club Admin reviews your request."
                    : "Ovalball verifies your authority to act for this club."}
                </li>
                <li>3. Once approved, the areas below unlock automatically.</li>
              </ol>
            </div>

            <div>
              <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">
                Available after club approval
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {LOCKED_AREAS.map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 bg-white/60 px-3 py-5 text-center"
                  >
                    <Icon className="size-5 text-ink/30" />
                    <span className="text-sm text-ink/45">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {status.kind === "no-request" && (
          <p className="mt-8 max-w-md text-base text-ink/60">
            Your account is confirmed, but we don&apos;t have a club request
            on file yet. Head back to signup to finish that step.
          </p>
        )}
      </div>
    </main>
  )
}
