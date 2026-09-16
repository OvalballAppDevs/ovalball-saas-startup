# Slice 4I — club documents, partners, referrals and season handover

**AA.3 row 4i.** The final Slice 4 sub-slice. Design references: J.4 lines 407–411 (documents,
partnerships, referrals), J.5 lines 420–429 (team lifecycle, graduation, handover), section U
(the handover split) and Z-12 (object storage).

## What this slice owns, and what it does not

4I's footprint was derived from AA.3 row 4i alone, not from "whatever legacy is left". The
**4I-owned footprint** is the document library, the club-documents storage bucket, the season
rollover and graduation surfaces, team lifecycle, partnerships and referrals. The **global remaining
Slice-4 footprint** — the things still on legacy keys after 4I — is recorded in the closure audit
and belongs to other slices. Nothing was pulled forward to flatter a count.

## The decisions

### Section U is now real

J.5 line 427 and section U split a season handover: the Fixtures Secretary **prepares** it, the Club
Admin **applies** it. Before this slice every handover RPC opened with one undivided
`internal.is_club_admin(...)`, so the split existed only on paper — and it excluded the Fixtures
Secretary from the half that was supposed to be theirs while giving the same authority to everyone
who had any of it.

`apply_season_handover` now asks `team.handover.apply`, which only the Club Admin bundle holds and
which is non-delegable and reason-bearing. `plan_missing_placement_team`, `unplan_handover_team` and
the proposal decision ask `team.handover.prepare`, which the Club Admin and the Fixtures Secretary
both hold. The migration asserts the split structurally: applying must name the apply key and must
not name the prepare key, the Secretary must hold prepare, and the Secretary must not hold apply.

A season handover moves every age group in a club up a year and there is no undo, so this is checked
three ways: in the matrix against a real handover in the Secretary's own club, in a race where the
Secretary and the Club Admin apply the same handover simultaneously, and in the browser from a real
signed-in session.

### The two decisions inside a handover that are not preparation

`internal.decide_rollover_team_proposal` serves five actions. Confirm, adjust and defer are ordinary
preparation. **Fold and graduate are not**: folding retires a side and graduating archives a cohort
and moves every player in it to the club's holding list. J.5 line 422 keeps both at
`team.lifecycle.manage`, and the function already carried them behind their own inner gates
precisely so the handover route could not be used to reach them — the source says so in as many
words.

The first cut of this slice mapped one key per function and flattened both of those gates onto the
preparation key, handing the Fixtures Secretary a cohort graduation.
`supabase/tests/union_u18_free_agent.sql` caught it. Section 4 of
`20270378000000_club_handover_authority_canonical.sql` restores them and asserts that the function
names `team.lifecycle.manage` twice and the preparation key not at all. `M13` in the mutation battery
reinstalls the defect and is killed by MI-C9.

### The document library

`internal.can_manage_document_library` and `internal.can_view_document_library` matched membership
role strings (`cm.role in ('CLUB_ADMIN','FIXTURE_SECRETARY')`) and a site-admin role string
(`site_admin_role(auth.uid()) = 'club_data'`). Both now ask `club.documents.manage` /
`club.documents.view` with `site.clubs.profile.manage` / `site.clubs.view` as the site master. The
answers are identical — J.4 gives the manage to exactly CA and FS and the view to every club bundle
— which the shadow comparison confirms.

No policy asks either helper any more; the eight document policies ask the canonical keys directly.
The helpers survive as the object-storage predicate and the delete RPC, which is why the matrix
exercises `internal.can_access_document_storage_path` and `public.delete_club_document` by name
(MI-B12–B16). The mutation battery found that gap: `M2` survived the first run because nothing
reached the helpers.

### Z-12

The `club-documents` bucket could be written to and read from but never cleared — three policies, no
delete. A bucket that accumulates and never empties is a retention problem, not a convenience one.
`club_documents_storage_delete` is added, gated by the same `can_access_document_storage_path(name,
true)` as the other writes. The bucket now has exactly four policies and the retirement test asserts
that count.

### Referrals, and the distinction this slice got wrong first

J.4 describes two surfaces that are easy to conflate, and the first cut of this slice conflated them.

