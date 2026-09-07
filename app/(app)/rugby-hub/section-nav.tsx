"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const SECTIONS = [
  { href: "/rugby-hub", label: "Overview", exact: true },
  { href: "/rugby-hub/rules", label: "Rules" },
  { href: "/rugby-hub/safeguarding", label: "Safeguarding" },
  { href: "/rugby-hub/player-welfare", label: "Player Welfare" },
]

export function RugbyHubSectionNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Rugby Hub sections" className="border-b border-ink/8 bg-white/60">
      <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 md:px-8">
        {SECTIONS.map((section) => {
          const isActive = section.exact ? pathname === section.href : pathname.startsWith(section.href)
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                isActive ? "border-pitch-600 text-forest-900" : "border-transparent text-ink/60 hover:text-ink/90"
              )}
            >
              {section.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
