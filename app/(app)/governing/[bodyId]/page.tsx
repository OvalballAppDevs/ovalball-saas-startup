import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangle, ArrowRight, BookOpen, Building2, CheckCircle2, ExternalLink, Trophy, Users } from "lucide-react"

import { GoverningEmpty, GoverningPageHeader, GoverningSection } from "@/components/governing/workspace"
import {
  competitionProgress,
  loadAffiliatedClubs,
  loadBodyCompetitions,
  loadBodyInvitations,
  loadBodyPeople,
  loadGoverningBody,
} from "@/lib/governing/body"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Governing Body Overview" }

/**
 * CONVERGENCE STEP 15 — THE GOVERNING BODY OVERVIEW.
 *
 * Step 14's version answered "who is this organisation". This one has to answer the question a person
 * actually opens a workspace home to ask: WHAT DO I NEED TO DO?
 *
 * WHY THERE ARE NO DASHBOARD METRICS. Every number on this page is one somebody can act on — teams not
 * yet entered, matches drawn but not issued, a competition with no season. There is no chart, no
 * percentage and no trend, because a county officer cannot do anything with any of those and inventing
 * them would be the decorative version of a product.
 *
 * NEEDS ATTENTION IS DERIVED, NEVER STORED. It is computed from the same three reads the rest of the
 * page uses, so it can never disagree with what is below it — the failure mode of a summary that is
 * maintained separately from the thing it summarises.
 */
