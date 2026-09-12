import Link from "next/link"

/**
 * Union and League are two catalogues, not one list with warnings.
 *
 * The old directory showed every identity at once and hung "Not offered in
 * Rugby League" off the ones that did not apply, which asked a Site Admin to
 * read a list of things they were then told to ignore. Which code an identity
 * belongs to is structural, so it is expressed structurally: choose the code,
 * see that code's catalogue.
 *
 * Routed, not a tab widget. A Site Admin sends colleagues links to this page,
 * and Back, Refresh and a copied URL all have to land in the same catalogue.
 */
export const RUGBY_CODES = ["union", "league"] as const
export type RugbyCode = (typeof RUGBY_CODES)[number]

export const CODE_LABELS: Record<RugbyCode, string> = {
  union: "Rugby Union",
  league: "Rugby League",
}

export function resolveRugbyCode(value: string | undefined): RugbyCode {
  return (RUGBY_CODES as readonly string[]).includes(value ?? "") ? (value as RugbyCode) : "union"
}

export function TeamDirectoryCodeNav({ active, showRetired }: { active: RugbyCode; showRetired: boolean }) {
  return (
    <nav aria-label="Rugby code" className="mt-6 flex flex-wrap gap-1 border-b border-ink/10">
      {RUGBY_CODES.map((code) => {
        const isActive = code === active
        return (
          <Link
            key={code}
            href={`/admin/team-directory?code=${code}${showRetired ? "&retired=1" : ""}`}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-t-md px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              isActive
                ? "-mb-px border-b-2 border-forest-800 font-medium text-forest-950"
                : "border-b-2 border-transparent text-ink-muted hover:text-ink/80"
            }`}
          >
            {CODE_LABELS[code]}
          </Link>
        )
      })}
    </nav>
  )
}