`club_ovalball_invitations` holds the invitation a club sends to a club that is **not yet on
Ovalball**. Its founding migration scopes it to "the same boundary `club_partnerships` already uses",
and J.4 line 409 makes that boundary `club.partners.manage` — the Club Admin **and** the Fixtures
Secretary. `club.referrals.view` and `club.referrals.manage` are the **referral ledger**: the
attribution record and `claim_club_referral`, whose site master is `site.commercial.*` and which J.4
lines 410–411 keep Club-Admin-only.

This slice initially keyed the invitation table and `create_partner_invitation` to
`club.referrals.manage`, which quietly took the partnership invitation away from every Fixtures
Secretary. `supabase/tests/referral_attribution_integrity.sql` caught it — it has asserted since the
feature shipped that "an invitation sent by a Fixture Secretary still attributes to their club" while
"`claim_club_referral` still requires `club.referrals.manage`". Both surfaces now ask their own key,
and `MI-E6b` asserts the two answers differ for the same person.

### Partnerships

A partnership is a relationship, so `club_partnerships_select_scoped` opens it from **both** ends —
the club that asked and the club that was asked — each through its own `club.partners.manage`. The
`M10` mutant drops the second branch and is killed.

### The eighteen RPCs Slice 4C left to their owner

Slice 4C migrated the fixtures half of `internal.can_manage_club_fixtures` and wrote down the rule for
the rest: *"A helper is retired by the slice that owns the meaning of the call site, not by whichever
slice's grep happens to match it first."* It named 4I as the owner of documents, partners and
handover. J.5's own legacy column agrees, recording `team.handover.prepare`'s legacy as
"`club.season_rollover.manage` (unenforced) **+ `can_manage_club_fixtures`**", migration "SPLIT +
enforce".

`20270380000000_club_handover_rpc_authority_canonical.sql` takes those eighteen: five handover reads,
six handover preparations, four graduation placements and three partnership or invitation acts. Each
now asks the key its own table's policy already asks, so the RPC in front of a row and the rule on the
row answer the same question. `can_manage_club_fixtures` bodies fall **27 → 9**, and the nine that
remain are named in the closure audit with their owners.

The placement functions move to `team.graduation.place`. At **club scope** — which is where these
RPCs ask — that is the same two people the fixtures helper named, so nobody is widened; the Coach and
Team Manager hold it at **team** scope, which is where `place_graduating_player` asks it. `MI-C16` and
`MI-C17` assert both halves, because "we repointed it and measured no change" is worth nothing unless
the measurement is in the suite.

### Three adapter rows retired

`club.season_rollover.manage`, `club.team_lifecycle.manage` and `partner.manage`. Each is a rename
whose canonical key was already ACTIVE and already held by the same bundle, so every holder loses the
alias and keeps the authority; `club.season_rollover.manage` is additionally a **split**, into
`team.handover.prepare` and `team.handover.apply`. `supabase/tests/bundle_legacy_parity.sql` lists
the five resulting default removals by name with a reason each, and the intended-removal total moves
44 → 49.

4A's `club.guardians.manage` and 4C's `fixture.edit` are deliberately **not** retired, and the
retirement test asserts they are still there, so this slice cannot be read as having improved its
count with another slice's work.

## Evidence

| | |
|---|---|
| resolver shadow | 16 questions × 10 personas, before and after: **byte-identical** |
| gate shadow | 10 rewritten gates × 10 personas, old predicate vs new: **5 intended differences, 0 unintended** |
| AA.3 4i matrix | `supabase/tests/club_misc_authority_matrix.sql`, **84 assertions** |
| self-seeding proof | the same 84 on a seeded database and on one built from empty |
| races | `supabase/tests/js/club_misc_authority_races.test.mts`, 4 races on real concurrent sessions |
| mutation | 15 mutants, **0 survivors**, restore verified clean before and after each |
| platform battery | **4370 passed, 0 failed across 209 suites** |
| clean empty-database rebuild | **473 migrations from empty**; 22 suites, **1187 assertions**, 0 failures |
| browser | suite `59-club-misc-authority.mjs` 48/48; shared suite 51 extended 36 → 43 |
| UAT | suites 51–59 × 3 sequential passes |
| performance | 2,000-document library: hoisted **24.3 ms**, per-row form **457.3 ms** (18.8×) |

### The shadow that was not enough, and the one that replaced it

The first shadow asked the capability **resolver** what each of ten personas holds, for sixteen
questions. It came back byte-identical before and after — and it was blind to both of the errors this
slice made, because a gate repointed to the wrong key does not change what anybody *holds*.

