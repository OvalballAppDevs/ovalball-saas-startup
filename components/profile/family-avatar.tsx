import { Users } from "lucide-react"

/**
 * The avatar for All Children mode.
 *
 * It exists because both obvious shortcuts are wrong. Showing the signed-in
 * adult's photo is the exact defect this phase was opened to fix -- a parent's
 * face captioned with a child's identity. And picking one child's photo to
 * stand for the whole family silently privileges a sibling, which a child
 * would notice immediately even if an adult did not.
 *
 * So All Children gets a mark of its own: it represents a group, not a
 * person, and it never implies whose group it is.
 */
export function FamilyAvatar({ variant = "light", className = "" }: { variant?: "light" | "dark"; className?: string }) {
  const palette =
    variant === "dark" ? "border-white/15 bg-white/10 text-white/70" : "border-forest-800/15 bg-forest-800/8 text-forest-800"
  return (
    <div className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${palette} ${className}`} aria-hidden="true">
      <Users className="size-4" />
    </div>
  )
}
