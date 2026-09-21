import { notFound } from "next/navigation"
import { Building2 } from "lucide-react"

import { GoverningEmpty, GoverningPageHeader, GoverningSection } from "@/components/governing/workspace"
import { loadAffiliatedClubs, loadGoverningBody } from "@/lib/governing/body"
import { createClient } from "@/lib/supabase/server"

import { AffiliatedClubList } from "./club-list"

export const metadata = { title: "Clubs" }

/**
 * CONVERGENCE STEP 15 — THE AFFILIATED CLUBS.
 *
 * AFFILIATION IS NOT AUTHORITY, and this page is where that has to be visible rather than merely true.
 * A county officer may legitimately look up which clubs belong to their organisation, where they play
 * and how to reach them — all of it the Club Directory's own public identity data. They may not reach
 * a club's members, players, fixtures, settings or safeguarding records, and there is no link here that
 * would take them anywhere near one. The club link goes to the club's PUBLIC home, which is the same
 * page any visitor sees.
 *
 * AFFILIATION IS READ-ONLY, and the page says so plainly rather than offering a control that cannot
 * honour what it implies. `club_directory.constituent_body_id` is a nullable column with no effective
 * date, no history and no evidence: a control here could change which county a club belongs to and
 * would silently rewrite what was true last season as well. The lifecycle that would make it safe —
 * request, approve, transfer, suspend, effective from — is recorded for Step 16.
 */
export default async function GoverningBodyClubsPage({ params }: { params: Promise<{ bodyId: string }> }) {
  const { bodyId } = await params
  const supabase = await createClient()
  const body = await loadGoverningBody(supabase, bodyId)
  if (!body) notFound()
  const clubs = await loadAffiliatedClubs(supabase, bodyId)

  const onOvalball = clubs.filter((c) => c.isOnOvalball).length

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <GoverningPageHeader
        body={body}
        title="Clubs"
        description="The clubs published as belonging to this organisation, as the Club Directory records them."
      />

      <GoverningSection
        id="gb-club-list"
        title="Affiliated Clubs"
        icon={<Building2 className="size-4 text-ink-muted" aria-hidden="true" />}
        count={clubs.length > 0 ? `${clubs.length} · ${onOvalball} on Ovalball` : undefined}
      >
        {clubs.length === 0 ? (
          <GoverningEmpty>
            No clubs are recorded as affiliated to this organisation. Affiliation is held on each club&apos;s own Club
            Directory record.
          </GoverningEmpty>
        ) : (
          <AffiliatedClubList clubs={clubs} />
        )}
      </GoverningSection>

      <section aria-labelledby="gb-affiliation" className="rounded-2xl border border-dashed border-line px-4 py-3">
        <h2 id="gb-affiliation" className="text-sm font-medium text-ink">
          Where This List Comes From
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Which clubs belong to a constituent body is <strong className="font-medium text-ink">published by the
          governing body itself</strong>, and Ovalball records it: the Club Directory holds each club&apos;s county
          beside the club, acquired from the county unions&apos; own club lists with the source and the date it was
          checked. It is reference data, in the same way the organisation&apos;s own name and code are.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          So there is deliberately nothing here that affiliates or un-affiliates a club. A county does not invite a
          club to belong to it — the published structure says which county a club is in, and a control that
          overwrote that would also silently rewrite what was true last season. If this list is wrong, it is the
          reference data that needs correcting, and Ovalball maintains it.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          A club appearing here does not give this organisation access to that club&apos;s members, players, fixtures
          or settings.
        </p>
      </section>
    </div>
  )
}
