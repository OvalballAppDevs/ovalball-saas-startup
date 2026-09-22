# Convergence Step 18 — Application UX 4–7

**PRODUCT IMPLEMENTATION COMPLETE — HARDENING PENDING.** From `2289672` (Step 17). Local only; nothing
pushed, nothing released, no migration-history repair, no canonical gate.

## 1. The canonical scopes, recovered

From `docs/product/OVALBALL_APPLICATION_SHELL_UX_AUDIT.md`'s own slice table — the only place the
repository defines them:

| slice | outcome | acceptance |
|---|---|---|
| **UX-4 Mobile shell** | **Primary destinations one tap away** | **bottom bar, 44px targets, no overflow**; focus order; items still come from `buildNavItems` |
| **UX-5 Club nav grouping + bin relocation** | **Club nav matches Site Admin's IA** | grouped sections; same IA on mobile |
| **UX-6 Return paths** | **No dead ends** | back affordance on the **public club home, Rugby Hub, Site Admin exit** |
| **UX-7 Accessibility + contrast** | **Measured, not asserted** | axe clean on shell routes; **320px axe clean**; contrast measured |

Named elsewhere as still UX-4's: *"the floating overlays over the bottom of the content… 'Ask Ovie' and
the avatar bubble still float over the bottom of the content"*.

## 2. What was already superseded

**Three of the four slices were substantially done already** — by later convergence work, not by UX.
Measured in the running application rather than inferred:

- **UX-5, entirely.** `buildClubSections` groups the club catalogue through **the same `groupNavItems`**
  as Site Admin, with the identical "unmapped destinations land in *More* rather than vanishing" rule, and
  `/club/calendar/deleted-events` is already inside **Club Management**. `NavSections` is one renderer
  shared by sidebar and drawer.
- **Most of UX-4.** The sticky global top bar, the shared hamburger IA, `size-11`/`min-h-11` targets and
  `env(safe-area-inset-*)` all exist.
- **Part of UX-6.** Rugby Hub already returns to `/dashboard`.
- **All 38 static nav destinations resolve** to a real page — no dead links to clean up.

None of it was rebuilt. The supersession is recorded in `CONVERGENCE_STEP_18_ARCHAEOLOGY.md`.

## 3. Major visible changes

**A mobile bottom bar.** UX-4's outcome is *one tap*; the shell gave you two — open the hamburger, then
choose. Every context now gets a bar of its own primary jobs plus **More**, which opens the drawer that
still holds everything:

| context | cells |
|---|---|
| Club | Dashboard · Fixtures · Teams · Calendar · More |
| Governing Body | Overview · Clubs · Competitions · People & Access · More |
| Family | Dashboard · Fixtures · Calendar · Rugby Hub · More |
| Site Admin | Dashboard · Clubs · Users · Fixtures · More |

**The shell reserves its own furniture.** The floating widget's allowance was a per-page `pb-28` that
**8 of about 100** files remembered; everywhere else content could sit under it. Declared once now, and the
widget raised so it clears the new bar instead of sitting on it.

**A way out of the public club home.** *Back to Ovalball*, for signed-in visitors only — and it matters
more than when the audit was written, because Step 16's affiliated-club list links straight into it.

**That page also stopped shaking sideways** — 23px of horizontal overflow at 390px for a signed-in
visitor, now 0.

## 4. Navigation, context and mobile

**Navigation:** no destination added, removed or renamed. The bar can only return what `buildNavItems`
already produced — UX-4's stated authority invariant — and the decision lives in
`lib/app-context/build-nav-items.ts`, not in a phone-only component, because a native client will need the
same answer (§29).

**Context:** unchanged and re-proven. One identity moves Club → Governing Body → Club with the sidebar
rebuilt each time and nothing blended (`87` F4–F6). **§8's person-first identity block was evaluated as
part of the whole shell and kept** — it is the only thing on screen distinguishing a Club Admin acting for
their club from the same person acting for their county. Recorded for your review, not reverted.

