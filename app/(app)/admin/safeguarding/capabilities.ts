/** The four Safeguarding Officer capabilities this screen names, and their canonical catalogue keys. */
export const SAFEGUARDING_GRANTABLE_CAPABILITIES = [
  "club.dispensation.view",
  "club.dispensation.notify",
  "club.transfer.safeguarding_view",
  "club.transfer.safeguarding_notify",
] as const

export type SafeguardingCapabilityKey = (typeof SAFEGUARDING_GRANTABLE_CAPABILITIES)[number]

/** The canonical catalogue key each of these screen keys resolves to (Identity/Auth Slice 3, J.12). */
export const CANONICAL_SAFEGUARDING_KEY: Record<SafeguardingCapabilityKey, string> = {
  "club.dispensation.view": "safeguarding.dispensation.view",
  "club.dispensation.notify": "safeguarding.dispensation.notify",
  "club.transfer.safeguarding_view": "safeguarding.transfer.view",
  "club.transfer.safeguarding_notify": "safeguarding.transfer.notify",
}
