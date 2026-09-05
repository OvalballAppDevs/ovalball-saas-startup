import Link from "next/link"
import { CircleHelp } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The persistent, always-available Support entry point -- placed in the
 * same header row as Messages/Notifications (present on every
 * authenticated page via app-nav.tsx/app-mobile-nav.tsx) rather than in
 * the permission-gated primary nav list, since every authenticated user
 * can reach Support regardless of role.
 */
export function SupportButton({ unreadCount = 0, variant = "dark" }: { unreadCount?: number; variant?: "dark" | "light" }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className={`relative ${variant === "dark" ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-ink/60 hover:bg-ink/5 hover:text-ink"}`}
      nativeButton={false}
      render={<Link href="/support" aria-label={unreadCount > 0 ? `Support, ${unreadCount} unread` : "Support"} />}
    >
      <CircleHelp className="size-5" />
      {unreadCount > 0 && (
        <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-pitch-600 text-[10px] font-semibold text-white ring-2 ring-forest-950">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Button>
  )
}
