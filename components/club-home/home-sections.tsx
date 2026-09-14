import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowUpRight, BookOpen, Megaphone } from "lucide-react"

import { RugbyKit, describeKit } from "@/components/club/rugby-kit"
import { HUB_GROUPS } from "@/components/rugby-hub/nav/hub-nav-groups"
import type { PublicClub } from "@/lib/club-public/club"
import { shortMatchDate } from "@/lib/club-public/format"
import type { ClubAnnouncement } from "@/lib/club-public/announcements"
import type { ClubTeamGroup } from "@/lib/club-public/load-club-home"
import { OUTCOME_WORD, type ClubResult } from "@/lib/club-public/matches"
import { cn } from "@/lib/utils"

import { BUTTON_SOLID, EmptyState, FOCUS_LIGHT, SectionHeading, Tag, TEXT_LINK } from "./primitives"

// ----------------------------------------------------------------------------
// Announcements
// ----------------------------------------------------------------------------

/**
 * Short notices, most urgent first. The priority is a word on every notice --
 * "Urgent", "Important" -- with a heavier edge as support, never instead.
 * A longer notice folds its detail away so the board stays scannable.
 */
export function AnnouncementBoard({ announcements }: { announcements: ClubAnnouncement[] }) {
  if (announcements.length === 0) return null
  return (
    <section aria-labelledby="announcements" className="mx-auto max-w-6xl px-4 pt-12 md:px-8">
      <h2 id="announcements" className="sr-only">
        Announcements
      </h2>
      <ul className="grid gap-3">
        {announcements.map((a) => (
          <li key={a.id}>
            <AnnouncementItem announcement={a} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * One notice. Shared by the public board and the signed-in club desk, so a
 * notice reads the same wherever someone meets it.
 */
export function AnnouncementItem({ announcement: a, compact = false }: { announcement: ClubAnnouncement; compact?: boolean }) {
  const long = (a.body?.length ?? 0) > (compact ? 90 : 160)
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white",
        compact ? "px-4 py-3" : "px-5 py-4",
        a.priority === "URGENT" ? "border-2 border-(--club-solid)" : a.priority === "IMPORTANT" ? "border-(--club-solid)" : "border-ink/10"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Megaphone aria-hidden="true" className={cn("size-4", a.priority === "URGENT" ? "text-destructive-text" : "text-(--club-ink)")} />
        <Tag tone={a.priority === "NORMAL" ? "neutral" : "strong"}>{a.priorityLabel}</Tag>
        {a.teamName && <Tag>{a.teamName}</Tag>}
        {a.membersOnly && <Tag>Members</Tag>}
      </div>
      <p className={cn("mt-2 font-semibold text-ink", compact && "text-sm")}>{a.title}</p>
      {a.body && !long && <p className="mt-1 text-sm leading-relaxed text-ink/75">{a.body}</p>}
      {a.body && long && (
        <details className="group mt-1">
          <summary className={cn(FOCUS_LIGHT, "cursor-pointer rounded-sm text-sm font-semibold text-(--club-ink)")}>Read the full notice</summary>
          <p className="mt-2 text-sm leading-relaxed text-ink/75">{a.body}</p>
        </details>
      )}
      {a.link && (
        <a
          href={a.link.href}
          {...(a.link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={cn(TEXT_LINK, "mt-2 inline-flex items-center gap-1 text-sm")}
        >
          {a.link.label}
          {a.link.external && (
            <>
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </>
          )}
        </a>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Results
// ----------------------------------------------------------------------------

export function ResultList({ results, includesMemberView }: { results: ClubResult[]; includesMemberView: boolean }) {
  if (results.length === 0) {
    return (
      <EmptyState title="No results yet">
        Scores appear here after matches are played and the result is recorded.
      </EmptyState>
    )
  }
  return (
    <>
      <ul className="divide-y divide-ink/8 overflow-hidden rounded-2xl border border-ink/10 bg-white">
        {results.map((r) => {
          const row = (
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm text-ink-muted">
                  <time dateTime={r.date}>{shortMatchDate(r.date)}</time>
                  {r.venueRole ? `, ${r.venueRole}` : ""}
                  {r.competition ? `, ${r.competition.name}` : ""}
                </p>
                <p className="mt-0.5 font-semibold text-ink">
                  {r.teamLabel} <span className="font-normal text-ink-muted">v</span> {r.opposition}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl leading-none text-ink tabular-nums">
                  {r.clubScore}–{r.oppositionScore}
                </p>
                <p className="mt-1 text-xs font-semibold text-ink/75">{OUTCOME_WORD[r.outcome]}</p>
              </div>
            </div>
          )
          return (
            <li key={r.key}>
              {r.href ? (
                <Link href={r.href} className={cn(FOCUS_LIGHT, "block -outline-offset-2 hover:bg-(--club-tint)")}>
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          )
        })}
      </ul>
      {includesMemberView && (
        <p className="mt-3 text-sm text-ink-muted">Some of these results are shown because you are signed in with access to those fixtures.</p>
      )}
    </>
  )
}

// ----------------------------------------------------------------------------
// Teams
// ----------------------------------------------------------------------------

export function TeamsSection({ groups }: { groups: ClubTeamGroup[] }) {
  return (
    <section aria-labelledby="teams">
      <SectionHeading id="teams" title="Teams" description="Every side the club runs, from its youngest players up." />
      <div className="mt-6">
        {groups.length === 0 ? (
          <EmptyState title="Teams are on their way">The club&apos;s teams will appear here once they have been set up.</EmptyState>
        ) : (
          <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {groups.map((g) => (
              <div key={g.key}>
                <h3 className="border-b border-ink/10 pb-2 text-sm font-semibold text-ink">{g.title}</h3>
                <ul className="mt-3 grid gap-3">
                  {g.teams.map((t) => (
                    <li key={t.id} className="rounded-xl border border-ink/10 bg-white px-4 py-3">
                      <p className="font-semibold text-ink">{t.name}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {t.nextMatch ? `Next: v ${t.nextMatch.opposition}, ${shortMatchDate(t.nextMatch.date)}` : "No fixture published yet"}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Rugby Hub
// ----------------------------------------------------------------------------

/**
 * The Rugby Hub, advertised properly. Destinations come from the Hub's own
 * live navigation (HUB_GROUPS), so nothing here can point at a section that
 * does not exist. The Hub is part of the signed-in product, and the copy says
 * so rather than letting a visitor discover it at a login screen.
 */
const HUB_FEATURED = ["/rugby-hub/game", "/rugby-hub/positions", "/rugby-hub/glossary", "/rugby-hub/skills", "/rugby-hub/coaching", "/rugby-hub/parents"]

export function RugbyHubFeature({ clubName, signedIn }: { clubName: string; signedIn: boolean }) {
  const destinations = HUB_FEATURED.map((href) => HUB_GROUPS.flatMap((g) => g.items).find((i) => i.href === href)).filter(
    (d): d is NonNullable<typeof d> => Boolean(d)
  )
  return (
    <section aria-labelledby="rugby-hub" className="bg-(--club-band) text-(--club-on-band)">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-8 md:py-20 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <BookOpen aria-hidden="true" className="size-8" />
          <h2 id="rugby-hub" className="mt-4 scroll-mt-32 font-display text-5xl leading-none tracking-wide md:text-6xl">
            Explore Rugby
          </h2>
          <p className="mt-4 max-w-md text-lg leading-relaxed">
            Learn the game, understand what is happening on the pitch, and grow as a player, parent, coach or supporter.
          </p>
          <p className="mt-3 max-w-md text-base leading-relaxed">
            The Rugby Hub explains rugby in plain English, and everyone at {clubName} with an Ovalball account can use it.
          </p>
          <Link
            href="/rugby-hub"
            className="mt-8 inline-flex min-h-12 items-center rounded-lg bg-(--club-on-band) px-6 text-base font-semibold text-(--club-band) outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-(--club-on-band)"
          >
            Explore the Rugby Hub
          </Link>
          {!signedIn && <p className="mt-3 text-sm">You will be asked to sign in first.</p>}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {destinations.map((d) => (
            <li key={d.href}>
              <Link
                href={d.href}
                className="flex h-full flex-col rounded-2xl border border-current/25 p-5 outline-none hover:border-current/60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--club-on-band)"
              >
                <span className="font-semibold">{d.label}</span>
                <span className="mt-1 text-sm leading-relaxed">{d.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Club information
// ----------------------------------------------------------------------------

const CONTACT_ROLE_LABEL: Record<string, string> = {
  fixture_secretary: "Fixture Secretary",
  minis_secretary: "Minis Secretary",
  general: "General Enquiries",
}

export function ClubInformation({
  club,
  contacts,
  partnerAction,
}: {
  club: PublicClub
  contacts: { role: string; name: string; phone: string | null; email: string | null }[]
  partnerAction?: ReactNode
}) {
  const hasGround = Boolean(club.homeGround || club.address || club.postcode)
  return (
    <section aria-labelledby="club">
      <SectionHeading id="club" title="Club Information" />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <h3 className="text-sm font-semibold text-ink">Home Ground</h3>
          {hasGround ? (
            <address className="mt-2 text-sm leading-relaxed text-ink/80 not-italic">
              {club.homeGround && <span className="block font-semibold text-ink">{club.homeGround}</span>}
              {club.address && <span className="block">{club.address}</span>}
              {club.postcode && <span className="block">{club.postcode}</span>}
            </address>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">The club has not published its ground details.</p>
          )}
          {(club.website || club.facebookUrl) && (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {club.website && (
                <a href={club.website} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
                  Club Website<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
              {club.facebookUrl && (
                <a href={club.facebookUrl} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
                  Facebook<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <h3 className="text-sm font-semibold text-ink">Contact</h3>
          {contacts.length ? (
            <ul className="mt-2 grid gap-3">
              {contacts.map((c, i) => (
                <li key={i} className="text-sm">
                  <p className="font-semibold text-ink">{c.name}</p>
                  <p className="text-ink-muted">{CONTACT_ROLE_LABEL[c.role] ?? "Club Contact"}</p>
                  {c.email && (
                    <a href={`mailto:${c.email}`} className={cn(TEXT_LINK, "break-all")}>
                      {c.email}
                    </a>
                  )}
                  {c.phone && <p className="text-ink/80">{c.phone}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">The club has not published a public contact.</p>
          )}
          {partnerAction && <div className="mt-4">{partnerAction}</div>}
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-white p-5">
          {club.homeKit ? (
            <>
              <RugbyKit kit={club.homeKit} clubName={club.name} className="size-20 shrink-0 text-ink" />
              <div>
                <h3 className="text-sm font-semibold text-ink">Home Kit</h3>
                <p className="mt-1 text-sm text-ink/80 first-letter:uppercase">{describeKit(club.homeKit).replace(/^primary kit: /, "")}</p>
              </div>
            </>
          ) : (
            <div>
              <h3 className="text-sm font-semibold text-ink">Home Kit</h3>
              <p className="mt-1 text-sm text-ink-muted">The club has not recorded its home kit yet.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function WriteFirstArticle({ href }: { href: string }) {
  return (
    <Link href={href} className={BUTTON_SOLID}>
      Write an Article
    </Link>
  )
}
