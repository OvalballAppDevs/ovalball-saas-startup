import Link from "next/link"
import { redirect } from "next/navigation"
import { Building2, ChevronRight } from "lucide-react"

import { PageIdentity } from "@/components/shell/page-identity"
import { BODY_ROLE_LABEL, BODY_TYPE_LABEL, loadMyGoverningBodies } from "@/lib/governing/body"
import { createClient } from "@/lib/supabase/server"

/**
 * CONVERGENCE STEP 14 — where a governing body person lands.
 *
 * Deliberately a list and not a dashboard: Step 14 is the foundation, and a page full of numbers
 * nobody can act on yet would be a worse start than an honest one. Somebody with no governing-body
 * relationship never reaches here — the navigation does not offer it and the server returns nothing.
 */
export default async function GoverningBodiesPage() {
  const supabase = await createClient()
  const bodies = await loadMyGoverningBodies(supabase)

  // No relationship, no page. Not an error screen -- there is simply nothing here for them.
  if (bodies.length === 0) redirect("/dashboard")
  if (bodies.length === 1) redirect(`/governing/${bodies[0].bodyId}`)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <PageIdentity workspace="Governing Body" title="Your Rugby Organisations" className="mt-0" />
      <ul className="flex flex-col gap-2">
        {bodies.map((b) => (
          <li key={b.bodyId}>
            <Link
              href={`/governing/${b.bodyId}`}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 hover:bg-surface-muted"
            >
              <Building2 className="size-5 shrink-0 text-forest-800" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{b.canonicalName}</span>
                <span className="block text-xs text-ink-muted">
                  {BODY_TYPE_LABEL[b.bodyType] ?? b.bodyType} · you are {BODY_ROLE_LABEL[b.myRole]}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
