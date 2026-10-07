import { Stack } from "expo-router"

import { CreateVenueProvider } from "../../../../../src/venue/create-venue-context"

/** Add Venue's own draft, held for the lifetime of this stack -- gone the moment the wizard is left,
 * the same shape Create Training Plan's `create/_layout.tsx` already established. */
export default function AddVenueLayout() {
  return (
    <CreateVenueProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </CreateVenueProvider>
  )
}
