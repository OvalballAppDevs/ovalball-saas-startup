# CA-M11.2 — Pitch Allocation native interaction map

For each interaction: WEB BEHAVIOUR / DOMAIN CALCULATION / SERVER OPERATION /
MOBILE EQUIVALENT / PARITY STATUS. Web is the specification; this pass does
not redesign the website. "Mobile" is the native Expo app in `apps/mobile/`
only.

## 1. The board itself

**WEB.** `app/(app)/calendar/pitch-allocation/pitch-allocation-board.tsx`: a
CSS-grid timeline, 08:00–23:00, 15-minute slots at 22px each, pitches as rows,
pointer-event drag with a `hitTest` against each row's rect.

**DOMAIN.** `packages/contracts/src/pitch-allocation/{occupancy,lanes,auto-allocate}.ts`
compute the occupied window (warm-up → match → pack-up) and lane assignment;
neither client repeats this arithmetic.

**SERVER.** `getPitchAllocationBoard(supabase, clubId, dateIso)` reads
fixtures, unallocated fixtures, pitches, policy, conflicts, tournaments and
training for one day.

**MOBILE.** `src/pitch-allocation/geometry.ts` mirrors the website's constants
exactly (`START_MINUTES=480`, `END_MINUTES=1380`, `SLOT_MINUTES=15`, pinned
equal to the website's own constants in
`pitch_allocation_board_ca11_2.test.mts`), at two touch-appropriate pixel
scales (compact 22px/slot, comfortable 48px/slot) instead of one fixed 22px —
a phone needs a bigger target than a mouse pointer. `src/pitch-allocation/board.tsx`
renders pitches as lanes down the screen with a frozen hour header and a
frozen pitch-label column, both scrollable together.

**PARITY.** Same day, same slot size, same occupied-window and lane
primitives. Presentation is native (vertical lanes + horizontal time,
independently scrollable) rather than a CSS grid, which is the correct native
equivalent of the same domain model, not a redesign of it. **PARITY.**

## 2. Press, lift, drag

**WEB.** `pointerdown` on a card begins a drag; the card follows the pointer;
release runs `hitTest` against every row.

**DOMAIN.** None — this is pure interaction.

**SERVER.** None — a drag stages only.

**MOBILE.** `Gesture.Pan().enabled(canManage).activateAfterLongPress(350)`:
the fixture block does not move on a light touch, only on a genuine
press-and-hold, which is the correct native equivalent of a mouse-only
`pointerdown` (a touchscreen has no hover to distinguish a tap from the start
of a drag). On activation the block lifts with a spring animation (scale
1.03, elevated shadow) and a medium haptic impact (`haptic.lift`, skipped
under `expo-haptics` on web/simulator without an engine). Translation is
driven by `useSharedValue` on the UI thread; React is told of the gesture only
when the snapped slot or lane changes (`updatePreview`'s key-comparison
guard), not on every pixel of movement.

**PARITY.** The website has no equivalent "lift" affordance because a mouse
pointer needs none; the phone's press-and-hold + lift is the native
equivalent of "a drag has begun", required because a touchscreen has no
hover state to signal intent. **PARITY** (native equivalent, not a redesign).

## 3. Horizontal drag → time, vertical → pitch, diagonal → both

**WEB.** `hitTest`'s x offset gives the row-relative pixel, converted to a
15-minute slot; the y position selects the row (pitch).

**DOMAIN.** `xToSnappedMinutes` / `yToLaneRow` mirror the website's own
`START + round(offsetX / PX_PER_SLOT) * 15` and row lookup respectively.

**SERVER.** None yet — still a preview.

