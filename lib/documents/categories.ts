export const DOCUMENT_CATEGORY_OPTIONS = [
  ["visitor_guide", "Visitor Guide"],
  ["fixture_information", "Fixture Information"],
  ["ground_pitch_information", "Ground / Pitch Information"],
  ["parking", "Parking"],
  ["match_day_information", "Match Day Information"],
  ["image", "Image"],
  ["other", "Other"],
] as const

export const DOCUMENT_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(DOCUMENT_CATEGORY_OPTIONS)
