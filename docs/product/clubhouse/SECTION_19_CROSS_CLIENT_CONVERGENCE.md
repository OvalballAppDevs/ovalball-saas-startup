# Section 19 — Cross-Client Convergence

## PURPOSE

Confirm every Clubhouse function built or touched in Sections 9-14/17 exists on both clients wherever
the underlying capability is genuinely shared between them — per the standing "the current website is
the functional specification" parity rule, applied here to Clubhouse rather than assumed to already
hold.

## THE TWO GAPS THIS RUN'S OWN AUDIT NAMED, BOTH NOW CLOSED

The Sections 9-19 audit run at the start of this session named exactly two confirmed, concrete
cross-client convergence gaps:

1. **Club-to-club messaging had zero mobile presence.** Closed by Section 10: `start_or_get_club_
   conversation`/`respond_to_club_conversation` are now reachable from mobile's Clubhouse club sheet,
   and the mobile thread screen's pre-existing (but previously unused) `"club"` conversation-kind
   support gained a working request-decision banner and a corrected `canSend` rule.
2. **Club-claim submission had zero end-user UI on either client**, not only mobile. Closed by
   Section 14, on both clients simultaneously, from the same shared `CLAIMABLE_ROLES` source.

## PER-SECTION CONVERGENCE STATUS (THIS RUN)

| Section | Web | Mobile | Why |
|---|---|---|---|
| 9 Negotiation | Built | Built | Same RPCs, same `isMyTurn`/`canNegotiate` mirror on both. |
| 10 Messaging | Built | Built | Same RPCs; web's `/messages/new` flow pre-existed, both gained the Clubhouse entry point. |
| 11 Activity | N/A | Built | Clubhouse Home (and its Recent Activity teaser) is a mobile-only surface by the original UI/UX brief — no web equivalent to converge with. |
| 12/13 Referral | Pre-existing | Built (parity gaps closed) | Both read the same `club_referral_summary`/`club_credit_balance_pence`. |
| 14 Claiming | Built | Built | Same shared `CLAIMABLE_ROLES`, same RPC, same eligibility rules. |
| 17 Network Memory | N/A | Built | No `directoryId`-keyed full club-profile web route exists yet (Section 4's own pre-existing, unrelated finding) — nothing on web to add this to. |

Sections 11 and 17 are genuinely asymmetric, and correctly so: the missing web surface in both cases is
a pre-existing gap from earlier sections (Clubhouse Home was scoped mobile-only from the brief; the web
club-profile route was explicitly deferred in Section 4 pending a reference design), not something this
run's own sections created or should silently paper over by inventing a web surface outside their scope.

## WHAT WAS DELIBERATELY NOT DONE HERE

No new web club-profile route was built to give Section 17 a home — that is Section 4's own deferred
item, owned by whoever picks that up, not a convergence gap this run's sections introduced. No new
Clubhouse Home equivalent was built for web — the brief itself was mobile-only.

## TESTING

This section is itself a verification pass rather than new code; see each section's own doc
(9/10/12-13/14/17) for that section's specific test evidence. No additional tests were added here.

## KNOWN DEBT

None new.
