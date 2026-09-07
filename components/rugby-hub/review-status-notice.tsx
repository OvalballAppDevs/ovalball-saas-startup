/** The Rugby Hub's only "nothing to show" component -- three distinct tones, never one generic empty state. A genuine content gap reads differently from "no regulatory mapping exists" from a real fetch failure. */
export function ReviewStatusNotice({ tone, message }: { tone: "reviewing" | "no-mapping" | "unavailable"; message: string }) {
  const toneClass = tone === "unavailable" ? "border-amber-500/40 bg-amber-50" : "border-ink/15 bg-mint-100/40"
  return (
    <div className={`rounded-lg border px-4 py-3.5 ${toneClass}`} role={tone === "unavailable" ? "alert" : undefined}>
      <p className="text-[15px] leading-relaxed text-ink/80">{message}</p>
    </div>
  )
}
