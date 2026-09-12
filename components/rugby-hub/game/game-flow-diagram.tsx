"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowDown, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"

interface FlowNode {
  key: string
  label: string
  detail: string
  href?: string
}

const SHARED_START: FlowNode = { key: "restart", label: "Start / Restart", detail: "Play begins from a kick-off, or restarts after a score or a stoppage.", href: "/rugby-hub/game/how-play-restarts" }
const SHARED_POSSESSION: FlowNode = { key: "possession", label: "Possession", detail: "One team has the ball and tries to advance it towards the opposition's try line.", href: "/rugby-hub/game/possession-and-territory" }
const SHARED_ATTACK: FlowNode = { key: "attack", label: "Attack", detail: "The team in possession runs, passes or kicks to gain ground and create space.", href: "/rugby-hub/game/how-teams-move-the-ball" }
const SHARED_CONTACT: FlowNode = { key: "contact", label: "Contact / Tackle", detail: "The ball-carrier is tackled — what happens next is where Union and League genuinely diverge." }
const UNION_CONTACT_OUTCOME: FlowNode = { key: "union-breakdown", label: "Breakdown / Ruck", detail: "Both teams can compete for the ball on the ground — winning it continues the attack, losing it turns possession over.", href: "/rugby-hub/game/the-breakdown-and-ruck" }
const LEAGUE_CONTACT_OUTCOME: FlowNode = { key: "league-ptb", label: "Play-the-Ball", detail: "No contest — the tackled team keeps the ball and restarts with a play-the-ball, using one of a limited number of tackles.", href: "/rugby-hub/game/the-play-the-ball" }
const SHARED_TERRITORY: FlowNode = { key: "territory", label: "Territory / Continuity", detail: "The team weighs keeping the ball against kicking for better field position.", href: "/rugby-hub/game/possession-and-territory" }
const SHARED_RESOLUTION: FlowNode = { key: "resolution", label: "Score / Turnover / Penalty", detail: "The sequence ends in a score, a turnover, or a penalty — and then the cycle restarts from the top.", href: "/rugby-hub/game/how-a-game-flows" }

function flowFor(code: "union" | "league"): FlowNode[] {
  return [SHARED_START, SHARED_POSSESSION, SHARED_ATTACK, SHARED_CONTACT, code === "union" ? UNION_CONTACT_OUTCOME : LEAGUE_CONTACT_OUTCOME, SHARED_TERRITORY, SHARED_RESOLUTION]
}

/**
 * The flagship Game Knowledge visual: one repeating cycle, told once per
 * code because the contact step genuinely diverges. Original CSS/flex
 * layout -- no scraped diagrams, no external image dependency. Each node
 * is a real button (keyboard-operable, no pointer-only interaction);
 * activating one shows its explanation below and, where a concept exists,
 * a link to learn more. Horizontal with arrow connectors on desktop,
 * vertical with down-arrows on mobile -- the same nodes, recomposed, never
 * a shrunk copy of the desktop layout.
 */
export function GameFlowDiagram({ defaultCode }: { defaultCode: "union" | "league" }) {
  const [code, setCode] = useState<"union" | "league">(defaultCode)
  const [activeKey, setActiveKey] = useState<string>("restart")
  const nodes = flowFor(code)
  const active = nodes.find((n) => n.key === activeKey) ?? nodes[0]

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl text-ink">How a Game Flows</h3>
        <div role="group" aria-label="Rugby code" className="inline-flex rounded-full border border-ink/15 bg-chalk p-0.5">
          {(["union", "league"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={code === c}
              onClick={() => setCode(c)}
              className={cn(
                "min-h-9 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                code === c ? "bg-ink text-chalk" : "text-ink/60 hover:text-ink/90"
              )}
            >
              {c === "union" ? "Rugby Union" : "Rugby League"}
            </button>
          ))}
        </div>
      </div>

      <ol className="mt-6 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        {nodes.map((node, i) => (
          <li key={node.key} className="flex items-center gap-1.5 sm:contents">
            <button
              type="button"
              aria-current={activeKey === node.key ? "step" : undefined}
              onClick={() => setActiveKey(node.key)}
              className={cn(
                "min-h-11 flex-1 rounded-xl border px-3 py-2.5 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 sm:flex-none",
                activeKey === node.key ? "border-pitch-600 bg-mint-100 text-forest-900" : "border-ink/15 bg-white text-ink/75 hover:border-pitch-600/40"
              )}
            >
              {node.label}
            </button>
            {i < nodes.length - 1 && (
              <>
                <ArrowRight aria-hidden="true" className="hidden size-4 shrink-0 text-ink/30 sm:block" />
                <ArrowDown aria-hidden="true" className="size-4 shrink-0 text-ink/30 sm:hidden" />
              </>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-xl bg-chalk px-4 py-4">
        <p className="text-sm font-semibold text-ink">{active.label}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink/80">{active.detail}</p>
        {active.href && (
          <Link href={active.href as never} className="mt-2 inline-flex min-h-9 items-center text-sm font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
            Learn more
          </Link>
        )}
      </div>

      <p className="mt-4 text-xs text-ink-muted">The cycle repeats: whatever the outcome, play restarts and the sequence begins again from the top.</p>
    </div>
  )
}
