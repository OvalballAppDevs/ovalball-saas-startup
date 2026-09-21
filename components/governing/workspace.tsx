import Link from "next/link"
import type { ReactNode } from "react"

import { PageIdentity } from "@/components/shell/page-identity"
import { workspaceLabel } from "@/lib/app-context/workspace-label"
import { BODY_ROLE_LABEL, BODY_TYPE_LABEL, type GoverningBody } from "@/lib/governing/body"

/**
 * CONVERGENCE STEP 15 — the heading every Governing Body page wears.
 *
 * ONE COMPONENT BECAUSE THERE IS ONE ANSWER. Four pages have to say which organisation this is, and
 * four copies of that sentence is four chances for them to disagree — which is the defect the Match
 * Centre convergence rule exists to prevent, applied to a smaller surface.
 *
 * WHY THE ORGANISATION IS NAMED ON EVERY PAGE and not only on the Overview: the person reading it is
 * very often also a Club Admin somewhere, and "Clubs" as a bare page title is a word that belongs to
 * both jobs. The line underneath is what makes it unambiguous which one they are doing.
 */
export function GoverningPageHeader({
  body,
  title,
  description,
  action,
}: {
  body: GoverningBody
  /** What this page IS — "Clubs", "Competitions", "People & Access". The Overview passes the organisation's own name, because the Overview IS the organisation. */
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  const isOverview = title === body.canonicalName
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <PageIdentity workspace={workspaceLabel("governing")} title={title} className="mt-0" description={description} />
        {/* On a sub-page, which organisation. On the Overview the heading already said it, so this
            says what KIND of organisation instead — the useful second fact rather than a repeat. */}
        <p className="mt-2 text-sm text-ink-muted">
          {isOverview ? (
            <>
              {BODY_TYPE_LABEL[body.bodyType] ?? body.bodyType} · {body.rugbyCode === "union" ? "Rugby Union" : "Rugby League"} ·{" "}
              {body.nation}
            </>
          ) : (
            <Link href={`/governing/${body.bodyId}`} className="underline decoration-line hover:decoration-ink">
              {body.canonicalName}
            </Link>
          )}
          {body.myRole ? <> · you are {BODY_ROLE_LABEL[body.myRole]}</> : <> · you are seeing this as a Site Admin</>}
        </p>
      </div>
      {action}
    </div>
  )
}

/** A titled region. Every page here is a stack of these, so they are spaced and headed identically. */
export function GoverningSection({
  id,
  title,
  icon,
  count,
  action,
  children,
}: {
  id: string
  title: string
  /** Decorative. Nothing here is carried by icon alone. */
  icon?: ReactNode
  /** A real count, or nothing. Never a made-up metric to fill the space. */
  count?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="flex items-center gap-2 font-display text-base text-ink">
          {icon}
          {title}
        </h2>
        {count && <p className="text-sm text-ink-muted">{count}</p>}
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * An empty state that says what would put something here.
 *
 * "No competitions" tells somebody nothing they had not worked out. What they need is the next step, or
 * the honest reason there is no next step for them.
 */
export function GoverningEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-surface-muted px-3 py-6 text-center text-sm text-ink-muted">{children}</p>
}
