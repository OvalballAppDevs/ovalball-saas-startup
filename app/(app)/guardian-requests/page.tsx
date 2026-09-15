import { redirect } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { createClient } from "@/lib/supabase/server"

import { DecisionControls } from "./decision-controls"

export const dynamic = "force-dynamic"
export const metadata = { title: "Guardian Requests" }

/**
 * Where a guardian relationship is actually granted.
 *
 * The queue is scoped by the database, not by this page:
 * guardian_link_requests_for_approval() returns only rows the caller may
 * decide -- an existing active guardian of that specific child, or a Club
 * Admin holding club.guardians.manage at that specific club. A viewer with
 * neither sees an empty list, and every decision re-checks the same
 * authority again at the moment it is made.
 *
 * The page is deliberately reachable by both audiences rather than being
 * duplicated into a parent-facing and a club-facing copy: it is one queue,
 * and two implementations would eventually disagree about who may approve.
 */
export default async function GuardianRequestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: requests } = await supabase.rpc("guardian_link_requests_for_approval")
  const rows = requests ?? []

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-forest-800" aria-hidden="true" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Safeguarding</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Guardian Requests</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        Someone has asked to be recognised as a parent or guardian. Approving one gives that adult access to the child&rsquo;s fixtures, training and
        attendance. Nothing is granted until you decide.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink/10 bg-white px-5 py-8 text-center">
          <p className="font-display text-base text-ink">Nothing waiting</p>
          <p className="mt-1 text-sm text-ink-muted">Requests you&rsquo;re able to decide will appear here.</p>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.request_id} className="rounded-lg border border-ink/10 bg-white px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-base text-ink">
                  {r.kind === "ADDITIONAL_GUARDIAN" ? r.target_player_name : `${r.submitted_first_name} ${r.submitted_surname}`}
                </p>
                <p className="text-xs text-ink-subtle">{r.club_name}</p>
              </div>

              <dl className="mt-3 divide-y divide-ink/8 rounded-md border border-ink/10">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-sm text-ink-muted">Requested by</dt>
                  <dd className="text-sm text-ink">
                    {r.kind === "ADDITIONAL_GUARDIAN" ? (r.invited_email ?? r.requester_name) : r.requester_name}
                  </dd>
                </div>
                {r.kind !== "ADDITIONAL_GUARDIAN" && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <dt className="text-sm text-ink-muted">Date of birth given</dt>
                    <dd className="font-mono text-sm text-ink">{r.submitted_date_of_birth}</dd>
                  </div>
                )}
                {/* The evidence a human is actually judging. The applicant
                    cannot see this line -- telling an unverified adult that
                    a specific child exists here is exactly what the request
                    model is built to prevent. */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-sm text-ink-muted">Existing player</dt>
                  <dd className="text-sm text-ink">
                    {r.kind === "SELF_ADDED_CHILD" ? (
                      <span className="text-ink-subtle">Added by this parent — waiting for you to confirm the relationship</span>
                    ) : r.matched_player_id ? (
                      <>
                        {r.matched_player_name}
                        {r.matched_team_name ? ` · ${r.matched_team_name}` : ""}
                      </>
                    ) : (
                      <span className="text-ink-subtle">No match found — approving will create a new player</span>
                    )}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-sm text-ink-muted">
                {r.kind === "SELF_ADDED_CHILD"
                  ? "Approving confirms this adult is responsible for the child they added. Until then they cannot see the player."
                  : r.matched_player_id
                    ? "Approving links this adult to the existing player. No duplicate record is created."
                    : "Only approve if you can confirm this person is responsible for this child."}
              </p>

              {r.kind === "ADDITIONAL_GUARDIAN" && r.subject_response !== "ACCEPTED" ? (
                <p className="mt-3 text-sm text-ink-muted">
                  Waiting for {r.invited_email ?? "the other adult"} to accept. You can approve once they have; you can reject now.
                </p>
              ) : null}

              <div className="mt-3">
                <DecisionControls requestId={r.request_id} canApprove={r.kind !== "ADDITIONAL_GUARDIAN" || r.subject_response === "ACCEPTED"} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