**Mobile:** 320px and 390px on every context. 44px+ cells (measured 56px), nothing truncated, no overflow,
bar flush to the bottom edge, safe-area insets honoured. §25's tables were already right — the fixture
spreadsheet still becomes cards on a phone and a real spreadsheet on a tablet (`23` 31/31).

## 5. Accessibility result

**axe at WCAG AA on four shell routes, at desktop *and* at 320px: 0 violations.** Not "0 introduced" —
zero. Plus one `h1` per shell route, keyboard focus into the bar in bar order, the active cell marked by a
**border as well as colour**, and the widget's panel width-capped so a 320px phone cannot be overflowed.

## 6. Principal browser journey

**`87-shell-coherence` — 52/52.** Sign in → landing → identity and context → People → Teams → switch to
the county → switch back → public club home → back into the app, plus the bottom bar measured per context
at two widths, the drawer still complete, UX-5's grouping, UX-6's return paths and UX-7's axe pass.

Regression, all green: `67-club-desk-hierarchy` **28/28** (UX-3, three viewports) · `23-fixture-ops-viewports`
**31/31** · `page_identity` **17/17** (UX-1) · `identity_and_context` **21/21** (UX-2) ·
`parent_player_identity` **9/9** · `verify-admin-nav` **29/29** · tsc and build clean · lint at the
unchanged **181/5/176**.

## 7. FUNCTIONS BEFORE 36 · AFTER 38 · LOST 0

Item by item in `CONVERGENCE_STEP_18_FUNCTIONALITY_MATRIX.md`. Nothing became unreachable: the drawer
still renders the whole catalogue, and the bar is a shortcut rather than a replacement.

## 8. Three stale assertions corrected, not worked around (§33)

- `verify-admin-nav`'s *"grouping is applied only in a Site Admin context"* was **green and untrue** —
  UX-5 gave clubs the same treatment. It now asserts what the layout does.
- Its parent/player settings check pinned an exact pair of `case` labels and **had been failing before this
  step** (confirmed at `83c37e0`) because `family` joined the chain. It now asserts the rule.
- `identity_and_context` and `parent_player_identity` build `SessionContext` through `as unknown as`, so
  **Step 15's `governingBodies` field passed the compiler and threw at runtime**. Found by this step,
  caused by Step 15, fixed here.

## 9. Owner review — a short route, not a QA script

Five minutes on a phone, then five on a laptop. Sign in as `uat.preston.admin@ovalball.test`.

**On a phone (or a 390px window):**
1. Land on the dashboard. **There is a bar along the bottom now** — Dashboard, Fixtures, Teams, Calendar,
   More. Tap two of them. *Is that the right four for a club?*
2. Tap **More**. *Does the drawer still feel like the whole app?*
3. Switch context to **Ovalball Review County RFU**. The bar becomes Overview, Clubs, Competitions,
   People & Access. *Does that feel like changing jobs rather than changing apps?*

**On a laptop:**
4. From the county's **Clubs**, open a club — you land on its public home. **Back to Ovalball** is top
   left. *Is that where you'd look for it?*
5. Look at the sidebar identity block: your name, then the context and role beneath. *Does it tell you who
   and where you are — and is that better than the club's name being the headline?* **This is the one
   directional decision I'd like your ruling on** (§8); I kept it, and said why.

**What I'd most like to know:** does it feel like one product now, and is the bottom bar carrying the right
four destinations in each context? The bar's choices are a curated list with a sensible fallback
(H17.1) — easy to change once you have used it.

## 10. Hardening debt

Recorded as **H17** in `HARDENING_RELEASE_READINESS_LEDGER.md`: the bottom bar's curated map (H17.1), the
four-entry bar-label override (H17.2), the `as unknown as SessionContext` fixture pattern (H17.3), and
`navigation_architecture.test.mts` failing with `ERR_MODULE_NOT_FOUND` before any assertion — pre-existing
and not chased (H17.4). The dev-only webfont difference and the identity-block ruling remain owner debt.
