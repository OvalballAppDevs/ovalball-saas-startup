/**
 * The pitch background: an original Ovalball line drawing, not a copied
 * governing-body diagram. Purely decorative (aria-hidden) -- every position
 * marker drawn over it is a real, separately-focusable link, never part of
 * this SVG, so a screen reader never has to wade through pitch geometry to
 * reach a position.
 */
export function PitchField({ tone }: { tone: "union" | "league" }) {
  const stroke = "rgba(248, 250, 247, 0.55)"
  return (
    <svg viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full">
      <rect x="0" y="0" width="100" height="140" rx="2" className={tone === "union" ? "fill-forest-900" : "fill-[#132733]"} />
      <rect x="2" y="2" width="96" height="136" fill="none" stroke={stroke} strokeWidth="0.4" />
      {/* try lines */}
      <line x1="2" y1="14" x2="98" y2="14" stroke={stroke} strokeWidth="0.4" />
      <line x1="2" y1="126" x2="98" y2="126" stroke={stroke} strokeWidth="0.4" />
      {/* halfway */}
      <line x1="2" y1="70" x2="98" y2="70" stroke={stroke} strokeWidth="0.5" />
      {/* 22m-style lines */}
      <line x1="2" y1="36" x2="98" y2="36" stroke={stroke} strokeWidth="0.3" strokeDasharray="1.2 1.2" />
      <line x1="2" y1="104" x2="98" y2="104" stroke={stroke} strokeWidth="0.3" strokeDasharray="1.2 1.2" />
      {/* centre spot */}
      <circle cx="50" cy="70" r="0.8" fill={stroke} />
    </svg>
  )
}
