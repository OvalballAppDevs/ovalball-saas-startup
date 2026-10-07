/**
 * The library's categories, in the table's own check order, with the words the website has always shown.
 * Moved here from `lib/documents/categories.ts`, which now re-exports them, so the two clients can never
 * disagree about what a category is called.
 */
export const DOCUMENT_CATEGORY_OPTIONS = [
  ["visitor_guide", "Visitor Guide"],
  ["fixture_information", "Fixture Information"],
  ["ground_pitch_information", "Ground / Pitch Information"],
  ["parking", "Parking"],
  ["match_day_information", "Match Day Information"],
  ["image", "Image"],
  ["other", "Other"],
] as const

export type DocumentCategory = (typeof DOCUMENT_CATEGORY_OPTIONS)[number][0]

export const DOCUMENT_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(DOCUMENT_CATEGORY_OPTIONS)

export function isDocumentCategory(value: string | null | undefined): value is DocumentCategory {
  return DOCUMENT_CATEGORY_OPTIONS.some(([key]) => key === value)
}

/** A category's words. An unknown key is never shown raw -- internal keys do not appear in normal UI. */
export function documentCategoryLabel(category: string | null | undefined): string {
  return (category && DOCUMENT_CATEGORY_LABEL[category]) || "Other"
}
