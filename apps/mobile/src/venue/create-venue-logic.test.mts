import { test } from "node:test"
import assert from "node:assert/strict"

import {
  canProceedFromChangingRooms,
  canProceedFromPitches,
  changingRoomCountLabel,
  changingRoomDraftToPayload,
  changingRoomDraftValid,
  changingRoomSummaryLabel,
  changingRoomTypeLabel,
  coverWriteFor,
  draftPhotoFromCover,
  emptyChangingRoomDraft,
  emptyPitchDraft,
  firstVenueMustBePrimary,
  pitchCountLabel,
  pitchDraftToPayload,
  pitchDraftValid,
  pitchSummaryLabel,
  venueDetailsValid,
  wizardStepCount,
} from "./create-venue-logic.ts"

test("venueDetailsValid: needs a name and a resolved postcode", () => {
  assert.equal(venueDetailsValid({ name: "", resolvedLatitude: 1, resolvedLongitude: 1 }), false)
  assert.equal(venueDetailsValid({ name: "Ovalball UAT Ground", resolvedLatitude: null, resolvedLongitude: null }), false)
  assert.equal(venueDetailsValid({ name: "Ovalball UAT Ground", resolvedLatitude: 53.1, resolvedLongitude: -2.2 }), true)
})

test("pitchDraftValid: a named non-custom pitch is always valid", () => {
  const pitch = emptyPitchDraft("1")
  assert.equal(pitchDraftValid({ ...pitch, name: "Main Pitch" }), true)
  assert.equal(pitchDraftValid({ ...pitch, name: "" }), false)
})

test("pitchDraftValid: custom size needs real positive dimensions", () => {
  const base = { ...emptyPitchDraft("1"), name: "Training Pitch", physicalSizeCategory: "custom" as const }
  assert.equal(pitchDraftValid({ ...base, customLengthM: "", customWidthM: "" }), false)
  assert.equal(pitchDraftValid({ ...base, customLengthM: "20", customWidthM: "0" }), false)
  assert.equal(pitchDraftValid({ ...base, customLengthM: "20", customWidthM: "15" }), true)
})

test("canProceedFromPitches: at least one pitch, all individually valid", () => {
  assert.equal(canProceedFromPitches([]), false)
  assert.equal(canProceedFromPitches([{ name: "Main Pitch", physicalSizeCategory: "full", customLengthM: "", customWidthM: "" }]), true)
  assert.equal(
    canProceedFromPitches([
      { name: "Main Pitch", physicalSizeCategory: "full", customLengthM: "", customWidthM: "" },
      { name: "", physicalSizeCategory: "full", customLengthM: "", customWidthM: "" },
    ]),
    false
  )
})

test("pitchSummaryLabel: full/half/three-quarter with layout suffix", () => {
  assert.equal(pitchSummaryLabel({ physicalSizeCategory: "full", layout: "full_only", customLengthM: "", customWidthM: "" }), "Full size pitch")
  assert.equal(pitchSummaryLabel({ physicalSizeCategory: "half", layout: "two_halves", customLengthM: "", customWidthM: "" }), "Half size pitch, split into two halves")
  assert.equal(pitchSummaryLabel({ physicalSizeCategory: "three_quarter", layout: "four_quarters", customLengthM: "", customWidthM: "" }), "Three-quarter size pitch, split into four quarters")
})

test("pitchSummaryLabel: custom shows its own dimensions", () => {
  assert.equal(pitchSummaryLabel({ physicalSizeCategory: "custom", layout: "full_only", customLengthM: "22", customWidthM: "15" }), "Custom size pitch (22m x 15m)")
  assert.equal(pitchSummaryLabel({ physicalSizeCategory: "custom", layout: "full_only", customLengthM: "", customWidthM: "" }), "Custom size pitch")
})

test("pitchCountLabel: singular vs plural", () => {
  assert.equal(pitchCountLabel(0), "0 pitches")
  assert.equal(pitchCountLabel(1), "1 pitch")
  assert.equal(pitchCountLabel(3), "3 pitches")
})

test("pitchDraftToPayload: maps a stock-photo pitch, custom dims null unless custom", () => {
  const pitch = { ...emptyPitchDraft("1"), name: "  Main Pitch  ", description: " Full size grass pitch ", photo: { kind: "stock" as const, key: "pitch-match-02" } }
  const payload = pitchDraftToPayload(pitch)
  assert.equal(payload.name, "Main Pitch")
  assert.equal(payload.description, "Full size grass pitch")
  assert.equal(payload.cover_stock_key, "pitch-match-02")
  assert.equal(payload.custom_length_m, null)
  assert.equal(payload.custom_width_m, null)
})

test("pitchDraftToPayload: an uploaded (non-stock) photo never travels inline", () => {
  const pitch = { ...emptyPitchDraft("1"), name: "Main Pitch", photo: { kind: "upload" as const, localUri: "file://x.jpg", mimeType: "image/jpeg" } }
  assert.equal(pitchDraftToPayload(pitch).cover_stock_key, null)
})

test("pitchDraftToPayload: custom size carries its own numeric dimensions", () => {
  const pitch = { ...emptyPitchDraft("1"), name: "Training Pitch", physicalSizeCategory: "custom" as const, customLengthM: "20", customWidthM: "15" }
  const payload = pitchDraftToPayload(pitch)
  assert.equal(payload.custom_length_m, 20)
  assert.equal(payload.custom_width_m, 15)
})

test("firstVenueMustBePrimary: only when the club truly has none yet", () => {
  assert.equal(firstVenueMustBePrimary(0), true)
  assert.equal(firstVenueMustBePrimary(1), false)
  assert.equal(firstVenueMustBePrimary(4), false)
})

