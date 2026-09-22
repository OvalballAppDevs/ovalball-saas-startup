# Convergence Step 18 — Application UX 4–7 — archaeology

Measured against `2289672`, before any code. The canonical source is
`docs/product/OVALBALL_APPLICATION_SHELL_UX_AUDIT.md` §"Slices" (the table at its own line 294), which
is the only place the repository defines these four slices.

## UX-4 CANONICAL SCOPE

> **UX-4 Mobile shell** — Outcome: **Primary destinations one tap away.** Routes/components:
> `app-mobile-nav.tsx`, `nav-sections.tsx`. Authority invariant: **items still come from
> `buildNavItems`**. Desktop acceptance: unchanged. Mobile acceptance: **bottom bar, 44px targets, no
> overflow**. A11y acceptance: **focus order**.

Named elsewhere in the audit as still UX-4's: *"the floating overlays over the bottom of the content,
the hamburger information architecture, the global top bar and the wider mobile shell"*, and *"'Ask
Ovie' and the avatar bubble still float over the bottom of the content (**UX-4**)"*.

## UX-5 CANONICAL SCOPE

> **UX-5 Club nav grouping + bin relocation** — Outcome: **Club nav matches Site Admin's IA.**
> Routes/components: `build-nav-items.ts`, `nav-sections.tsx`, `club/settings`. Authority invariant:
> grouping is presentation over a filtered list. Desktop: **grouped sections**. Mobile: **same IA**.

Named elsewhere: *"navigation is still flat for clubs and grouped only for Site Admin (UX-5); 'Deleted
Calendar Events' is still top-level (UX-5)"*.

## UX-6 CANONICAL SCOPE

> **UX-6 Return paths** — Outcome: **No dead ends.** Routes: **public club home, Rugby Hub, Site Admin
> exit**. Authority invariant: none. Desktop acceptance: **back affordance present**.

## UX-7 CANONICAL SCOPE

> **UX-7 Accessibility + contrast pass** — Outcome: **Measured, not asserted.** Scope: **shell-wide**.
> Desktop: **axe clean on shell routes**. Mobile: **320px axe clean**. A11y: **contrast measured**.

---

## Reconciliation: what Steps 4–17 already superseded

The product has moved a long way since the audit was written, and most of this is already done. Measured
in the running application, not inferred.

| audit item | state now | verdict |
|---|---|---|
| **UX-5 club nav grouping** | `buildClubSections` groups the club catalogue through **the same `groupNavItems`** as `buildSiteAdminSections`, with the identical "unmapped destinations fall into a *More* section rather than vanishing" rule | **SUPERSEDED — complete.** The audit asked for club nav to match Site Admin's IA; it now shares the function |
| **UX-5 bin relocation** | `/club/calendar/deleted-events` is inside the **Club Management** section, with a comment in `build-nav-items.ts` saying it lives *"with the other things you go looking for on purpose, rather than beside the jobs people arrive to do"* | **SUPERSEDED — complete** |
| **UX-5 same IA on mobile** | `NavSections` is one renderer shared by the desktop sidebar and the mobile drawer, explicitly *"shared deliberately… two renderers would drift"* | **SUPERSEDED — complete** |
| **UX-4 global top bar** | `app-mobile-nav.tsx` renders a `sticky top-0 z-40 … md:hidden` bar | **SUPERSEDED — complete** |
| **UX-4 hamburger IA** | the drawer renders the shared `NavSections`, same grouping as desktop | **SUPERSEDED — complete** |
| **UX-4 44px targets** | `size-11` on the drawer trigger, gear and close; `min-h-11` on the context-switcher row, each with a comment saying why | **SUPERSEDED — complete** |
| **UX-4 no overflow / safe area** | the drawer body carries `pb-[max(1rem,env(safe-area-inset-bottom))]` | **SUPERSEDED — complete** |
| **UX-6 Rugby Hub return path** | its layout links to `/dashboard` and back to `/rugby-hub`, both `min-h-11` | **SUPERSEDED — complete** |
| **UX-1 / UX-2 / UX-3** | page identity, the identity block and context control, and the Club Desk hierarchy all shipped in their own slices | **COMPLETE — not reopened** |
| Dead navigation destinations | all **38** static hrefs in `build-nav-items.ts` resolve to a real `page.tsx` | **nothing to fix** |

