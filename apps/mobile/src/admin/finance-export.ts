import { Directory, File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"

/**
 * HANDING THE CLUB'S FINANCE EXPORT TO THE PERSON.
 *
 * The rows come from the SAME RPC the website's Export CSV button calls (`export_finance_rows`, which
 * writes the finance_export_generated audit row) and are shaped into the same thirteen columns by the
 * shared contract. The phone cannot "download"; it writes the file into its own cache and opens the
 * system share sheet, so the person chooses where it goes -- Files, Mail, AirDrop -- exactly as they
 * would with any document.
 *
 * NOTHING IN THE FILE IS A SECRET: no bank data, no tokens, no provider ids -- the RPC's result type is
 * the whole of what can be written. The cache copy is overwritten on every export so a stale month is
 * never shared by mistake.
 */
export async function shareFinanceCsv(csv: string, fileName: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, message: "This device can't share a file." }
  }
  try {
    const folder = new Directory(Paths.cache, "finance-export")
    if (!folder.exists) folder.create({ intermediates: true })
    const target = new File(folder, fileName)
    if (target.exists) target.delete()
    target.write(csv)
    await Sharing.shareAsync(target.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: fileName })
    return { ok: true }
  } catch {
    return { ok: false, message: "Couldn't share the export. Try again." }
  }
}
