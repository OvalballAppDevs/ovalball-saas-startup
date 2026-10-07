import { CircleCheck, CircleSlash, Clock, MinusCircle } from "lucide-react"

import { DISPENSATION_STATUS_LABEL, dispensationTone, type DispensationStatus } from "@ovalball/contracts/team/dispensation"

import { cn } from "@/lib/utils"

/**
 * A dispensation's state, always in words -- the colour and icon only repeat what the word says. A pending
 * request is amber with a clock, never a tick: asking is not approval.
 */
const TONE = {
  waiting: { className: "border-amber-500/40 bg-amber-50 text-amber-900", Icon: Clock },
  granted: { className: "border-mint-300 bg-mint-100 text-forest-950", Icon: CircleCheck },
  refused: { className: "border-destructive-text/25 bg-red-50 text-destructive-text", Icon: CircleSlash },
  closed: { className: "border-ink/10 bg-ink/5 text-ink-muted", Icon: MinusCircle },
} as const

export function DispensationStatusPill({ status, className }: { status: DispensationStatus; className?: string }) {
  const { className: tone, Icon } = TONE[dispensationTone(status)]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", tone, className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      {DISPENSATION_STATUS_LABEL[status]}
    </span>
  )
}