test("wizardStepCount: four steps with changing rooms, three without", () => {
  assert.equal(wizardStepCount(true), 4)
  assert.equal(wizardStepCount(false), 3)
})

test("changingRoomTypeLabel: the three canonical kinds", () => {
  assert.equal(changingRoomTypeLabel("full_size"), "Full size changing room")
  assert.equal(changingRoomTypeLabel("smaller"), "Smaller changing room")
  assert.equal(changingRoomTypeLabel("match_officials"), "Match officials changing")
})

test("changingRoomDraftValid: needs a name and a quantity of at least 1", () => {
  const room = emptyChangingRoomDraft("1")
  assert.equal(changingRoomDraftValid({ ...room, name: "" }), false)
  assert.equal(changingRoomDraftValid({ ...room, name: "Home Changing Room", quantity: 0 }), false)
  assert.equal(changingRoomDraftValid({ ...room, name: "Home Changing Room", quantity: 1 }), true)
  assert.equal(changingRoomDraftValid({ ...room, name: "Home Changing Room", quantity: 5 }), true)
})

test("canProceedFromChangingRooms: at least one room, all individually valid", () => {
  assert.equal(canProceedFromChangingRooms([]), false)
  assert.equal(canProceedFromChangingRooms([{ name: "Home Changing Room", quantity: 1 }]), true)
  assert.equal(canProceedFromChangingRooms([{ name: "Home Changing Room", quantity: 1 }, { name: "", quantity: 1 }]), false)
})

test("changingRoomCountLabel: singular vs plural", () => {
  assert.equal(changingRoomCountLabel(0), "0 changing rooms")
  assert.equal(changingRoomCountLabel(1), "1 changing room")
  assert.equal(changingRoomCountLabel(3), "3 changing rooms")
})

test("changingRoomDraftToPayload: maps name/type/quantity/stock key", () => {
  const room = { ...emptyChangingRoomDraft("1"), name: "  Home Changing Room  ", roomType: "full_size" as const, quantity: 2, photo: { kind: "stock" as const, key: "changing-modern-home-01" } }
  const payload = changingRoomDraftToPayload(room)
  assert.equal(payload.name, "Home Changing Room")
  assert.equal(payload.room_type, "full_size")
  assert.equal(payload.quantity, 2)
  assert.equal(payload.cover_stock_key, "changing-modern-home-01")
})

test("changingRoomDraftToPayload: an uploaded photo never travels inline, quantity floors at 1", () => {
  const room = { ...emptyChangingRoomDraft("1"), name: "Away Changing Room", quantity: 0, photo: { kind: "upload" as const, localUri: "file://x.jpg", mimeType: "image/jpeg" } }
  const payload = changingRoomDraftToPayload(room)
  assert.equal(payload.cover_stock_key, null)
  assert.equal(payload.quantity, 1)
})

test("changingRoomSummaryLabel: quantity only shown when more than one", () => {
  assert.equal(changingRoomSummaryLabel({ roomType: "full_size", quantity: 1 }), "Full size changing room")
  assert.equal(changingRoomSummaryLabel({ roomType: "smaller", quantity: 3 }), "Smaller changing room · Qty 3")
})

test("coverWriteFor: an untouched photo writes nothing; a changed choice writes once", () => {
  const ownPhoto = { coverImagePath: "club/venue-1/a.jpg", coverStockKey: null }
  const libraryPick = { coverImagePath: null, coverStockKey: "venue-dusk-01" }
  const nothing = { coverImagePath: null, coverStockKey: null }
  // The facility's own uploaded photo, untouched.
  assert.deepEqual(coverWriteFor({ kind: "existing", url: "https://x/a.jpg" }, ownPhoto), { kind: "keep" })
  // Re-saving a name must not re-stamp the same library choice.
  assert.deepEqual(coverWriteFor({ kind: "stock", key: "venue-dusk-01" }, libraryPick), { kind: "keep" })
  assert.deepEqual(coverWriteFor({ kind: "stock", key: "venue-pavilion-01" }, libraryPick), { kind: "stock", key: "venue-pavilion-01" })
  // A library choice over the club's own photo replaces it.
  assert.deepEqual(coverWriteFor({ kind: "stock", key: "venue-dusk-01" }, ownPhoto), { kind: "stock", key: "venue-dusk-01" })
  assert.deepEqual(coverWriteFor({ kind: "upload", localUri: "file://x.jpg", mimeType: "image/jpeg" }, nothing), { kind: "upload", localUri: "file://x.jpg", mimeType: "image/jpeg" })
})

test("coverWriteFor: Reset to Default clears a stored cover, and only when there is one", () => {
  assert.deepEqual(coverWriteFor({ kind: "none" }, { coverImagePath: "club/venue-1/a.jpg", coverStockKey: null }), { kind: "clear" })
  assert.deepEqual(coverWriteFor({ kind: "none" }, { coverImagePath: null, coverStockKey: "venue-dusk-01" }), { kind: "clear" })
  assert.deepEqual(coverWriteFor({ kind: "none" }, { coverImagePath: null, coverStockKey: null }), { kind: "keep" })
})

test("draftPhotoFromCover: the stored cover becomes the edit screen's starting draft", () => {
  assert.deepEqual(draftPhotoFromCover({ kind: "cover", url: "https://x/a.jpg" }), { kind: "existing", url: "https://x/a.jpg" })
  assert.deepEqual(draftPhotoFromCover({ kind: "stock", key: "pitch-match-02" }), { kind: "stock", key: "pitch-match-02" })
  assert.deepEqual(draftPhotoFromCover({ kind: "none" }), { kind: "none" })
})
