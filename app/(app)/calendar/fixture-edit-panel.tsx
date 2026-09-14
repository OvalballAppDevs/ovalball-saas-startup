"use client"

import { FixtureEditorInline } from "@/components/fixtures/fixture-editor-sheet"

/**
 * Calendar's Edit toggle, inside the fixture sheet that is already open.
 *
 * It is the one fixture editor (components/fixtures/fixture-editor-sheet.tsx),
 * rendered inline so nobody is stacked two sheets deep -- the same fields,
 * the same lock reasons and the same canonical writers as the Fixture Control
 * Centre and fixture detail. Calendar used to carry its own field list and
 * write most of it with a plain table update; a person with the same
 * authority saw a different editor depending on where they clicked.
 */
export function FixtureEditPanel({ fixtureId, onSaved, onCancel }: { fixtureId: string; onSaved: () => void; onCancel: () => void }) {
  return <FixtureEditorInline fixtureId={fixtureId} onSaved={onSaved} onCancel={onCancel} />
}