**MOBILE.** `geometry.ts`'s `xToSnappedMinutes(x, scale)` and
`yToLaneRow(y, rows)` are pure functions of the drag position; `board.tsx`'s
`updatePreview` computes both every frame the gesture reports and derives a
single `pitch:lane:minutes` key, so a diagonal drag (both axes moving at
once) is not two separate updates racing each other but one snapped position.
Pinned in `pitch_allocation_board_ca11_2.test.mts` ("time and pixels
round-trip", "a vertical position maps to exactly one lane").

**PARITY.**

## 4. Snap to the canonical 15-minute slot

**WEB.** `START + round(offsetX/PX_PER_SLOT)*15`, clamped to `[08:00, 22:45]`.

**MOBILE.** `xToSnappedMinutes` performs the identical round-and-clamp,
clamped to `[START_MINUTES, END_MINUTES - SLOT_MINUTES]` — the same bound.
Pinned: dragging to any position between two slots always resolves to the
nearer one, never an off-grid time. **PARITY.**

## 5. The occupied window follows the card while it moves

**WEB.** The pack-up band is drawn from the same policy buffers, though the
website's own pack-up band has a known visual quirk (drawn at
`startOffset + max(width, 90)`, not the literal end time) that this pass does
not "fix" on mobile, per "do not redesign web".

**DOMAIN.** `fixtureOccupiedWindow(fixture, buffers)` is the one primitive;
`verify-pitch-allocation-shared.mjs` fails the build if any caller
re-derives it with its own arithmetic.

**MOBILE.** The board's ghost preview and every rendered block call
`fixtureOccupiedWindow` directly (`board.tsx`); the screen's drag-status strip
does too, after this session's fix removed a local `-warmUpMinutes` /
`+packUpMinutes` calculation the review caught. Pinned:
`pitch_allocation_board_ca11_2.test.mts` greps every mobile pitch-allocation
file for hand-rolled buffer arithmetic and fails if any exists.

