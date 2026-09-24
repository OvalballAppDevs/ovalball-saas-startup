# CA-M1 — Admin Centre foundation and Club Profile

One product, two clients. This records what CA-M1 built, the decisions it
applied from the owner's CA-M0 review, and how it was proved. The forensic map
it builds on is `CLUB_ADMIN_CENTRE_MAP.md`; the `R` register is
`RECENT_AUTH_CONVERGENCE.md`.

## What exists now

**Domain operations** (migration `20270540000000`), the one way either client
changes the Club Profile:

| operation | authority | validation | audit |
|---|---|---|---|
| `update_club_profile(club, bio, website, facebook_url, address_display)` | `internal.require_club_profile_editor`: `internal.session_ok()` (live, active, AAL-satisfied — the `session_ok_required` policy the direct write met) then `club.profile.edit` at the club via `internal.can`, or `site.clubs.profile.manage`; 42501 otherwise | trim; empty → null; a web address without a scheme gets `https://`; length ceilings; P0002 for a missing club | `audit_row_change` on `clubs` with the acting person; `updated_by` set |
| `save_club_contact(club, contact?, role, name, phone, email, is_public)` → id | same | name required; role from the check constraint; email shape; a contact being edited must belong to the club (P0002) | `audit_row_change` on `club_contacts`; `created_by`/`updated_by` set |
| `delete_club_contact(contact)` | same, at the contact's club | P0002 when missing | `audit_row_change` delete row |

The row policies (`clubs_update_admin`, `club_contacts_*_admin`) stay as the
floor. Nothing was broadened: `club.profile.edit` is `A2`, no `R`, and the
catalogue is untouched.

**Shared contracts** (`packages/contracts/src/club/profile.ts`,
`admin-centre.ts`, `../required-reasons.ts`): `readClubProfile` (the tables
under RLS, as the website reads them), `updateClubProfile` / `saveClubContact`
/ `deleteClubContact` (the operations), `canEditClubProfile` and
`readAdminCentreAccess` (`my_capabilities`), `clubProfileFieldsDiffer` (what
"unsaved changes" means), `clubProfileErrorMessage` (one error rule),
`ADMIN_CENTRE_SECTIONS` (the sections, each gated by the capability the
website's Club Settings navigation gates the same job on), and
`REASON_REQUIRED_OPERATIONS` (the twelve operations that ask the server for a
reason — asserted equal to the server's own set).

**Web**: `app/(app)/club/actions.ts` — `saveClubProfile`, `saveClubContact`
and `deleteClubContact` call the shared wrappers; the page, the form and the
contacts section are unchanged. Crest upload/removal is unchanged (already a
storage-policy-gated write shared with the app's `identity/images.ts`).

**Mobile**:

- `More → Club Admin → Admin Centre`, shown only in a club context and only
  when `my_capabilities` returns at least one Admin Centre capability at that
  club (`src/admin/access.ts`, re-asked on context change and on focus). Never
  from a role label.
- `/admin` landing: the club's crest and name in the bar; **In the App** (Club
  Profile) and **On the Web Today** (Teams, News & Announcements, Permissions,
  Guardians & Players, Safeguarding Officer, Season Handover, Lookup
  Administration, Subscriptions & Payments), each row only when the server
  says so, each web row opening the website's own page in the system browser.
  No dead rows, no WebView.
- `/admin/club-profile`: the club's name (read-only, from the Club Directory),
  About the Club, Website, Facebook, Home Ground Address as native inputs;
  one dirty-tracked draft with **Discard / Save Changes** in a fixed footer
  that appears only when there are unsaved changes; **Public Contacts** with
  Add Contact / Edit / Remove (two-step confirm), role chips, public switch.
  Re-reads on mount, on focus and after every write; locks the fields and
  says why when the server refuses with 42501; no queued mutation, no local
  store, no optimistic authority.

## Owner decisions applied

1. **`R`** — no mobile enforcement, no bulk enablement; CA-M1's mutations are
   `A2` only; the register is `RECENT_AUTH_CONVERGENCE.md`.
2. **Capability, not role** — visibility and editability come from
   `my_capabilities`; the role-authorised RPC mismatches are recorded there for
   their own slices; access was not broadened.
3. **Domain operation first** — the four profile fields and the contacts are
   now RPCs on both clients. No direct mutation was kept: the "provably
   simple" exception was not needed.
4. **One required-reasons list** — `REASON_REQUIRED_OPERATIONS`, twelve
   entries, asserted equal to the set of public functions calling
   `internal.require_reason`. The people/permissions screens consume it when
   their slice ships.
5. **One audit history** — the row triggers record every change from either
   client with the acting person. Client origin as non-authoritative metadata
   was **not** added: it would have meant touching the shared audit trigger
   for a column no reader yet needs; recorded as an option, not a gap.
6. **Fix with the owning slice** — only the price oracle was fixed outside a
   slice (commit `149613f`, RED containment, see its migration and suite).

Contact names are **not** passed through `internal.normalise_person_name`: a
club contact may be a desk or an office ("Club Office", "Fixtures Desk") as
well as a person, and the normaliser would re-spell acronyms; the website
never normalised them either. The trim-and-require rule is the same on both
clients because it lives in the operation.

## Proof

- `supabase/tests/club_profile_domain_operation.sql` (CANONICAL_GATE, 22/22):
  update/create/edit/delete through the operations with trimming, scheme,
  lower-casing and `updated_by`; every validation refusal (22023/P0002);
  stranger and other-club admin refused (42501); **stale authority** — a Site
  Admin `set_capability_override(… 'deny' …)` refuses the holder's next save
  and `my_capabilities` says no, `revoke_capability_override` restores;
  site master may act; audit rows carry the actor; anon holds no grant; the
  required-reasons list equals the server's set.
- `supabase/tests/js/mobile_admin_centre.test.mts` (6/6): both clients through
  the operations, never the tables; no role branching; every section gated on
  a capability the website gates on; no queue/store; field and error rules;
  one reasons list.
- Perimeter manifest test green with the three operations declared;
  `security_perimeter_guard`, `cross_club_isolation_matrix`,
  `gocardless_function_grant_audit` green; web and mobile typecheck clean;
  eslint clean; iOS export.
- **Cross-client proof in the review world** (`scratchpad/admin/proof.mjs`,
  Playwright at 390 px, `uat.coach` — a Club Admin): web read → mobile change
  → web reread (same value, `audit_log` row with the actor) → web change →
  mobile refocus (same value) → mobile adds a contact → web shows it → mobile
  removes it → web reread (gone, delete audited) → **stale authority**: Site
  Admin withholds `club.profile.edit` through `set_capability_override` while
  the mobile screen holds an edit; Save is refused by the server with the
  server's own sentence, the fields lock, the Admin Centre no longer lists
  Club Profile; the override is revoked and the screen is editable again →
  baseline restored through the web form. Screenshots beside `proof.json`.

## Not in CA-M1 (and where it goes)

- Every "On the Web Today" section: its own CA-M slice, in the owner's order.
- Client-origin audit metadata: optional, see decision 5.
- The pre-existing suite debts found while running the gate are listed in the
  CA-M1 report, not fixed here (decision 6).
