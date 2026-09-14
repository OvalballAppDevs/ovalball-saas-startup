"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

import { FixtureEditorSheet } from "./fixture-editor-sheet"

/**
 * One Edit Fixture sheet per page, opened from any row, card or calendar
 * block inside it. A table of fifty fixtures holds one editor, not fifty.
 */

const FixtureEditorContext = createContext<{ openEditor: (fixtureId: string) => void } | null>(null)

export function FixtureEditorProvider({ children, detailBasePath }: { children: ReactNode; detailBasePath?: string }) {
  const [fixtureId, setFixtureId] = useState<string | null>(null)
  const openEditor = useCallback((id: string) => setFixtureId(id), [])
  const value = useMemo(() => ({ openEditor }), [openEditor])
  return (
    <FixtureEditorContext.Provider value={value}>
      {children}
      <FixtureEditorSheet
        fixtureId={fixtureId}
        onClose={() => setFixtureId(null)}
        detailHref={fixtureId && detailBasePath ? `${detailBasePath}/${fixtureId}` : undefined}
      />
    </FixtureEditorContext.Provider>
  )
}

export function useFixtureEditor() {
  const ctx = useContext(FixtureEditorContext)
  if (!ctx) throw new Error("useFixtureEditor must be used inside FixtureEditorProvider")
  return ctx
}
