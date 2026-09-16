# Final Slice 4 closure audit

Read-and-verify only. No change was made in the course of this audit; everything it reports was
measured against the migration tree as banked at the end of Slice 4I.

The question it answers is the one the letter asks: **is every item Phase 2 assigns to Slice 4
actually done, and where something is not, is it assigned to a later slice by an approved decision
rather than merely deferred?**

---

## 1. AA.3 rows 4A–4I

| Row | Domain | Legacy AA.3 names | State |
|---|---|---|---|
| 4a | Family and players | `can_manage_player`, guardian branches of `is_site_admin` | **Done.** `can_manage_player` has **0 policies and 0 callers**. See §3 for the dead helper it leaves. |
| 4b | Teams and roster | `team.view` club default, `can_manage_team` roster uses, `team_permissions` writes | **Done for 4b's own ledger.** `team.view` retired; the roster policies and RPCs in the 4b ledger are free of it. `internal.can_manage_team` survives as a helper — §2. |
| 4c | Fixtures, requests, results, Planner, Import | `can_manage_club_fixtures`, `can_manage_fixture_side`, direct fixture writes | **Done for 4c's own ledger**, and 4c recorded the remainder explicitly — §2. |
| 4d | Competitions and tournaments | `can_organise_competition` role checks, `calendar.manage` tournament use | **Done for 4d's own ledger.** Eight tournament functions still route through the fixtures helper — §2. |
| 4e | Calendar, venues, pitches, training | role-string RPC checks, public training plans | **Done.** |
| 4f | Messaging and notifications | `staffs_team`, `is_messaging_staff`, Site Admin conversation read | **Done.** |
| 4g | Safeguarding and dispensations | per-officer override dependence, Site Admin thread read | **Done.** One dispensation policy still asks the fixtures helper — §2. |
| 4h | Club administration and finance | `is_club_admin` (24 policies) | **Done.** 24 → 0 policies. |
| 4i | Documents, partners, referrals, handover | `can_manage_document_library` role checks | **Done.** 6 → 0 policies; and 4i additionally took the 11 `is_club_admin` bodies and the 18 `can_manage_club_fixtures` bodies that J.5 and 4c assign to it. |

---

## 2. Every remaining legacy consumer, counted and owned

Measured against the banked tree. "Policies" means row-level policies; "bodies" means function bodies
other than the helper itself.

