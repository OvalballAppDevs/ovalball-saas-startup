import { clubhouseResearchPreviewEnabled } from "../config/environment"
import type { ClubDetail, ClubMapMarker } from "@ovalball/contracts/clubhouse"

import generatedOverlayData from "./preview-overlay-data.generated.json"

type OverlayField = { value: string; confidence: "high" | "medium"; source: string; sourceUrl: string | null }

interface OverlayEntry {
  name: string
  town: string | null
  county: string | null
  fields: Record<string, OverlayField>
  logoCandidateUrl: string | null
  logoCandidateSource: string | null
  approxLatitude: number | null
  approxLongitude: number | null
  locationSource: "canonical" | "preview_postcode_proposal" | null
}

/**
 * LOCAL, DEV-ONLY PREVIEW PROJECTION -- never a second canonical dataset, never a write path.
 *
 * `preview-overlay-data.generated.json` is produced once, outside the app, by a throwaway script
 * (kept in this session's scratchpad, never committed) that reads PENDING rows from
 * `club_directory_research_proposals` plus `club_directory.logo_candidate_*`, and -- for a club with
 * no canonical geocode but a pending `postcode` proposal -- resolves a one-off, unpersisted preview
 * coordinate via the same `postcodes.io` provider `lib/geocoding/backfill.ts` already uses for the
 * real canonical backfill. Nothing here is written back to Supabase; the generated file itself is
 * gitignored. It exists purely so a Full Site Admin can visually review what pending research would
 * look like on Find a Club / Explore the Map BEFORE deciding whether to accept it one field at a time
 * on `/admin/clubs/data-quality` -- accepting is still that screen's job alone, never this one's.
 *
 * Gated on `EXPO_PUBLIC_CLUBHOUSE_RESEARCH_PREVIEW=1`, which is not set in any shipped build and only
 * ever toggled locally in a gitignored `.env.local` for a review session like this one. With the flag
 * unset (the default for every real user), `applyPreviewOverlay`/`applyDetailPreviewOverlay` are
 * no-ops that return their input with `isPreview: false` -- behaviourally identical to before this file
 * existed.
 */
export const CLUBHOUSE_RESEARCH_PREVIEW_ENABLED = clubhouseResearchPreviewEnabled

export type PreviewMarker = ClubMapMarker & {
  isPreview: boolean
  previewFields: Record<string, OverlayField>
}

export type PreviewDetail = ClubDetail & {
  isPreview: boolean
  previewFields: Record<string, OverlayField>
}

const rawOverlayData = generatedOverlayData as Record<string, OverlayEntry>

function overlayFor(directoryId: string): OverlayEntry | null {
  return rawOverlayData[directoryId] ?? null
}

export function applyPreviewOverlay(markers: ClubMapMarker[], enabled: boolean = CLUBHOUSE_RESEARCH_PREVIEW_ENABLED): PreviewMarker[] {
  return markers.map((m) => {
    const overlay = enabled ? overlayFor(m.directoryId) : null
    if (!overlay) return { ...m, isPreview: false, previewFields: {} }

    // A canonical, already-accepted value is NEVER replaced -- preview only fills a gap.
    const previewLocation = !m.hasLocation && overlay.locationSource === "preview_postcode_proposal" && overlay.approxLatitude !== null && overlay.approxLongitude !== null

    return {
      ...m,
      postcode: m.postcode ?? overlay.fields.postcode?.value ?? null,
      logoUrl: m.logoUrl ?? overlay.logoCandidateUrl ?? null,
      latitude: previewLocation ? overlay.approxLatitude : m.latitude,
      longitude: previewLocation ? overlay.approxLongitude : m.longitude,
      hasLocation: m.hasLocation || previewLocation,
      // Never claim more precision than the data actually has -- a preview-derived pin is reported
      // the same honest way an "unknown"-precision pin already is, distinguished instead by isPreview.
      locationPrecision: previewLocation ? "unknown" : m.locationPrecision,
      isPreview: true,
      previewFields: overlay.fields,
    }
  })
}

export function applyDetailPreviewOverlay(detail: ClubDetail, directoryId: string, enabled: boolean = CLUBHOUSE_RESEARCH_PREVIEW_ENABLED): PreviewDetail {
  const overlay = enabled ? overlayFor(directoryId) : null
  if (!overlay) return { ...detail, isPreview: false, previewFields: {} }

  return {
    ...detail,
    postcode: detail.postcode ?? overlay.fields.postcode?.value ?? null,
    bio: detail.bio ?? overlay.fields.bio?.value ?? null,
    website: detail.website ?? overlay.fields.website?.value ?? null,
    logoUrl: detail.logoUrl ?? overlay.logoCandidateUrl ?? null,
    isPreview: true,
    previewFields: overlay.fields,
  }
}
