import { createContext, useContext, useMemo, useState } from "react"

import { EMPTY_VENUE_DRAFT, type VenueWizardDraft } from "./create-venue-logic"

/**
 * ADD VENUE DRAFT -- one piece of state for the lifetime of the wizard's own navigator stack
 * (`app/(tabs)/admin/venues/new/_layout.tsx`), the same shape Create Training Plan's own
 * `draft-context.tsx` already established: nothing is written to the server until Review & Create,
 * and leaving the wizard (Cancel, or navigating away) unmounts this provider -- a fresh Add Venue
 * always starts empty.
 */
interface CreateVenueContextValue {
  draft: VenueWizardDraft
  setDraft: (next: VenueWizardDraft | ((prev: VenueWizardDraft) => VenueWizardDraft)) => void
  reset: () => void
}

const CreateVenueContext = createContext<CreateVenueContextValue | null>(null)

export function CreateVenueProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<VenueWizardDraft>(EMPTY_VENUE_DRAFT)
  const value = useMemo<CreateVenueContextValue>(
    () => ({
      draft,
      setDraft,
      reset: () => setDraft(EMPTY_VENUE_DRAFT),
    }),
    [draft]
  )
  return <CreateVenueContext.Provider value={value}>{children}</CreateVenueContext.Provider>
}

export function useCreateVenueDraft(): CreateVenueContextValue {
  const ctx = useContext(CreateVenueContext)
  if (!ctx) throw new Error("useCreateVenueDraft must be used within CreateVenueProvider")
  return ctx
}
