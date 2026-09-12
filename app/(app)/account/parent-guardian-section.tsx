import Link from "next/link"
import { ChevronRight, ShieldCheck, Users } from "lucide-react"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

/**
 * The Parent/Guardian entry inside Personal Settings.
 *
 * Settings for a Guardian means PERSONAL settings -- their own profile,
 * their own children, their own relationships -- never Club Settings, which
 * is a different scope belonging to a different authority. The five-link
 * nav's "Settings" points here for exactly that reason.
 *
 * Renders nothing at all for an account with no family relationship and no
 * approvals to make, rather than showing an empty section that implies a
 * capability the viewer does not have.
 */
export async function ParentGuardianSection({ supabase, userId }: { supabase: SupabaseClient<Database>; userId: string }) {
  const [{ count: childCount }, { data: approvals }, { data: myRequests }] = await Promise.all([
    supabase.from("guardians").select("id", { count: "exact", head: true }).eq("guardian_user_id", userId).eq("status", "active"),
    supabase.rpc("guardian_link_requests_for_approval"),
    supabase.rpc("my_guardian_link_requests"),
  ])

  const children = childCount ?? 0
  const awaitingMyDecision = (approvals ?? []).length
  const myPending = (myRequests ?? []).filter((r) => r.status === "PENDING").length

  if (children === 0 && awaitingMyDecision === 0 && myPending === 0) return null

  return (
    <section className="mt-6" aria-labelledby="parent-guardian-heading">
      <h2 id="parent-guardian-heading" className="font-display text-lg text-ink">
        Parent / Guardian
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Your children, their pictures, and who else can see them.</p>

      <div className="mt-3 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
        <Link
          href="/parent/children"
          className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          <span className="flex items-center gap-3">
            <Users className="size-4 shrink-0 text-forest-800" aria-hidden="true" />
            <span>
              <span className="block text-sm text-ink">Your children</span>
              <span className="block text-sm text-ink-muted">
                {children === 0
                  ? "Add a child, or check a request you've submitted"
                  : `${children} ${children === 1 ? "child" : "children"} · pictures, access and guardians`}
                {myPending > 0 && ` · ${myPending} awaiting verification`}
              </span>
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </Link>

        {/* Only shown when there is genuinely something to decide -- the
            queue is scoped by the database, so an empty list here means
            this person is not an approver for anything right now. */}
        {awaitingMyDecision > 0 && (
          <Link
            href="/guardian-requests"
            className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
          >
            <span className="flex items-center gap-3">
              <ShieldCheck className="size-4 shrink-0 text-forest-800" aria-hidden="true" />
              <span>
                <span className="block text-sm text-ink">Guardian requests</span>
                <span className="block text-sm text-ink-muted">
                  {awaitingMyDecision} awaiting your decision
                </span>
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  )
}
