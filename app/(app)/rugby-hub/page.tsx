import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRight, BookOpen, Shield, HeartPulse } from "lucide-react"

export const metadata: Metadata = {
  title: "Rugby Hub",
  description: "Playing rules, safeguarding, and player-welfare guidance sourced from official rugby governing bodies.",
}

const CARDS = [
  { href: "/rugby-hub/rules", label: "Rules", description: "Playing rules and age-grade guidance relevant to your team.", Icon: BookOpen },
  { href: "/rugby-hub/safeguarding", label: "Safeguarding", description: "Official safeguarding guidance and reporting information.", Icon: Shield },
  { href: "/rugby-hub/player-welfare", label: "Player Welfare", description: "Concussion and player-welfare guidance from official rugby sources.", Icon: HeartPulse },
]

export default function RugbyHubLandingPage() {
  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Rugby Hub</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Rules, safeguarding, and player-welfare guidance published here comes directly from official rugby governing
        bodies. Ovalball is a technology provider, not the governing authority for rugby &mdash; every piece of
        guidance shown here links back to its own official source.
      </p>

      <ul className="mt-8 flex flex-col gap-3">
        {CARDS.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="flex items-center gap-4 rounded-xl border border-ink/10 bg-white px-4 py-4 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
                <card.Icon aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{card.label}</p>
                <p className="mt-0.5 text-sm text-ink/60">{card.description}</p>
              </div>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink/30" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
