import Link from "next/link"

import { ClubAvatar } from "@/components/club/club-avatar"
import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { RugbyKit } from "@/components/club/rugby-kit"
import type { PublicClub } from "@/lib/club-public/club"
import { cn } from "@/lib/utils"

import { FOCUS_HERO, FOCUS_LIGHT } from "./primitives"

/**
 * The club's crest on a plate.
 *
 * A crest is uploaded by the club and can be anything: a transparent PNG of
 * a dark badge, a wide wordmark, a tall shield, a tiny low-resolution file.
 * Placing it on a white plate means it is legible on every home kit without
 * ever altering the file, and object-contain inside a fixed box means it is
 * never stretched. No crest at all shows the club's home shirt, which is the
 * next most recognisable thing a club owns.
 */
export function CrestPlate({ club, size }: { club: Pick<PublicClub, "name" | "crestUrl" | "homeKit">; size: "sm" | "md" | "xl" }) {
  const fallback = club.homeKit ? (
    <RugbyKit kit={club.homeKit} clubName={club.name} className="size-full" />
  ) : undefined
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-white shadow-sm",
        size === "xl" ? "size-28 rounded-3xl p-3 md:size-40 md:p-4" : size === "md" ? "size-16 rounded-2xl p-2 md:size-20" : "size-9 rounded-lg p-1"
      )}
      style={{ boxShadow: `0 0 0 1px var(--club-plate-border)` }}
    >
      <ClubAvatar logoUrl={club.crestUrl} name={club.name} size={size === "xl" ? "xl" : size === "md" ? "md" : "sm"} plain fallback={fallback} className={size === "sm" ? "size-7" : size === "md" ? "md:size-16" : ""} />
    </span>
  )
}

const HOME_SECTIONS = [
  { hash: "news", label: "News" },
  { hash: "fixtures", label: "Fixtures" },
  { hash: "results", label: "Results" },
  { hash: "teams", label: "Teams" },
  { hash: "rugby-hub", label: "Rugby Hub" },
  { hash: "club", label: "Club Information" },
]

/** The slim bar that carries the club's identity on every public club page. */
export function ClubBar({ club, onHome, manageHref }: { club: PublicClub; onHome: boolean; manageHref: string | null }) {
  const base = onHome ? "" : `/club/${club.slug}`
  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-(--club-hero) text-(--club-hero-fg)">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 md:px-8">
        <Link href={`/club/${club.slug}`} className={cn(FOCUS_HERO, "flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2")}>
          <CrestPlate club={club} size="sm" />
          <span className="truncate font-display text-xl leading-none tracking-wide">{club.name}</span>
        </Link>
        <nav aria-label={`${club.name} sections`} className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {HOME_SECTIONS.map((s) => (
              <li key={s.hash}>
                <a
                  href={`${base}#${s.hash}`}
                  className={cn(FOCUS_HERO, "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-(--club-hero-muted) hover:text-(--club-hero-fg)")}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {manageHref && (
          <Link
            href={manageHref}
            className={cn(
              FOCUS_HERO,
              "ml-auto inline-flex min-h-10 shrink-0 items-center rounded-lg bg-(--club-hero-accent) px-3 text-sm font-semibold text-(--club-on-hero-accent) lg:ml-2"
            )}
          >
            Manage News
          </Link>
        )}
      </div>
      {/* Small screens: the same sections as a scrollable row, never a hidden menu. */}
      <nav aria-label={`${club.name} sections`} className="overflow-x-auto border-t border-black/10 [mask-image:linear-gradient(to_right,black_80%,transparent)] lg:hidden">
        <ul className="flex w-max items-center gap-1 px-2 py-1">
          {HOME_SECTIONS.map((s) => (
            <li key={s.hash}>
              <a
                href={`${base}#${s.hash}`}
                className={cn(FOCUS_HERO, "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-(--club-hero-muted) hover:text-(--club-hero-fg)")}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}

export function ClubFooter({ club }: { club: PublicClub }) {
  return (
    <footer className="border-t border-ink/10 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-center gap-3">
          <CrestPlate club={club} size="sm" />
          <div>
            <p className="font-semibold text-ink">{club.name}</p>
            <p className="text-sm text-ink-muted">The club&apos;s home on Ovalball</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <Link href="/privacy" className={cn(FOCUS_LIGHT, "rounded-sm text-ink-muted hover:text-ink")}>
            Privacy
          </Link>
          <Link href="/terms" className={cn(FOCUS_LIGHT, "rounded-sm text-ink-muted hover:text-ink")}>
            Terms
          </Link>
          <Link href="/" aria-label="Ovalball home" className={cn(FOCUS_LIGHT, "rounded-md")}>
            <OvalballLogo variant="light" />
          </Link>
        </div>
      </div>
    </footer>
  )
}
