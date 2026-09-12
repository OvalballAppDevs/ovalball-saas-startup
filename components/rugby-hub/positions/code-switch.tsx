import Link from "next/link"

/**
 * Section 5/19: an explicit, always-visible code choice (never inferred
 * silently) plus a context line stating what's resolved and how. "explore"
 * viewers (context didn't resolve, or they've switched away from their own
 * code) get an honest "you're viewing" line; a viewer whose own team
 * context matches gets the personalised "based on your team" line -- never
 * the reverse.
 */
export function CodeSwitch({
  code,
  contextLabel,
}: {
  code: "union" | "league"
  contextLabel: { kind: "own-context"; text: string } | { kind: "exploring" } | null
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="radiogroup" aria-label="Rugby code" className="inline-flex gap-1 rounded-full border border-ink/15 bg-white p-1">
        {(["union", "league"] as const).map((c) => (
          <Link
            key={c}
            href={`/rugby-hub/positions/${c}`}
            role="radio"
            aria-checked={code === c}
            className={`min-h-9 rounded-full px-4 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              code === c ? "bg-ink text-chalk" : "text-ink/70 hover:bg-mint-100"
            }`}
          >
            {c === "union" ? "Rugby Union" : "Rugby League"}
          </Link>
        ))}
      </div>
      {contextLabel && (
        <p className="text-sm text-ink/60">
          {contextLabel.kind === "own-context" ? (
            <>
              Based on <span className="font-medium text-ink/80">{contextLabel.text}</span>
            </>
          ) : (
            <>You&apos;re exploring {code === "union" ? "Rugby Union" : "Rugby League"}</>
          )}
        </p>
      )}
    </div>
  )
}
