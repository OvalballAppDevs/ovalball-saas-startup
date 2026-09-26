# Sections 12/13 — Referral Programme & Referral Tracking

## PURPOSE

Confirm the referral-reward domain (`platform_referrals`, `club_referral_summary`,
`club_credit_balance_pence`, `create_partner_invitation`/`claim_club_referral`) is real, DB-enforced and
already reachable on both clients — and close the small gap between them, rather than build anything
new. No schema change; the ledger's own standing note ("incentive design needs explicit owner approval
before any schema") is a non-issue here because nothing here needed schema.

## AUDIT FINDING: TRACKING ALREADY HAPPENS AUTOMATICALLY (SECTION 13'S OWN QUESTION, ANSWERED)

An earlier pass in this run left one open question: does an ordinary "Invite to Ovalball" action (the
map card's per-club invite, `create_partner_invitation`) automatically become a trackable referral, or
does it need a separate marking step? Reading `supabase/migrations/20261012000000_referral_attribution_
integrity.sql` in full answers this definitively: `create_partner_invitation` calls
`internal.ensure_club_referral(v_id, 'invitation', auth.uid())` in the **same transaction** as the
invitation insert ("R-1: same transaction, no second round trip, no best effort"). `claim_club_referral`
is now only a legacy explicit entry point for a pre-existing invitation, delegating to the same
`ensure_club_referral` — there is exactly one implementation. **Section 13 needed nothing built**: every
invitation sent from either client's map already creates a trackable, correctly-attributed referral, with
every eligibility gate (self-referral, already-a-subscriber, referring club still active, first collected
payment) enforced downstream in the database, never in either client.

## AUDIT FINDING: SECTION 12 WAS ALSO ALREADY SUBSTANTIALLY BUILT

Mobile's `apps/mobile/app/(tabs)/clubhouse/refer.tsx` (built during the Clubhouse Home pass, before this
section was formally reached) already reads the real `club_referral_summary`/`club_credit_balance_pence`
RPCs — the same ones the web club-billing surface (`app/(app)/club/settings/ovalball-billing/referral-
section.tsx`) uses — gated on the real `club.referrals.view` capability, with an honest denial rather than
a silent empty state for a viewer who lacks it. It shows the aggregate credit balance and every individual
referral's real status. This was not a shell: it needed only a side-by-side comparison against the web
surface to find what was missing.

## WHAT WAS ACTUALLY MISSING, AND FIXED

Comparing the two surfaces side by side found two small, genuine parity gaps, both closed:

- **Per-referral reward amount.** Web shows `+£X.XX` on each qualified row; mobile showed only a
  checkmark, so a person could see the aggregate credit balance but not which specific referral earned
  what. Fixed: a qualified row with a real `rewardAmountPence` now shows the amount; the checkmark
  remains the fallback for a qualified row with no amount recorded.
- **Referral Terms link.** Web's referral section and the map's own Invite dialog both link to
  `/legal/referral-terms`; mobile's screen had no equivalent. Fixed: a "Referral Terms" link opens the
  same real page (`app/legal/referral-terms/page.tsx`, confirmed to exist) via the web view, matching
  every other legal-page pattern already used on mobile (`View Club`, "Referral terms apply" in the
  invite dialog).

## SCOPE DELIBERATELY NOT TAKEN

No changes to the referral schema, eligibility rules, reward amount, or the invitation mechanism itself
— all already correct and already shared. No standalone mobile "referral link"/"referral code" invented;
Ovalball's real mechanism is per-directory-club (`create_partner_invitation`, reached from a club's own
card on the map), and the mobile screen already correctly routes there rather than fabricating a generic
shareable code the product does not have.

## TESTING

Purely additive UI (a conditional text render and a `Linking.openURL` call) over already-read,
already-typed data (`ClubReferral.rewardAmountPence` already existed on the mobile contract). No new
pure logic worth a dedicated unit test. `tsc --noEmit` clean on mobile; ESLint clean on the touched file.
A live-device walkthrough of an actual qualified referral (which requires a real collected Stripe/
GoCardless payment on a referred club's first subscription) was **not** performed this pass — this is
inherent to the reward's own eligibility rule, not a gap in this section's testing depth, and the
underlying reward-qualification logic itself predates this session and is unchanged here.

## KNOWN DEBT

None new.