export default async function GoverningBodyOverviewPage({ params }: { params: Promise<{ bodyId: string }> }) {
  const { bodyId } = await params
  const supabase = await createClient()

  // The server refuses a viewer with no relationship, so "nothing" here means "not yours", never
  // "hidden in the browser".
  const body = await loadGoverningBody(supabase, bodyId)
  if (!body) notFound()

  const [clubs, competitions, people, invitations] = await Promise.all([
    loadAffiliatedClubs(supabase, bodyId),
    loadBodyCompetitions(supabase, bodyId),
    loadBodyPeople(supabase, bodyId),
    loadBodyInvitations(supabase, bodyId),
  ])

  /**
   * WHAT ACTUALLY NEEDS ATTENTION. Each item names the thing, says why, and goes where it is fixed.
   *
   * A competition with no season is first because it is the one state the canonical season register
   * produces rather than the organisation: Ovalball will not guess a season, so a competition created
   * before the register has one waits here rather than being silently filed under a computed year.
   */
  const attention: { key: string; text: string; href: string; cta: string }[] = []
  for (const c of competitions.filter((c) => c.active)) {
    if (!c.editionId) {
      attention.push({
        key: `season-${c.competitionId}`,
        text: `${c.name} has no season yet, because no current or upcoming season is registered for this rugby code.`,
        href: `/governing/${bodyId}/competitions`,
        cta: "Competitions",
      })
    } else if (c.enteredCount === 0) {
      attention.push({
        key: `entrants-${c.competitionId}`,
        text: `${c.name} has no teams entered for ${c.seasonName}.`,
        href: c.canOrganise ? `/fixtures/competitions/${c.editionId}/participants` : `/governing/${bodyId}/competitions`,
        cta: c.canOrganise ? "Enter teams" : "Competitions",
      })
    } else if (c.matchCount === 0) {
      attention.push({
        key: `draw-${c.competitionId}`,
        text: `${c.name} has ${c.enteredCount} teams entered and no matches drawn.`,
        href: c.canOrganise ? `/fixtures/competitions/${c.editionId}/fixtures` : `/governing/${bodyId}/competitions`,
        cta: c.canOrganise ? "Draw the matches" : "Competitions",
      })
    }
  }
  // CONVERGENCE STEP 16 -- two states that now genuinely exist, and nothing else.
  //
  // §24: Needs Attention is derived from the same canonical reads the destination pages use, and it only
  // grows when the underlying state grows. An invitation waiting to be accepted is a real
  // access_invitations row; a match a club has not answered is a real competition_match_verifications
  // row. Neither is an analytic.
  const expiringSoon = invitations.filter((i) => i.expiresSoon)
  if (body.canManage && expiringSoon.length > 0) {
    attention.push({
      key: "invites-expiring",
      text: `${expiringSoon.length} ${expiringSoon.length === 1 ? "invitation expires" : "invitations expire"} within three days and ${expiringSoon.length === 1 ? "has" : "have"} not been accepted.`,
      href: `/governing/${bodyId}/people`,
      cta: "People & Access",
    })
  }

  // ONE ADMINISTRATOR IS AN OPERATIONAL RISK, not a tidiness complaint: a volunteer organisation whose
  // only administrator stands down has nobody who can restore access, and the way back is a Site Admin
  // repair. Only said to the person who can do something about it.
  const admins = people.filter((p) => p.roleKey === "BODY_ADMIN" && p.state === "ACTIVE")
  if (body.canManage && admins.length === 1) {
    attention.push({
      key: "sole-admin",
      text: "You are the only administrator here. If you stand down, nobody at this organisation can give access back.",
      href: `/governing/${bodyId}/people`,
      cta: "People & Access",
    })
  }
  if (clubs.length === 0) {
    attention.push({
      key: "no-clubs",
      text: "No clubs are recorded as affiliated to this organisation.",
      href: `/governing/${bodyId}/clubs`,
      cta: "Clubs",
    })
  }

  const active = competitions.filter((c) => c.active)
  // PLAIN /rugby-hub, and no ?code= parameter. Rugby Hub resolves the rugby code from the READER'S own
  // identity and takes no such parameter -- passing one would have looked like filtering and done
  // nothing. The sentence below therefore says what the link actually does.

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <GoverningPageHeader body={body} title={body.canonicalName} />

      {/* WHAT NEEDS DOING. First, because it is the reason to open the page. */}
      {attention.length > 0 ? (
        <GoverningSection
          id="gb-attention"
          title="Needs Attention"
          icon={<AlertTriangle className="size-4 text-amber-700" aria-hidden="true" />}
          count={`${attention.length} ${attention.length === 1 ? "item" : "items"}`}
        >
          <ul className="flex flex-col divide-y divide-line">
            {attention.map((a) => (
              <li key={a.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                <p className="min-w-0 flex-1 text-sm text-ink">{a.text}</p>
                <Link href={a.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-forest-800 hover:underline">
                  {a.cta}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </GoverningSection>
      ) : (
        <GoverningSection
          id="gb-attention"
          title="Needs Attention"
          icon={<CheckCircle2 className="size-4 text-forest-800" aria-hidden="true" />}
        >
          <p className="text-sm text-ink-muted">
            Nothing needs your attention here. Competitions with teams to enter or matches to draw, and invitations
            about to expire unaccepted, would appear in this list.
          </p>
        </GoverningSection>
      )}

      {/* THE THREE JOBS. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <GoverningSection
          id="gb-competitions"
          title="Competitions"
          icon={<Trophy className="size-4 text-ink-muted" aria-hidden="true" />}
          count={active.length > 0 ? `${active.length} running` : undefined}
        >
          {active.length === 0 ? (
            <GoverningEmpty>
              {body.canManageCompetitions
                ? "This organisation runs no competitions on Ovalball yet. A county league or cup starts here."
                : "This organisation runs no competitions on Ovalball yet."}
            </GoverningEmpty>
          ) : (
            <ul className="flex flex-col gap-2">
              {active.slice(0, 4).map((c) => (
                <li key={c.competitionId} className="min-w-0">
                  <Link href={`/governing/${bodyId}/competitions`} className="block truncate text-sm font-medium text-ink hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-ink-muted">{competitionProgress(c)}</p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/governing/${bodyId}/competitions`}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forest-800 hover:underline"
          >
            {active.length === 0 && body.canManageCompetitions ? "Start a competition" : "All Competitions"}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </GoverningSection>

        <GoverningSection
          id="gb-clubs"
          title="Clubs"
          icon={<Building2 className="size-4 text-ink-muted" aria-hidden="true" />}
          count={clubs.length > 0 ? `${clubs.length} affiliated` : undefined}
        >
          {clubs.length === 0 ? (
            <GoverningEmpty>
              No clubs are recorded as affiliated. Affiliation is held on each club&apos;s own Club Directory record and
              is maintained by Ovalball.
            </GoverningEmpty>
          ) : (
            <p className="text-sm text-ink-muted">
              {clubs.filter((c) => c.isOnOvalball).length} of {clubs.length} are on Ovalball, so their fixtures, teams
              and results are here too.
            </p>
          )}
          <Link
            href={`/governing/${bodyId}/clubs`}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forest-800 hover:underline"
          >
            All Clubs
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </GoverningSection>

        <GoverningSection
          id="gb-people"
          title="People & Access"
          icon={<Users className="size-4 text-ink-muted" aria-hidden="true" />}
          count={
            invitations.length > 0
              ? `${people.length} · ${invitations.length} invited`
              : `${people.length} ${people.length === 1 ? "person" : "people"}`
          }
        >
          <p className="text-sm text-ink-muted">
            {body.canManage
              ? "Who can act for this organisation, and what each of them may do. Invite somebody with their email address — they do not need an Ovalball account yet."
              : "Who can act for this organisation. Only an administrator here can change it."}
          </p>
          <Link
            href={`/governing/${bodyId}/people`}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forest-800 hover:underline"
          >
            {body.canManage ? "Manage Access" : "See Who Has Access"}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </GoverningSection>

        {/* REGULATION IS KNOWLEDGE, NOT AN OPERATION THIS ORGANISATION PERFORMS.
            It is a link rather than a destination of its own, and it is deliberately read-only. A
            constituent body is not a regulatory authority: `regulatory_authorities` holds the RFU, the
            RFL, World Rugby and International Rugby League, and a county union has no row in it. A
            county operates under its union's regulations; it does not publish them. */}
        <GoverningSection id="gb-rugby" title="Rugby & Regulation" icon={<BookOpen className="size-4 text-ink-muted" aria-hidden="true" />}>
          <p className="text-sm text-ink-muted">
            Age grades, laws and safeguarding guidance, from the published regulations of{" "}
            {body.rugbyCode === "league" ? "the Rugby Football League" : "the Rugby Football Union"}. This organisation
            reads them; it does not set them.
          </p>
          <Link href="/rugby-hub" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forest-800 hover:underline">
            Rugby Hub
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </GoverningSection>
      </div>

      {/* THE ORGANISATION RECORD. Last, because it is reference rather than work -- but it earns its
          place: this is verified data about a real organisation and where it came from is checkable. */}
      <section aria-labelledby="gb-record" className="rounded-2xl border border-dashed border-line px-4 py-3">
        <h2 id="gb-record" className="text-sm font-medium text-ink">
          This Organisation&apos;s Record
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {body.canonicalName}
          {body.shortName && body.shortName !== body.canonicalName ? ` (${body.shortName})` : ""} is recorded as{" "}
          {(BODY_TYPE_LABEL_LOWER[body.bodyType] ?? body.bodyType).toLowerCase()} in {body.nation}.
          {body.sourceUrl ? (
            <>
              {" "}
              Held from{" "}
              <a href={body.sourceUrl} className="underline hover:no-underline" rel="noreferrer noopener" target="_blank">
                its own listing <ExternalLink className="inline size-3" aria-hidden="true" />
              </a>
              {body.sourceCheckedOn ? `, checked ${body.sourceCheckedOn}` : ""}.
            </>
          ) : null}{" "}
          Its name and affiliations are maintained by Ovalball, so they say the same thing everywhere.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Welfare oversight and messaging as an organisation are not built yet, and neither is changing which clubs are
          affiliated from here.
        </p>
      </section>
    </div>
  )
}

/** The body type as it reads mid-sentence ("is recorded as a county union"), not as a card label. */
const BODY_TYPE_LABEL_LOWER: Record<string, string> = {
  GEOGRAPHIC: "a county union",
  ARMED_FORCES: "an armed forces union",
  UNIVERSITY: "a university union",
  SCHOOLS: "a schools union",
  REFEREES: "a referees' society",
}
