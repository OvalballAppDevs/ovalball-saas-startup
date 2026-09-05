import { LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED, LEGAL_VERSION } from "@/lib/legal/metadata"

/**
 * Shared typography + document metadata for the Legal & Trust pages.
 *
 * Kept deliberately plain: generous line length, real heading hierarchy and
 * ordinary body-size text. Legal pages are the one place where shrinking the
 * type to look tidy actively harms the reader, so nothing here is smaller
 * than the site's normal body size.
 */

export function LegalSection({ id, heading, children }: { id?: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 first:mt-0">
      <h2 className="font-display text-2xl text-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink/80">{children}</div>
    </section>
  )
}

export function LegalSubheading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-ink">{children}</h3>
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="ml-5 list-disc space-y-1.5 text-[15px] leading-relaxed text-ink/80">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

/** Effective date / last updated / version block, identical on every document. */
export function LegalDocumentMeta() {
  return (
    <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-ink/10 bg-white px-4 py-3.5 text-sm">
      <div>
        <dt className="text-ink/50">Effective date</dt>
        <dd className="font-medium text-ink">{LEGAL_EFFECTIVE_DATE}</dd>
      </div>
      <div>
        <dt className="text-ink/50">Last updated</dt>
        <dd className="font-medium text-ink">{LEGAL_LAST_UPDATED}</dd>
      </div>
      <div>
        <dt className="text-ink/50">Version</dt>
        <dd className="font-medium text-ink">{LEGAL_VERSION}</dd>
      </div>
    </dl>
  )
}

/** A readable two-column table that scrolls rather than overflowing on mobile. */
export function LegalTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-ink/10">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-mint-100/60">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold text-ink">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-ink/10 align-top">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-ink/80">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
