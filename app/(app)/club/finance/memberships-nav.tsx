import Link from "next/link"

import { MembershipsNavPending } from "./memberships-nav-pending"

/**
 * THE MEMBERSHIPS AREA'S SECTIONS ARE ROUTES, NOT TAB WIDGETS.
 *
 * A club's memberships are worked through over days and linked to from notifications and from the phone, so each
 * section has its own address: Back goes to the previous section, Refresh stays where you are, and a copied link
 * takes a colleague to the same place. They are links with aria-current="page" -- the Season Handover's pattern --
 * and the labels are checked by scripts/verify-content-standard.mjs as navigation labels.
 */
export type MembershipsSection = "overview" | "members" | "reminders" | "payments"

export const MEMBERSHIPS_SECTIONS: { key: MembershipsSection; href: string; label: string }[] = [
  { key: "overview", href: "/club/finance", label: "Overview" },
  { key: "members", href: "/club/finance/members", label: "Members" },
  { key: "reminders", href: "/club/finance/reminders", label: "Reminders" },
  { key: "payments", href: "/club/finance/payments", label: "Payments" },
]

export function MembershipsNav({ active }: { active: MembershipsSection }) {
  return (
    <nav aria-label="Memberships sections" className="mt-6 flex flex-wrap gap-x-1 border-b border-ink/10">
      {MEMBERSHIPS_SECTIONS.map((section) => {
        const isActive = section.key === active
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px shrink-0 rounded-t-md border-b-2 px-2.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:px-3.5 ${
              isActive ? "border-forest-800 font-semibold text-forest-950" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {section.label}
            <MembershipsNavPending />
          </Link>
        )
      })}
    </nav>
  )
}
