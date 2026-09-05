import Link from "next/link"
import { CircleUserRound } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Consolidates Profile access into the same compact top-right action
 * cluster as Messages/Notifications/Support, mirroring support-button.tsx's
 * exact pattern -- previously "Profile" only existed as a full-width text
 * link at the very bottom of the sidebar, disconnected from every other
 * account action, and the identity block above it wasn't a link at all.
 */
export function ProfileButton({ variant = "dark" }: { variant?: "dark" | "light" }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className={variant === "dark" ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-ink/60 hover:bg-ink/5 hover:text-ink"}
      nativeButton={false}
      render={<Link href="/account" aria-label="Edit personal profile" />}
    >
      <CircleUserRound className="size-5" />
    </Button>
  )
}