### The §8 presentation decision, evaluated rather than reverted

UX-2 changed the sidebar identity block from club-first to **person + context + role**. Step 16 extended
it to the governing body, where it reads *"Callum Krzysik / Review County · Organisation Administrator"*.
Evaluated as part of the whole shell in this step: **it is right and is not reverted.** The reason is
structural rather than aesthetic — one Ovalball identity now legitimately stands in five or six places,
and a block that named the scope could not say who was standing there. It is also the only thing on
screen that distinguishes a Club Admin acting for their club from the same person acting for their
county. Recorded for owner review, unchanged.

---

## What is genuinely still open, and owned by UX-4–7

Four things. Everything else in the four slices is either done or superseded.

1. **UX-4 — primary destinations are TWO taps away on mobile, not one.** The outcome clause is
   *"Primary destinations one tap away"* and the mobile acceptance names a **bottom bar**. What exists is
   a sticky top bar whose only way into navigation is the drawer trigger: tap the hamburger, then tap the
   destination. There is no bottom bar. **FIX NOW.**

2. **UX-4 — the floating widget still overlaps content on every page.** `components/ovie/ask-ovie.tsx`
   is mounted once in `app/(app)/layout.tsx` as `fixed right-5 bottom-5 z-50`, and the space it occupies
   is reserved **per page**, by hand, in only **8 files** — each carrying the same comment (*"pb-28
   clears the global 'Ask Ovie' widget, fixed bottom-right on every…"*). Every other authenticated page
   can put content underneath it. This is the audit's own named UX-4 defect, and a per-page rule that
   most pages do not follow is the wrong shape of fix. **FIX NOW** — reserve it once, in the shell.

3. **UX-6 — the public Club Home has no return path.** `app/club/[slug]/page.tsx` and
   `components/club-home/club-chrome.tsx` contain no link back into the application. The audit named this
   exactly. It matters more now than when it was written: **Step 16's governing-body Clubs page links
   straight to `/club/{slug}`**, so a county officer following their own affiliated-club list is put
   outside the app with no way back. **FIX NOW.**

4. **UX-7 — the accessibility and contrast pass is asserted per surface, never measured shell-wide.**
   Individual steps record axe on the surfaces they changed (*"0 introduced"*), which is a different
   claim from UX-7's *"axe clean on shell routes"*, *"320px axe clean"* and *"contrast measured"*.
   **FIX NOW** — as a permanent measurement rather than a one-off run.

### Deliberately not done

| | why |
|---|---|
| A bottom bar for every context including parent/player | the parent navigation is a deliberate fixed five-link set; a bottom bar is built from `buildNavItems` so it follows whatever each context legitimately has, and nothing is added to a context to fill it |
| Grouping the governing or family navigation into sections | six links is not a taxonomy. The layout already leaves Setup flat for the same reason, and the audit's own UX-5 goal was parity with Site Admin's IA for the **club**, which is done |
| Any change to branding or the dev-only webfont issue | §23. Recorded as owner debt, untouched |
| Entrance journeys | §38. UX-8 is Step 19's |
| The H14.7 child `switcherLabel` failure | it is a `.verify.ts` expectation about a guardian-context label, not a UX-4–7 surface. §13 says preserve it unless this step owns the exact presentation problem; it does not |

## FUNCTIONS BEFORE — 36

Step 17's thirty-six, in `CONVERGENCE_STEP_17_FUNCTIONALITY_MATRIX.md`, unchanged.
