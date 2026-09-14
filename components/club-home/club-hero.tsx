import Link from "next/link"

import { RUGBY_CODE_LABEL, type PublicClub } from "@/lib/club-public/club"
import { matchDateParts, shortMatchDate } from "@/lib/club-public/format"
import type { ClubResult, ClubUpcomingMatch } from "@/lib/club-public/matches"
import { OUTCOME_WORD } from "@/lib/club-public/matches"
import { cn } from "@/lib/utils"

import { CrestPlate } from "./club-chrome"
import { KitField } from "./kit-field"
import { FOCUS_HERO, FOCUS_LIGHT, TEXT_LINK } from "./primitives"

/**
 * The club, at full size: its shirt as the ground, its crest on a plate, its
 * name in the scoreboard face. Words sit on the plain shirt colour -- the
 * pattern fades in beside them, never behind them.
 */
export function ClubHero({ club }: { club: PublicClub }) {
  return (
    <section aria-labelledby="club-name" className="relative isolate overflow-hidden bg-(--club-hero) text-(--club-hero-fg)">
      <KitField
        pattern={club.theme.pattern}
        className="absolute inset-x-0 top-0 -z-10 h-44 w-full [mask-image:linear-gradient(to_bottom,black,transparent)] md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[38%] md:[mask-image:linear-gradient(to_right,transparent,black_40%)]"
      />
      <div className="mx-auto max-w-6xl px-4 pt-24 pb-24 md:px-8 md:pt-24 md:pb-32">
        {/* Words keep to the plain shirt colour: the pattern only occupies the space this column leaves. */}
        <div className="md:max-w-[60%]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-8">
          <CrestPlate club={club} size="xl" />
          <div className="min-w-0 md:pb-1">
            <p className="text-sm font-medium text-(--club-hero-muted)">
              {[club.rugbyCode ? RUGBY_CODE_LABEL[club.rugbyCode] : null, club.place].filter(Boolean).join(", ")}
            </p>
            <h1
              id="club-name"
              className="mt-1 font-display text-[clamp(3rem,2.2rem+4vw,6rem)] leading-[0.92] tracking-wide text-balance"
            >
              {club.name}
            </h1>
          </div>
        </div>
        {club.bio && <p className="mt-6 max-w-2xl text-base leading-relaxed text-(--club-hero-muted) md:text-lg">{club.bio}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#fixtures"
            className={cn(FOCUS_HERO, "inline-flex min-h-11 items-center rounded-lg bg-(--club-hero-accent) px-5 text-sm font-semibold text-(--club-on-hero-accent)")}
          >
            Fixtures &amp; Results
          </a>
          <a
            href="#news"
            className={cn(FOCUS_HERO, "inline-flex min-h-11 items-center rounded-lg border border-current px-5 text-sm font-semibold")}
          >
            Latest News
          </a>
        </div>
        </div>
      </div>
    </section>
  )
}

/**
 * The first thing a parent on a phone wants: when is the next game, how did
 * the last one go, what does the club run. Lifted over the hero's edge so it
 * reads as part of the club's identity rather than a dashboard beneath it.
 */
export function MatchdayStrip({
  next,
  latest,
  teamCount,
  clubSlug,
}: {
  next: ClubUpcomingMatch | null
  latest: ClubResult | null
  teamCount: number
  clubSlug: string
}) {
  const date = next ? matchDateParts(next.date) : null
  return (
    <div className="relative z-10 mx-auto -mt-14 max-w-6xl px-4 md:-mt-16 md:px-8">
      <div className="grid overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_18px_40px_-24px_rgba(16,21,18,0.45)] md:grid-cols-[1.6fr_1fr_0.8fr]">
        <div className="flex gap-4 p-5 md:p-6">
          {next && date ? (
            <>
              <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-(--club-solid) py-2 text-(--club-on-solid)">
                <span className="text-xs font-semibold">{date.weekday}</span>
                <span className="font-display text-4xl leading-none">{date.day}</span>
                <span className="text-xs font-semibold">{date.month}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-(--club-ink)">Next Match</p>
                <p className="mt-1 font-semibold text-ink">
                  {next.teamLabel} <span className="font-normal text-ink-muted">v</span> {next.opposition}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {[next.venueRole === "Home" ? "Home" : next.venueRole === "Away" ? "Away" : null, next.time ? `Kick-off ${next.time}` : "Kick-off to be confirmed", next.competition?.name]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {next.matchCentreHref && (
                  <Link href={next.matchCentreHref} className={cn(TEXT_LINK, "mt-2 inline-block text-sm")}>
                    Match Centre
                  </Link>
                )}
              </div>
            </>
          ) : (
            <div>
              <p className="text-sm font-semibold text-(--club-ink)">Next Match</p>
              <p className="mt-1 text-ink">No fixtures are published yet.</p>
              <p className="mt-1 text-sm text-ink-muted">Confirmed fixtures appear here automatically.</p>
            </div>
          )}
        </div>

        <div className="border-t border-ink/10 p-5 md:border-t-0 md:border-l md:p-6">
          <p className="text-sm font-semibold text-(--club-ink)">Latest Result</p>
          {latest ? (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-4xl leading-none text-ink tabular-nums">
                  {latest.clubScore}–{latest.oppositionScore}
                </span>
                <span className="text-sm font-semibold text-ink">{OUTCOME_WORD[latest.outcome]}</span>
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {latest.teamLabel} v {latest.opposition}, {shortMatchDate(latest.date)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">Results appear here once matches are played and recorded.</p>
          )}
        </div>

        <div className="border-t border-ink/10 p-5 md:border-t-0 md:border-l md:p-6">
          <p className="text-sm font-semibold text-(--club-ink)">Teams</p>
          <p className="mt-1 font-display text-4xl leading-none text-ink tabular-nums">{teamCount}</p>
          <a href={`/club/${clubSlug}#teams`} className={cn(FOCUS_LIGHT, "mt-1 inline-block rounded-sm text-sm text-ink-muted underline underline-offset-4 hover:text-ink")}>
            {teamCount === 1 ? "See the team" : teamCount === 0 ? "Teams to be announced" : "See every team"}
          </a>
        </div>
      </div>
    </div>
  )
}
