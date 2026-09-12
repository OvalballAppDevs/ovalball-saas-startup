import type { CodeScope } from "@/lib/app-context/heritage-data"

/**
 * The colour thread that carries the whole experience: forest green is
 * Ovalball's own brand colour AND the shared root both codes grew from
 * before 1895, so it does double duty honestly. Amber and slate are new,
 * added specifically for this feature -- the schism itself is the story,
 * so the two paths need two colours that did not exist in the product
 * before the split existed in the sport.
 */
const CODE_COPY: Record<CodeScope, { label: string }> = {
  pre_schism: { label: "Before the split" },
  both: { label: "Union & League" },
  union: { label: "Union" },
  league: { label: "League" },
}

export function codeAccentClass(codeScope: CodeScope): string {
  switch (codeScope) {
    case "union":
      return "text-heritage-union"
    case "league":
      return "text-heritage-league"
    default:
      return "text-forest-800"
  }
}

export function codeDotClass(codeScope: CodeScope): string {
  switch (codeScope) {
    case "union":
      return "bg-heritage-union"
    case "league":
      return "bg-heritage-league"
    default:
      return "bg-forest-800"
  }
}

export function CodeBadge({ codeScope }: { codeScope: CodeScope }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${codeAccentClass(codeScope)}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${codeDotClass(codeScope)}`} />
      {CODE_COPY[codeScope].label}
    </span>
  )
}
