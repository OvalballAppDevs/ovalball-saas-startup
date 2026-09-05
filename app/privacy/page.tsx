import { redirect } from "next/navigation"

/**
 * The Legal & Trust set now lives under /legal/*. This route is kept as a
 * permanent redirect so links already shared (including any given to a
 * provider console) continue to resolve rather than 404.
 */
export default function LegacyPrivacyRedirect() {
  redirect("/legal/privacy")
}