**PARITY**, and mobile draws the pack-up band at its literal end time rather
than reproducing the website's `max(width,90)` visual quirk — a faithful
rendering of the same domain value, which is a legitimate native choice, not
a correction of the website (the website's own band remains unchanged).

## 6. Conflict shown before drop

**WEB.** Live client recompute during drag drops training/event occupants
from the tournament check (a known web asymmetry, left as-is).

**DOMAIN.** `detectConflicts` / `detectResourceConflicts` /
`detectTournamentConflicts`, all shared.

**MOBILE.** `previewFor` (screen) → `placementPreview` (staging.ts) runs the
proposed placement through `previewPlacement` over the **draft** board (every
earlier staged move/removal already applied), so the phone's live preview
does include training/event occupants — a strictly stronger check than the
web's, not a divergence that weakens anything. Shown in the drag strip below
the board with the reason text, and as a red dashed ghost when the conflict
is hard. Pinned: "the ghost's conflict is asked of the shared detectors over
the draft, before the drop."

**PARITY** (mobile is a superset check; nothing web accepts is rejected on
mobile, and nothing mobile shows as clear that the shared engine would
actually reject).

**A hard conflict is advisory, not enforced, on both clients — confirmed by
reading the website's own `hitTest` and by `update_fixture_schedule` itself.**
The website's `hitTest` only refuses a drop when no row matched at all;
`conflict.severity === "hard"` only changes colour and icon, never blocks the
drop. The server RPC performs no occupancy check whatsoever — it authorises,
validates the pitch belongs to the home club, and writes. A club may
legitimately want to stage a double-booking temporarily while it sorts out
logistics, and the shared `laneCount`/`assignBookingLanes` model exists
precisely because some pitches genuinely host more than one fixture at once.
Mobile matches this exactly: the ghost preview and `previewFor` show the
conflict and its reason before the drop, and the Move sheet's "Stage This
Move" is not disabled by a conflict — the same as web. Verified live this
session against a genuine second fixture inserted for the purpose: dragging
the target fixture onto the exact overlapping window showed "Overlaps with
Men's 1st Team v …" before staging, and the database was confirmed unchanged
because the change was reviewed and closed rather than saved.

## 7. Drop stages only; never writes on the gesture

**WEB.** Drop inserts into `pendingChanges: Map<fixtureId, {pitchId,
kickoffTime}>`; nothing is written until Save.

**MOBILE.** `staging.ts`'s `StagedChanges = Map<string, PendingChange>`,
`stageMove` / `stageRemoval` / `unstage`, all pure. `board.tsx`'s
`endPreview` calls `onDrop` only on a successful drop onto a lane; the screen
never calls a Supabase operation from inside the gesture handlers. Pinned:
"the board never talks to the server; it only stages."

**PARITY.**

## 8. Release off every row cancels

**WEB.** No row matched → the drag is abandoned, nothing staged.

**MOBILE.** `endPreview(fixtureId, dropped)`: no lane under the release point
→ `haptic.refuse()`, no `onDrop` call.

**PARITY.**

## 9. Auto-scroll near the edges of a long board

**WEB.** N/A — the whole grid is visible on a desktop viewport.

**MOBILE.** New for a phone: `AUTO_SCROLL_EDGE=48`/`AUTO_SCROLL_STEP=14`,
`autoScrollVelocity(position, extent)` drives a 16ms interval scroll of
whichever axis (horizontal timeline, vertical lane list) the finger is near
the edge of while dragging, so a long day or a club with many pitches is
still reachable one-handed. Pinned: "auto-scroll only near an edge, faster the
closer the finger." **NATIVE ADDITION**, required because a phone screen
shows far less of the board at once than a desktop viewport; not a
divergence from web behaviour, which has nothing to scroll.

## 10. Unallocated fixtures are draggable onto a lane

**WEB.** An unallocated-fixtures tray at the side; its cards are draggable
onto any row exactly like a placed fixture.

**MOBILE.** `UnallocatedTray` renders inside `PitchBoard` beneath the lanes
(so it does not fight the board for screen space); its `TrayChip`s use the
identical `Gesture.Pan` + `updatePreview`/`endPreview` plumbing as a placed
fixture's block, with `grabOffsetX = 0`.

**PARITY.**

## 11. Removal from a pitch

**WEB.** No dedicated board control; the website only supports moving, not an
explicit "take this off its pitch" affordance on the grid itself (the pitch
can be cleared from the fixture editor).

**DOMAIN.** `clearFixturePitch` (calls `update_fixture_pitch` with a null
pitch).

**MOBILE.** `FixtureDetailSheet` offers a visible "Remove from Pitch" action;
this stages a removal (`stageRemoval`) rather than writing immediately, and
Save applies it through the same canonical `clearFixturePitch` operation the
website's own clear-pitch action uses. Pinned: "removal from a pitch is a
visible control", and Save's payload maps a removal to
`rpc("update_fixture_pitch"`, matching the website's own clear path exactly.

**MOBILE ADDITION over the board surface itself**, using an existing
canonical web operation — not a new authority, not a new write path.

## 12. Accessible non-drag Move

**WEB.** A "Move" dialog: `#move-pitch` select + `#move-time` field, same
staging model.

**MOBILE.** `MoveSheet`: native `DateTimePicker mode="time" minuteInterval={15}`
(the canonical slot, so a typed time cannot go off-grid) plus a pitch radio
list (suitable pitches first), the reserved-window sentence and the same
`previewFor` conflict check, staging through `onStage` → the identical
`stageMove` the drag path uses. Reachable from `FixtureDetailSheet`'s "Move
Fixture" action, so every fixture the board shows has a non-drag path to the
same outcome.

**PARITY.**

## 13. Read-only for view-only holders

**WEB.** `venue.pitch_allocation.view` without `.manage` renders the identical
board with every control removed.

**MOBILE.** `PitchBoard`'s every `Gesture.Pan` is `.enabled(canManage)`; a
view-only holder sees the identical lanes, blocks, buffers and conflicts with
no draggable affordance and no Save/Discard bar (the screen only renders that
bar `{caps.manage && (…)}`). Pinned: "read-only without the manage key" (the
Pan gate) and no dead controls render.

**PARITY.**

## 13b. Kick-off change semantics: a save is not always an application

**WEB and SERVER, audited this session.** `update_fixture_schedule`
(`supabase/migrations/20270549000000…`) treats PITCH and VENUE as ordinary
writes — they apply immediately and unconditionally once authority is
checked, with no negotiation. **KICKOFF is different, and only when the
fixture has a real, active opponent club on Ovalball** (`v_is_external` is
false): the first kickoff change on a shared fixture writes
`kickoff_amendment_proposed_date/time/by/by_club_id`, not `kickoff_time`
itself, and returns `kickoff_proposed = true`; the opposing club confirms by
proposing the identical value back, which then applies it and clears the
proposal; a different value is a counter-proposal, still pending. An
external-opponent (or no-opponent) fixture, or a caller with
`site.fixtures.support`, always applies the kickoff immediately. Diagonal
drags are therefore not always one atomic write from the fixture's point of
view: dragging Pitch 2/10:30 to Pitch 3/11:30 on a shared fixture applies the
pitch change immediately and stages a *kickoff proposal* that is not yet the
canonical `kickoff_time` — both dimensions are represented in the one staged
change and the one `allocateFixtureOnPitch` call, but the server may apply
one and merely propose the other. Neither client invents a second save path
for this: it is exactly what one call to the one RPC already does.

**What the website shows for this, audited from its own source:** only a
save-time count — `"${proposedCount} kick-off change(s) sent to the opposing
club for confirmation"` (`pitch-allocation-board.tsx`) — never an on-card
"awaiting confirmation" badge; the board simply re-renders from the
refreshed canonical `fixtures` row afterwards, which is the true last-agreed
value, so it never shows a *false* confirmed time, only the *last confirmed*
one. **Mobile matches this exactly**, and adds one honest, purely additive,
session-local strengthening beyond a mirrored toast: `saveChanges()` records
which staged fixtures came back with `kickoffProposed: true`, and
`FixtureDetailSheet` shows an explicit line — "Kick-off change awaiting
confirmation. The time above is still the last confirmed kick-off…" — if that
exact fixture is reopened before the next full reload. This required no
change to the shared package or to any web file: `AllocationFixture` does not
carry the amendment columns at all today, so neither client can reconstruct
this state from a board read alone once the app is closed and reopened — that
is a shared-package gap, not a mobile-only one, and extending
`getPitchAllocationBoard`'s query and `AllocationFixture` to carry
`kickoff_amendment_proposed_*` (so *both* clients could show a durable
"awaiting confirmation" state on reload, not just for the remainder of the
save's own session) is recorded here as a real, worthwhile follow-up and was
not done in this pass, since it touches the shared type every board consumer
reads and is exactly the kind of change this slice's own rule reserves for a
deliberate, reviewed follow-up rather than a side effect of a mobile
interaction pass.

**PARITY**, plus one additive, reviewed strengthening; a durable
(reload-surviving) version of the same state is a recorded shared-package
follow-up, not silently done and not silently skipped.

## 14. Save: re-authorise, then write, sequentially, honestly

**WEB.** Loops staged changes sequentially; a failure stays staged; message
counts successes and failures by name; `router.refresh()` always runs.

**SERVER.** `allocateFixtureOnPitch` → `update_fixture_schedule(...,
p_source: "PITCH_ALLOCATION")`; `clearFixturePitch` → `update_fixture_pitch`.

**MOBILE.** `saveChanges()` first re-asks `readPitchAllocationCapabilities`;
if `.manage` is gone it discards nothing silently — it explains, clears
staging, and reloads the board (this is a stronger behaviour than the
website, which does not re-probe capabilities before its save loop; kept
because the phone's session can go stale for longer between the drag and the
tap than a web page's). It then loops `savePayload(pending)` in staging
order, one canonical operation per fixture, leaving failures staged and
reporting "`N` change(s) saved. `M` could not be saved and stay staged: …",
matching the website's own wording pattern. `load(dateIso)` always runs
afterwards, matching the website's unconditional `router.refresh()`.

**PARITY**, with capability re-probing as a documented native strengthening.

## 15. Discard

**WEB.** Resets to the initial board; a `beforeunload` + confirm guard fires
on a dirty navigation attempt.

**MOBILE.** `discardChanges()` clears the staged Map. `navigation.addListener("beforeRemove", …)`
intercepts a dirty back-navigation and opens `LeaveSheet` (Save Changes
(N) / Discard Changes / Stay Here) exactly mirroring the website's
confirm/cancel/save choice, native-appropriate as a sheet rather than a
browser `confirm()`. Discarding more than one staged change from the overflow
menu asks the same sheet rather than discarding silently.

**PARITY.**

## 16. Auto Allocate / Recalculate All enablement and semantics

**WEB.** Auto Allocate disabled when `autoAllocating || isDirty ||
unallocated.length === 0`; Recalculate All disabled when `autoAllocating ||
isDirty || total === 0`; both build a **proposal**, never write directly.

**MOBILE.** Same three conditions verbatim in the overflow sheet (pinned:
"Auto Allocate and Recalculate All keep the website's enablement and proposal
semantics"), both call the identical `createAllocationProposal(...,
recalculateAll)`, reviewed in a sheet, staged only for eligible items
(`!isUnallocated && conflictSeverity !== "hard"`), then the proposal itself is
discarded server-side once its eligible items are staged — matching the
website's review-then-stage-then-discard flow.

**PARITY.**

## 17. Date navigation

**WEB.** A date picker plus Today / Next home fixture shortcuts; dirty
navigation is guarded.

**MOBILE.** `‹ date ›` strip with a native `DateTimePicker mode="date"`,
Today and Next Home Fixture shortcuts calling `nextHomeFixtureDate`, and
`navigateTo()` routes every date change through the same dirty-check as
back-navigation (stages a `LeaveSheet` prompt rather than silently discarding
or silently blocking).

**PARITY.**

## 18. Compact chrome; the board is the dominant object

**WEB.** A desktop page has room for a full toolbar beside the grid.

**MOBILE.** The header is back + crest + title + full-screen toggle +
overflow, one row; the day/summary strip is a second compact row; the board
fills the remainder of the screen; Save/Discard is the one bottom bar. Full
Screen Board hides the crest/club-name line and the day/summary row, leaving
header + board + save bar only. This directly answers the owner's rejection
of "four equal-weight buttons above a compressed board" from the CA-M11.1
review.

**NATIVE DECISION**, not present on web because a desktop viewport does not
need to economise chrome the way a phone does.

## 19. Scale, not zoom

**Decision recorded here.** A pinch-zoom gesture was considered and rejected
in favour of two named presets (Compact/Comfortable) in the overflow sheet,
because a scheduling board must keep the 15-minute grid legible and
predictable at all times; free zoom would let a person zoom to a point where
slots become ambiguous to tap, which a fixed pixel-per-slot preset cannot.

## 20. Landscape

**Decision recorded here.** `app.config.ts` keeps `orientation: "portrait"`
for the whole app. Enabling landscape only for this one screen would need
`orientation: "default"` plus a runtime `expo-screen-orientation` lock/unlock
around navigation into and out of the board — a shell-wide change with
failure modes (a lock left engaged if the screen unmounts abnormally) outside
this narrow pass's scope. Portrait-first, full-screen-board mode and the two
scale presets were judged sufficient for the stated bar (a Fixture Secretary
standing on the touchline) without destabilising the app shell. This is
recorded as an explicit product decision for the owner to revisit, not a
silent omission.

## 21. Haptics, Reduce Motion, VoiceOver

**MOBILE.** `haptics.ts`: medium impact on lift, selection tick on a slot/lane
change, warning notification on a refused drop, light impact on a staged
drop — all no-ops off native and wrapped in try/catch (a simulator with no
haptic engine must not throw). `useReduceMotion()` (`src/a11y/reduce-motion.ts`)
is read by the board and used to skip the spring lift animation.
`accessibilityLabel`s on every block state the reserved interval, staged
state, conflict reason and "press and hold to move"; pitches state lane count
and any club-event reservation.

**PARITY** (equivalent affordances the website expresses through cursor/hover
states that have no touchscreen equivalent).

## 22. Performance

Drag position lives entirely in `useSharedValue`s on the UI thread;
`runOnJS` calls React (`haptic.*`, `updatePreview`/`endPreview`) only at
gesture-lifecycle edges and on an actual snapped-key change, not per frame.
`FixtureBlock`s and lane rows are memoised; the placed-block list recomputes
only when fixtures, rows, conflicts or buffers change.

## Summary

Every interaction is either exact parity with the website's domain behaviour
through the identical shared package, or a documented native-appropriate
addition (press-and-hold, auto-scroll, scale presets, compact chrome,
capability re-probe on save) required by the difference between a mouse-driven
desktop grid and a finger-driven phone screen. No web behaviour was changed to
produce this map.
