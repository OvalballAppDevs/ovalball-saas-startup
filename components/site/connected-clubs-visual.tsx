"use client"

import { useId } from "react"

import { OvalballMark } from "@/components/brand/ovalball-mark"
import { useReducedMotion } from "@/lib/motion/use-reduced-motion"

/**
 * Clubs connecting through Ovalball, drawn rather than diagrammed.
 *
 * Six club nodes sit on an ellipse around a central Ovalball mark, each
 * joined to the centre by a line that draws itself in once, staggered. The
 * point being made is "clubs meet in the middle", so the geometry does the
 * explaining and the lines are decoration on top of it.
 *
 * The whole graphic is aria-hidden and followed by a real list: the
 * relationships are stated in text for a screen reader, and the page still
 * makes its argument with no animation, no SVG support, or reduced motion
 * set (in which case the lines are simply already drawn).
 */
const NODES = [
  { label: "Northbridge RFC", angle: 200 },
  { label: "Westbrook RFC", angle: 260 },
  { label: "Eastfield RFC", angle: 320 },
  { label: "Riverside RFC", angle: 20 },
  { label: "Your club", angle: 80, highlight: true },
  { label: "Their club", angle: 140 },
]

const CX = 300
const CY = 190
const RX = 232
const RY = 132

function point(angle: number) {
  const rad = (angle * Math.PI) / 180
  return { x: CX + RX * Math.cos(rad), y: CY + RY * Math.sin(rad) }
}

export function ConnectedClubsVisual() {
  const reducedMotion = useReducedMotion()
  const gradientId = useId()

  return (
    <div>
      <div aria-hidden="true" className="relative mx-auto w-full max-w-[600px]">
        <svg
          viewBox="0 0 600 380"
          className="h-auto w-full overflow-visible"
          role="presentation"
          focusable="false"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--pitch-600)" stopOpacity="0.15" />
              <stop offset="50%" stopColor="var(--pitch-400)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--pitch-600)" stopOpacity="0.15" />
            </linearGradient>
          </defs>

          {NODES.map((node, i) => {
            const p = point(node.angle)
            return (
              <line
                key={`line-${node.label}`}
                x1={p.x}
                y1={p.y}
                x2={CX}
                y2={CY}
                stroke={`url(#${gradientId})`}
                strokeWidth={1.5}
                strokeLinecap="round"
                pathLength={1}
                style={
                  reducedMotion
                    ? undefined
                    : {
                        strokeDasharray: 1,
                        strokeDashoffset: 1,
                        animation: `ovalball-draw-line 900ms ease-out ${300 + i * 130}ms forwards`,
                      }
                }
              />
            )
          })}

          {NODES.map((node, i) => {
            const p = point(node.angle)
            const anchor = p.x > CX + 40 ? "start" : p.x < CX - 40 ? "end" : "middle"
            const dx = anchor === "start" ? 16 : anchor === "end" ? -16 : 0
            const dy = anchor === "middle" ? (p.y > CY ? 26 : -18) : 5
            return (
              <g
                key={`node-${node.label}`}
                style={
                  reducedMotion
                    ? undefined
                    : { opacity: 0, animation: `ovalball-node-in 500ms ease-out ${i * 130}ms forwards` }
                }
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={node.highlight ? 8 : 5.5}
                  fill={node.highlight ? "var(--pitch-400)" : "var(--pitch-600)"}
                />
                {node.highlight && (
                  <circle cx={p.x} cy={p.y} r={14} fill="none" stroke="var(--pitch-400)" strokeOpacity="0.35" strokeWidth={1.5} />
                )}
                <text
                  x={p.x + dx}
                  y={p.y + dy}
                  textAnchor={anchor}
                  className="fill-white/70 text-[13px]"
                  style={{ fontWeight: node.highlight ? 600 : 400 }}
                >
                  {node.label}
                </text>
              </g>
            )
          })}

          <circle cx={CX} cy={CY} r={62} fill="var(--forest-900)" stroke="var(--pitch-600)" strokeOpacity="0.35" />
        </svg>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="-mt-[3%] flex flex-col items-center">
            <OvalballMark className="h-auto w-16 text-pitch-400" />
            <span className="mt-1 text-xs font-medium tracking-[0.08em] text-white/60 uppercase">
              Ovalball
            </span>
          </div>
        </div>
      </div>

      {/* The same information, available to a screen reader and to anyone
          for whom the graphic never renders. */}
      <p className="sr-only">
        Ovalball sits between clubs: Northbridge RFC, Westbrook RFC, Eastfield RFC, Riverside RFC,
        your club and the club you are playing all connect through Ovalball rather than to each
        other through separate, private conversations. Club names shown are fictitious examples.
      </p>
    </div>
  )
}
