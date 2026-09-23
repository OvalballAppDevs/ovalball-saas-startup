import { useCallback, useEffect, useState } from "react"
import { useLocalSearchParams } from "expo-router"
import { View } from "react-native"

import { supabase } from "../../../../src/auth/supabase"
import { loadFixtureSurface, type FixtureSurface } from "../../../../src/fixtures/surface"
import { FixtureConsole } from "../../../../src/fixtures/fixture-console"
import { MatchCentre } from "../../../../src/fixtures/match-centre"
import { colour } from "../../../../src/design/tokens"

/**
 * ONE PHYSICAL FIXTURE, ONE ADDRESS — and the server decides what it looks like.
 *
 * `/fixtures/<id>` is the canonical address on BOTH clients. It is what the
 * website routes to, what `notificationHref` emits for every fixture
 * notification, what a shared link carries, and what expo-router restores after
 * the app is killed. There is exactly one of it, which is the platform rule: one
 * physical fixture is one `fixture_id` and one canonical route.
 *
 * THIS CLIENT HAD TURNED THAT ONE ADDRESS INTO THE ADMIN ONE. The app grew two
 * screens -- a participant Match Centre and an operational console -- and gave the
 * console the canonical path. So every canonical route into a fixture landed a
 * PARENT in fixture administration: the bell notification "Can Pippa play on
 * Saturday?" resolves to `/fixtures/<id>`, and so did a deep link, a shared link
 * and restored navigation state. Closing it in one list's `onPress` could never
 * have been enough, because the address itself was the defect.
 *
 * SO THE ADDRESS IS NOW AUTHORITY-AWARE, and the console is no longer addressable
 * at all -- it is a component this gate renders, not a route anybody can type. A
 * manually constructed URL cannot reach it because there is no URL for it.
 *
 * THE DECISION IS THE SERVER'S. `get_match_centre_capabilities` is the canonical
 * per-fixture resolver -- the same one the Match Centre itself reads and the same
 * `internal.can` chain every mutation re-runs before it writes. Not a role label,
 * not the switcher context, not team membership: `can_manage_fixture` for THIS
 * viewer and THIS fixture.
 *
 * AND IT FAILS TOWARDS THE PARTICIPANT. A read that errors, a fixture nobody may
 * see and a viewer with no authority all render the Match Centre, which is itself
 * server-filtered and says the fixture is unavailable when it is not theirs. The
 * worst case is somebody being shown the surface with fewer powers, which is the
 * only acceptable direction to be wrong in.
 */
export default function Fixture() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const [surface, setSurface] = useState<FixtureSurface | null>(null)

  const decide = useCallback(async () => {
    if (!fixtureId) return
    setSurface(await loadFixtureSurface(supabase, fixtureId))
  }, [fixtureId])

  useEffect(() => {
    setSurface(null)
    void decide()
  }, [decide])

  /*
    NOTHING IS DRAWN UNTIL THE ANSWER IS IN.

    Rendering the participant surface first and swapping it for the console would
    make the screen flicker between two products; rendering the console first
    would show administration to somebody who turns out not to hold it, however
    briefly. Each surface already draws its own skeleton once it is chosen, so
    this is a plain ground rather than a third loading design.
  */
  if (surface === null) return <View style={{ flex: 1, backgroundColor: colour.chalk }} />
  return surface === "operations" ? <FixtureConsole /> : <MatchCentre />
}