| Helper | Policies | Bodies | Owner | Why it is still there |
|---|---|---|---|---|
| `is_site_admin` | 76 | 70 | **Slice 7** | AA.3 says so in its own words, immediately under the table: *"Site-side `is_site_admin()` removal (140 policies) happens in Slice 7, alongside the Users & Access UI, domain by domain in the same order."* This is an assignment in the design, not a deferral by a slice. |
| `is_full_site_admin` | 14 | 30 | **Slice 7** | Same sentence. It is the narrower of the two site-admin helpers and retires with them. |
| `has_capability` | 86 | 60 | **per-domain, then Slice 10** | The legacy adapter. It answers through `capability_key_map`, so each row retires with the slice that owns its domain; the adapter's own removal is the end state the programme reaches at Slice 10. 77 rows remain — §4. |
| `can_manage_club_fixtures` | 1 | 9 | **4G (1 policy), 4D (8 bodies), 4A (1 body)** | See below. |
| `can_manage_team` | 1 | 15 | **4B, and the site-admin work in Slice 7** | The helper itself still opens with `internal.is_site_admin() or internal.is_club_admin(...)`, so it cannot be finished before the Slice 7 site-admin pass. Its *call sites* in 4b's ledger were migrated. |
| `is_club_admin` | 0 | 3 | **4B (1), 4C (2)** | `internal.can_manage_team` (4b's), `internal.can_manage_club_fixtures` (4c's) and `public.request_fixture_restoration` (4c's). Zero policies anywhere in Ovalball. |
| `site_admin_role` | 0 | 6 | **Slice 7** | A site-profile reader; site-side. |
| `can_manage_document_library` / `can_view_document_library` | 0 / 0 | 2 / 2 | **done (4I)** | Both are canonical inside. The bodies are the object-storage predicate and the delete RPC, which the 4I matrix exercises by name. |
| `can_manage_player` | 0 | 0 | **done (4A)** | — |

### `can_manage_club_fixtures`, in full

4C's implementation report states the rule this audit applies: *"A helper is retired by the slice that
owns the meaning of the call site, not by whichever slice's grep happens to match it first — migrating
a training policy inside a fixtures slice would move a decision without anyone having reviewed the
decision."* It named 4D, 4E, 4F, 4G and 4I as the owners of the remainder.

4I took its eighteen. What is left:

| Remaining consumer | Owner | Reason |
|---|---|---|
| `player_team_dispensation_select` (policy) | **4G** | A dispensation is a regulatory judgement about a player, which 4C assigned to 4G explicitly. 4G migrated the safeguarding appointment and visibility surfaces and did not take this policy. **Deferred without a recorded decision — see §5.** |
| `internal.tournament_visible_row`, `public.check_tournament_participant_target`, `get_tournament_centre`, `invite_tournament_participant`, `reconcile_tournament_participant`, `remove_tournament_participant`, `respond_tournament_invitation`, `update_fixture_competition` | **4D** | Tournaments and competitions. 4C assigned these to 4D by name. **Deferred without a recorded decision — see §5.** |
| `internal.can_manage_player` | **4A** | A **zero-caller** helper: nothing in the database calls `can_manage_player` any more, so this is a dead body calling another dead-ish body. It decides nothing today, but a dead helper is a hazard because the next person who needs the answer may find it before they find the canonical resolver. **See §5.** |

---

## 3. The adapter rows, counted and owned

77 rows remain in `capability_key_map`, all of them resolvable to an ACTIVE canonical key
(`capability_catalogue_integrity` CI3 asserts this).

| Prefix | Rows | Owner |
|---|---|---|
| `site.*` | 15 | **Slice 7** — the site-side pass |
| `club.*` | 19 | 4A (`club.guardians.manage`), 4C (`club.roster.manage`, `club.teams.manage`, `club.training.manage`, `club.venues.manage`, `club.pitches.manage`, `club.logo.manage`, `club.news.manage`, `club.view`), 4G (`club.dispensation.*`, `club.transfer.safeguarding_*`), 4I's three are **retired** |
| `fixture.*` | 14 | **4C** |
| `team.*` | 11 | **4B** |
| `people.*` | 4 | **4A / Slice 7** |
| `messages.*` | 2 | **4F** |
| bare verb keys (`place_graduating_players`, `manage_player_dispensations`, `approve_player_dispensations`, `manage_fixture_callups`, `approve_fixture_callups`, `manage_mini_rugby_groups`) | 12 | 4B/4C/4G |

`bundle_legacy_parity` names all 49 intended default removals with a reason each, and asserts there
are exactly 49 — so no row can be dropped silently and none can be added without being explained.

---

## 4. What Slice 4 actually achieved

| | start of Slice 4 | end of Slice 4I |
|---|---|---|
| `is_club_admin` policies | 24 | **0** |
| `is_club_admin` bodies | — | **3** |
| `can_manage_club_fixtures` policies | 18 | **1** |
| `can_manage_club_fixtures` bodies | 57 | **9** |
| `can_manage_document_library` policies | 6 | **0** |
| `can_manage_player` policies / bodies | — | **0 / 0** |
| `is_site_admin` bodies | — | **70** (4I alone took 17 of them) |
| adapter rows | 80+ | **77** |
| intended default removals, each named with a reason | 0 | **49** |
| domain matrices | 0 | **9**, all deterministic and self-seeding |

The tree was also rebuilt from empty at the close: **473 migrations from an empty database**, then 22
authority suites totalling **1187 assertions**, 0 failures. One pre-existing defect surfaced there and
is recorded rather than fixed — `supabase/seeds/local_uat_parent_player.sql` cannot load into a clean
database, because it inserts a U12 team with no pathway and
`20261231000000_a_team_always_carries_its_pathway.sql` has refused that since December 2026. It is a
seed-file drift, not a schema fault, and it belongs to whoever next owns the local seeds.

---

## 5. Items Phase 2 assigns to Slice 4 that are NOT done

The letter is explicit that Slice 4 must not be described as complete if an item Phase 2 assigns to it
has merely been deferred without an approved decision. Three such items exist. They are recorded here
rather than fixed, because fixing them inside 4I would be doing exactly what 4C warned against:
moving another domain's decision without anyone reviewing that decision.

1. **`player_team_dispensation_select` still asks the fixtures helper.** AA.3 row 4g owns
   dispensations. 4G's letter scoped it to the safeguarding *appointment* authority and state machine,
   and the policy was not in that scope. There is no recorded decision assigning it onward.

2. **Eight tournament functions still ask the fixtures helper.** AA.3 row 4d owns competitions and
   tournaments. 4C named them as 4D's. There is no recorded decision assigning them onward.

3. **`internal.can_manage_player` is a zero-caller helper that still asks the fixtures helper.**
   AA.3 row 4a names `can_manage_player` as legacy to be removed. Its call sites are all gone, which
   is the substance of the row; the function body itself was left in place. There is no recorded
   decision to keep it.

### Three things that are NOT on that list, and why

- **`can_manage_team`'s 15 remaining bodies.** AA.3 row 4b's legacy column says "`can_manage_team`
  **roster uses**", not the helper itself. Those roster call sites were migrated. The helper survives
  for non-roster questions and opens with `internal.is_site_admin()`, so it cannot be finished before
  Slice 7's site-admin pass in any case.
- **`is_site_admin` and `is_full_site_admin`.** Assigned to Slice 7 by AA.3's own sentence.
- **The 77 adapter rows.** Each retires with the slice that owns its domain; the adapter's removal is
  the Slice 10 end state, not a Slice 4 obligation.

None of the three unfinished items is a live authority hole: (1) is a read policy whose answer is unchanged, (2) are
tournament surfaces whose answer is unchanged, and (3) decides nothing because nothing calls it. They
are **unfinished retirements, not open vulnerabilities.** But they are Slice 4 work that has not been
done, so this audit does not describe Slice 4 as complete without naming them.

The judgement is the product owner's: they can be taken as a short closing pass before Slice 5, or
assigned to Slice 7 alongside the site-admin retirement they would naturally travel with. What this
audit will not do is call them finished.

---

## 6. The carried follow-up

`SECURITY_FOLLOW_UP_unverifiable_age.md` remains **open and unchanged**. No Slice 4 sub-slice touched
`internal.person_is_minor`, added an onboarding path or changed a membership transition, so the
question it raises — whether staff or sensitive authority can be reached through an identity whose age
cannot be established — is exactly where 4A left it. It is surfaced here because the letter requires
it to be visible **before** Slice 5, and Slice 5 owns external email-bound invitation and redemption,
which is the first place an unverified age would arrive from outside the club.

---

## 7. D-S4-2

Honoured throughout. Slice 5 still owns external email-bound safeguarding invitation and redemption;
no sub-slice built nomination-by-email, redemption or a second invitation mechanism. 4G built the
appointment state machine against **existing ACTIVE members only**, which is what D-S4-2 permits.
