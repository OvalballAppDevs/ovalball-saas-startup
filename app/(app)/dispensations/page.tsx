import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { readDispensationRegister, type DispensationRecord } from "@ovalball/contracts/team/dispensation"

import { DispensationRegister } from "@/components/dispensations/dispensation-register"
import { PageIdentity } from "@/components/shell/page-identity"
import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { workspaceLabel } from "@/lib/app-context/workspace-label"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dispensations" }

/**
 * THE CLUB'S DISPENSATIONS (20270742000000) -- the register for the people who read every one of them: the
 * club's Safeguarding Officer, its Club Admins and its Fixtures Secretary. Pending first; each row opens the
 * record, where the officer and the Club Admins decide. The server refuses the register to anybody else,
 * which reads here as a sentence, never an error screen. Before this page the website had no officer view:
 * an officer told about a dispensation landed on Player Moves, which turned them away.
 */
export default async function DispensationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const active = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = active?.clubId ?? null

  let records: DispensationRecord[] | null = null
  if (clubId) {
    records = await readDispensationRegister(supabase as unknown as Parameters<typeof readDispensationRegister>[0], clubId).catch(() => null)
  }

  const waiting = (records ?? []).filter((r) => r.status === "requested" && r.viewer.decidesAs).length
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <PageIdentity
        workspace={workspaceLabel("club")}
        title="Dispensations"
        description={
          records
            ? waiting > 0
              ? `${waiting === 1 ? "One request is" : `${waiting} requests are`} waiting for your decision.`
              : "Every age-grade exception at the club, and who decided it."
            : undefined
        }
      />
      <div className="mt-6">
        {records ? (
          <DispensationRegister records={records} emptyText="No dispensations yet. A request appears here the moment somebody asks." />
        ) : (
          <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-sm text-ink-muted">
            The club&apos;s dispensations are for its Safeguarding Officer, its Club Admins and its Fixtures Secretary. Switch to the club you look
            after them for.
          </p>
        )}
      </div>
    </div>
  )
}