So a second instrument asks the real question: for every gate 4I rewrote, evaluate the **old
predicate and the new predicate side by side** for all ten personas. Five differences remain, and each
is intended with a contract reference:

| gate | who changes | why |
|---|---|---|
| prepare a handover | **FS gains** | J.5 line 426 and section U. The whole point of the slice. |
| fold/graduate/reactivate a team | **Full Site Admin gains** | the old gate was `is_club_admin(club)` with **no site branch**, so Ovalball could not act at all; J.5 gives the key the master `site.clubs.lifecycle` |
| prepare / apply a handover | **Full Site Admin gains** | same, master `site.support.act_in_club` |
| create/reactivate a missing team | **Full Site Admin gains** | same, master `site.team_roles.manage` |
| manage the document library | **Full Site Admin gains** | the role string named the **club-data** profile alone; J.4 line 408 gives the key the master `site.clubs.profile.manage`, which SITE_FULL also holds |

Every one of these is an explicit, named, bundle-held capability — never a bypass. `MI-S1`–`MI-S4`
pin exactly which profile gained what, and assert that a read-only, support or club-data admin gained
nothing, and that **no** site profile holds the club-scoped key itself.

The same instrument caught a **narrowing** that would otherwise have shipped: `create_partner_invitation`
had no literal `internal.is_site_admin()` in its body, so the migration's "did this have a site
branch?" guard said no — but the fixtures helper it called opens with one. Leaving the master off
would have quietly taken the club invitation away from Ovalball. The guard now takes the answer from
the map and adds the branch rather than dropping it.

### The races

`R1` applies the same handover from two Club Admin sessions at once. The apply is idempotent by
design — it takes the row lock, sees `applied_at` and returns zeros rather than raising, so a double
click gets the same answer — which makes the honest question not "did one session error?" but "did
the work happen once?". The handover is seeded with real work (a U12 side moving to U13), so a double
apply would land the side on U14. `R2` races the Fixtures Secretary's apply against the Club Admin's
and asserts the Secretary is refused whichever way the interleaving falls, that `applied_by` is the
Club Admin, and that the Secretary keeps `team.handover.prepare`. `R3` files a document while its
folder is deleted. `R4` opens the same partnership from both ends at once.

### The hoist

Every 4I policy asks `club_id in (select unnest(internal.club_ids_with('key')))`, never
`club_id = any (internal.club_ids_with('key'))`. The first becomes an InitPlan or hashed SubPlan
evaluated once per statement; the second is a stable function call the planner cannot inline and
evaluates **per row**. `MI-P1` proves the two select the same rows for all twelve personas and
`MI-P2` asserts the shape, so the optimisation cannot silently revert. 44 policies now use the
hoisted form and none uses the per-row form.

## Counters this slice moved

| | before | after |
|---|---|---|
| `is_club_admin` policies | 0 | 0 |
| `is_club_admin` function bodies | 14 | **3** (4b's team helper, 4c's fixtures helper, 4c's restoration RPC) |
| `can_manage_club_fixtures` bodies | 27 | **9** (4a's dead helper, 4d's eight tournament functions) |
| document-helper policies | 6 | **0** |
| `club-documents` storage policies | 3 | **4** (Z-12) |
| adapter rows | 80 | **77** |
| `can_manage_club_fixtures` bodies | 27 | **9** |
| pre-Slice-3 keys resolvable | 55 | **52** |
| intended default removals | 44 | **49** |

## §9 unknown-age check for 4I

Does 4I make staff or sensitive authority reachable through an identity whose age cannot be
established? **No.** It grants no role, changes no membership transition, adds no onboarding path and
touches no age check. `internal.person_is_minor` is untouched and no 4I key is gated differently than
before.

The gate shadow found two widenings, and neither reaches an unverified identity. The Fixtures
Secretary gains handover preparation, but only through an existing ACTIVE `FIXTURE_SECRETARY`
membership of a specific club — a role a Club Admin assigns to a person the club already knows. The
Full Site Admin gains four named site masters, which are held by a bundle and reached through the
site admin register, never through a club membership. `MI-S4` asserts that no site profile holds the
club-scoped key itself, so neither widening is reachable by being treated as a member.

The carried follow-up in `SECURITY_FOLLOW_UP_unverifiable_age.md` is unchanged and remains open for
the next review boundary.
