# Section 18 — Clubhouse Polish

## PURPOSE

A content-standard and consistency sweep over every Clubhouse-adjacent surface built or touched across
Sections 9-14 and 17 in this run, before calling the run complete — not a redesign, and not new
functionality.

## METHOD

Ran `scripts/verify-content-standard.mjs` (the canonical automated gate: navigation labels, known
product title constants, protected acronyms, duplicate destination labels) — passed clean, 1115 files.
That gate does not check minor-word capitalisation inside a Title Case label or cross-surface wording
consistency, so followed it with a manual sweep of every new user-visible string introduced this run
(regex sweep for capitalised minor words — `For`/`At`/`In`/`On`/`The`/`And`/`Of` — across every file
touched, then read in context to separate a real label violation from a sentence-initial capital in
ordinary body copy, which is correct).

## DEFECTS FOUND AND FIXED

- **Two minor-word Title Case violations** in the new Section 14 claim form, on both clients: "Your
  Role At This Club" → "Your Role at This Club"; "Why Can You Act For {clubName}?" → "Why You Can Act
  for {clubName}" (also dropped the question mark, since a form label is a noun phrase, not a
  sentence — matching "First Name"/"Date of Birth", never a full question).
- **"Kick-Off" spelled inconsistently** — the new Section 9 web counter-proposal form had "Kick-off"
  (lowercase o); every other kick-off field in this codebase (`apps/mobile/app/(tabs)/fixtures/new.tsx`
  and others) spells it "Kick-Off". Fixed to match.
- **"Referral Terms" (Title Case) on the new mobile link** did not match the established wording for
  the exact same destination elsewhere in this codebase: `invite-club-dialog.tsx`'s "Referral terms
  apply" and the web billing page's own "Referral terms" are both sentence case for this specific
  inline link. Fixed mobile to match rather than introduce a third, inconsistent wording for one
  destination.

## NOT TAKEN AS POLISH

No visual redesign of any screen touched this run — every section's own doc already states what was
built and why; "polish" here means textual/consistency correctness, not a second design pass over
already-shipped, already-reviewed work (Clubhouse Home, the map, the Explore/Find split) from earlier in
this session, which stands as physically-reviewed and approved.

## TESTING

`node scripts/verify-content-standard.mjs` — clean (1115 files, 8 destinations, 5 protected terms, 4
rejected phrases). `node scripts/verify-match-centre-shared.mjs` — clean, confirming this run's changes
never touched Match Centre's own shared-surface structure. Both clients' `tsc --noEmit` re-confirmed
clean after the fixes above.

## KNOWN DEBT

None new.
