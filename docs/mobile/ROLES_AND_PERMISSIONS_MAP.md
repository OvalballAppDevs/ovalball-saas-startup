# CA-M4 — Roles & Permissions: implementation map

Mapped during CA-M3 (read-only forensic pass, verified against the local database on 2026-09-24). CA-M3 built none of it. This is the starting point for CA-M4 so it needs no second forensic phase.


All DB facts verified live against `supabase_db_ovalball-saas-startup`. Nothing was changed.

Naming note: `docs/mobile/CLUB_ADMIN_CENTRE_MAP.md:587` currently labels the permissions panel slice **CA-M7** ("Permissions panel (club + team scope, presets, explain access)", RED, blockers: `groups.ts` + explanation sentences → contracts), and `docs/mobile/RECENT_AUTH_CONVERGENCE.md:54` calls the people/roles slice **CA-M3 People & Permissions**. If the slice is now called CA-M4, those two registers need renumbering as part of it.

---

## 1. The capability read model

### `public.my_capabilities(p_scope_type text, p_club_id uuid, p_team_id uuid, p_player_id uuid)`
- Defined in `supabase/migrations/20270350000000_capability_resolver_and_site_profiles.sql`. `STABLE SECURITY DEFINER`, granted to `authenticated`.
- Returns **`capability_key, canonical_key, allowed, decisive_rule, reason_code`** — **no `trail`**.
- Raises 42501 `'You must be signed in.'` when `auth.uid()` is null. For `p_scope_type='team'` with a null club it derives the club from `teams`.
- Body: every `capabilities` row with `status='ACTIVE' and p_scope_type = any(c.valid_scopes)`, cross-joined laterally to `internal.capability_decision(internal.effective_person(), c.key, …, p_check_session=true, p_trace=false)`. For those rows `capability_key = canonical_key = c.key`.
- Then, for `site|club|team`, it **appends legacy-alias rows** from `public.capability_key_map` (`legacy_key` as `capability_key`, `capability_key` as `canonical_key`) answered by `internal.has_capability`, with `decisive_rule` and `reason_code` **NULL**. Mobile must therefore dedupe on `canonical_key` and tolerate null rule/reason.
- Only ever answers about the **caller** (`internal.effective_person()`), never a third party.

### `public.explain_access(p_subject uuid, p_capability_key text, p_scope_type text, p_club_id, p_team_id, p_player_id)`
- Returns **`allowed, decisive_rule, reason_code, decisive_source jsonb, trail jsonb`**.
- Authority: `p_subject = caller` always allowed. A third party requires `internal.has_site_capability('site.users.view')`, or `people.access.explain` at club/team **plus** the subject holding a `club_memberships` row in that club; otherwise 42501 `'You are not authorised to see that.'`
- Non-admin viewers get `decisive_source`/`trail` **redacted** (`- 'granted_by' - 'reason' - 'override_id' - 'grant_id'`).
- Resolves legacy keys through `capability_key_map` first. Answers **one key per call** by design.

### `decisive_rule` values (`internal.capability_decision`, `supabase/migrations/20270350000000_…`, superseded by `20270352000000_family_player_authority.sql`)
`'0'` session/subject · `'1'` hard prohibitions · `'2'` SITE-level withhold · `'3'` CLUB-level withhold · `'4'` TEAM-level withhold · `'5'` explicit allow (re-validated) · `'6'` role bundle / relationship · `'7'` site capability (site scope only) · `'8'` default deny. Trace rows also emit the composite label `'2-4'` as a pass marker.

`reason_code` values: `NO_SUBJECT, SESSION, UNKNOWN_CAPABILITY, CAPABILITY_RETIRED, SCOPE_NOT_IMPLEMENTED, OUT_OF_SCOPE, SCOPE_MALFORMED, SCOPE_TAMPERED, ACCOUNT_INACTIVE, IMPERSONATION_VIEW_ONLY, IMPERSONATION_BLOCKED, MINOR_PROHIBITED, CLUB_INACTIVE, MEMBERSHIP_SUSPENDED, SITE_CAPABILITY, EXPLICIT_DENY, EXPLICIT_ALLOW, ROLE_BUNDLE, ROLE_SUSPENDED, MEMBERSHIP_INACTIVE, ADULT_PLAYER, DEFAULT_DENY`.

### How the web permission page reads a person's effective capabilities
It does **not** use `explain_access` or `my_capabilities` for the grid. It uses two purpose-built RPCs:

- **Club scope:** `public.club_member_capabilities(p_club_id uuid, p_capability_keys text[])` — `app/(app)/club/permissions/page.tsx:155-158`.
- **Team scope:** `public.club_team_capabilities(p_club_id uuid, p_team_id uuid, p_capability_keys text[])` — `app/(app)/club/permissions/page.tsx:73-77`.

Both return the identical row shape:
`user_id, capability_key, effective boolean, source text, override_id uuid, decisive_rule text, reason_code text, override_level text, editable boolean`

`source` is derived from `reason_code`: `ROLE_BUNDLE→'role'`, `EXPLICIT_ALLOW→'granted'`, `EXPLICIT_DENY→'restricted'` if `decisive_source->>'level'='SITE'` else `'denied'`, everything else `'none'`.
`editable` = `subject <> internal.actor()` **and** `internal.override_authority_level(...)` non-null at the needed minimum level (`site_level` when an existing override is SITE, else `coalesce(club_level, site_level)`).

Gate on both: `internal.has_site_capability('site.users.view')` **or** `internal.can('people.capability.manage','club',p_club_id,…)`, else 42501. `club_team_capabilities` additionally raises 22023 if the team does not belong to the club.

**Row universe differs by scope:**
- `club_member_capabilities`: every `club_memberships` row with `state='ACTIVE'`.
- `club_team_capabilities`: only people with an `ACTIVE` `role_assignments` row on **that team** plus an `ACTIVE` club membership ("staff" CTE).

**Key universe (both):** `capabilities` where `status='ACTIVE'` AND `<scope> = any(valid_scopes)` AND `delegable` AND `grant_level in ('C','T')` AND `not safeguarding_sensitive`, intersected with the caller-supplied `p_capability_keys` (legacy keys resolved via `capability_key_map`).

Supporting reads on the page: `get_club_member_directory` for names/emails (`page.tsx:80`, `page.tsx:185`), `role_assignments` + `role_definitions(label)` for role labels (`page.tsx:84-92`, `page.tsx:166-171`), `club_capability_presets` (`page.tsx:198`).

Per-person "why" lives on a different page: `app/(app)/people/[membershipId]/page.tsx:164-184` loops `explain_access` once per key in `GROUPS`, and `app/(app)/people/[membershipId]/page.tsx:196` reads `club_access_history`.

---

## 2. Club scope vs team scope

- `capabilities.valid_scopes text[]` is what the engine and every RPC actually test (`'club' = any(c.valid_scopes)`, `p_scope_type = any(c.valid_scopes)`).
- `capabilities.applicable_scopes text[]` is the **earlier generation** of the same column (added in `supabase/migrations/20260923000000_season_rollover_capability.sql:34-37`, constraint `capabilities_applicable_scopes_valid` limits it to `site|club|team`). It is **identical to `valid_scopes` for every ACTIVE row today** and no live function reads it. Mobile should read `valid_scopes`; treat `applicable_scopes` as legacy.
- `capabilities.inherits_to_team boolean` (37 ACTIVE keys true): when true, a **club-scope** override or club-scope role bundle answers a **team-scope** question too. Used in three places: the rule 2-4 withhold predicate (`o.scope_type='club' and (p_scope_type='club' or c.inherits_to_team)`), the rule 5 allow predicate, and `internal.bundle_source(..., p_inherits)` where a club role assignment (`ra.team_id is null`) with a `scope_type='club'` bundle row answers a team question only if `p_inherits`.
- `internal.bundle_source` team branch also has the **Volunteer special case**: `ra.team_id = p_team and (b.scope_type='team' or (ra.role_key='VOLUNTEER' and b.scope_type='club'))`.
- Team-only reachability: club-wide powers are absent from team scope because their `valid_scopes` excludes `team` — `fixture.fixture.delete`, `fixture.fixture.bulk_edit`, `fixture.import.run`, `fixture.planner.use` (documented at `app/(app)/club/permissions/groups.ts:45-54` and in the `club_team_capabilities` body comment).

**Web scope switching:** scope is in the **URL**, not component state — `app/(app)/club/permissions/page.tsx:33-35` reads `searchParams.team`, `page.tsx:64` resolves it against the club's active teams, and `page.tsx:69` branches into the team render. `ScopeSwitcher` (`app/(app)/club/permissions/scope-switcher.tsx:17-58`) renders `Link href="/club/permissions"` ("All of {clubName}") plus one `Link href="/club/permissions?team={id}"` chip per team, with `aria-current="page"` on the active one. Rationale comment at `scope-switcher.tsx:5-16`: scope survives the reload a permission change causes, and the server reads the same value the write targets. The team branch passes `TEAM_GROUPS` and `presets={[]}` (presets are deliberately club-only, `page.tsx:140-141`).

Team list read: `teams` where `club_id=clubId and active=true and folded_at is null and archived_at is null`, ordered by `display_name` (`page.tsx:55-63`) — read **before** the branch so the switcher is always present.

---

## 3. Role-default authority (bundles)

Three layers, deliberately separate (documented in `supabase/tests/capability_defaults_architecture.sql:1-14`):
`public.capabilities` (the capability exists) → `public.capability_bundles` / `public.bundle_capabilities` (a role or relationship holds it by default) → `public.capability_overrides` (a person is allowed or withheld it).

`public.capability_bundles(bundle_key, label, kind, created_at)` — 18 rows:
- `kind='ROLE'`: **CA** Club Admin, **FS** Fixture Secretary, **SO** Safeguarding Officer, **VO** Volunteer, **CO** Coach, **TA** Team Administration, **TM** Team Manager, **MB** Member
- `kind='RELATIONSHIP'`: **PG** Parent/Guardian, **PL** Player, **SELF** Every Person (Own Account)
- `kind='SITE_PROFILE'`: SITE_FULL, SITE_OPS, SITE_DATA, SITE_SUPPORT, SITE_CONTENT, SITE_MOD, SITE_RO

`public.bundle_capabilities(bundle_key, capability_key, scope_type, created_at)` — scope_type is one of `site|club|team|child|self`, which is what makes "the same bundle answers differently at club vs team".

**Role → bundle** is `public.role_definitions(role_key, scope, label, bundle_key, visible, requires_base_role[], minor_prohibited, assignable_by[], is_primary_seat)`:
| role_key | scope | bundle |
|---|---|---|
| CLUB_ADMIN | CLUB | CA |
| FIXTURES_SECRETARY | CLUB | FS |
| MEMBER | CLUB | MB |
| SAFEGUARDING_OFFICER | CLUB | SO |
| VOLUNTEER | CLUB_OR_TEAM | VO |
| COACH | TEAM | CO |
| TEAM_ADMINISTRATION | TEAM | TA |
| TEAM_MANAGER | TEAM | TM |

Site profiles come from `public.site_admins.profile_key` joined to `bundle_capabilities` at `scope_type='site'` (`internal.subject_site_capability`), plus per-user add-ons from `public.site_capability_grants` restricted to `capabilities.site_addon_allowed` and profiles not in (`SITE_RO`,`SITE_FULL`).

### `internal.capability_decision` rule order (brief)
- **Rule 0** — subject present; if subject is the caller, `internal.session_live()`. Fails → `NO_SUBJECT` / `SESSION`.
- **Rule 1** — hard prohibitions: key exists and `status='ACTIVE'`; `scope_type='organisation'` refused; scope in `self|child|team|club|site` and in `valid_scopes`; per-scope shape checks (site names no club/team/player; club names a club and no team/player; team names a team and no player, club derived from `teams`, mismatch → `SCOPE_TAMPERED`; child names a real player; self names neither); `internal.is_account_active(subject)`; impersonation clamp (`VIEW` mode blocks any non-`view*` action; any impersonation blocks `impersonation_blocked` keys); `minor_prohibited` + `internal.person_is_minor`; club must be `status='active'`; membership `SUSPENDED` → refused.
- **Site scope short-circuit** — overrides never target site capabilities; only `internal.subject_site_capability` can allow (rule **7**), otherwise rule **8** `DEFAULT_DENY`.
- **Rules 2-4** — explicit **withholds**, most senior `granted_level` first (SITE→2, CLUB→3, TEAM→4), honouring `expires_at`, `inherits_to_team`, and the scope-match predicates. Wins over everything below.
- **Rule 5** — explicit **allows**, looped most-senior-first and **re-validated** (see §6).
- **Rule 6** — `internal.bundle_source(...)` → `ROLE_BUNDLE` (also PLAYER/GUARDIAN/SELF kinds).
- **Rule 8** — default deny, with the nearest explanatory reason: `ROLE_SUSPENDED` (re-runs `bundle_source` with `'SUSPENDED'`), `MEMBERSHIP_INACTIVE`, `ADULT_PLAYER`, else `DEFAULT_DENY`.

A one-row optimisation matters for mobile perf expectations: `v_has_overrides` is a single index probe (`capability_overrides_lookup_idx`) gating rules 2-5.

Enforcement entry point: `internal.can(key, scope_type, club, team, player)` = `internal.impersonation_permits(key) and capability_decision(effective_person(), …).allowed`.

---

## 4. Explicit ALLOW / WITHHOLD / INHERIT

### `public.set_capability_override(p_user_id uuid, p_capability_key text, p_scope_type text, p_club_id uuid, p_team_id uuid, p_effect text, p_reason text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL) RETURNS uuid`
`SECURITY DEFINER`, `search_path='public'`, granted to `authenticated`. Defined across `supabase/migrations/20270351000000_capability_overrides_and_adapters.sql`, `20270382000000_age_eligibility_gate.sql`, `20270516000000_a_club_can_say_yes_to_a_whole_job_at_once.sql`.

Order of checks (each raises a **product-language** message the app can surface verbatim):
1. `internal.actor()` non-null and `internal.session_ok()` → 42501 `'You must be signed in.'`
2. `internal.require_not_impersonating()` → 42501.
3. `p_effect in ('grant','deny')` → 22023 `'Choose whether to allow or withhold.'`
4. `p_scope_type in ('club','team','site')` → 22023 `'Invalid scope.'`
5. Scope shape: team requires club+team and `teams.club_id = p_club_id` (else **42501**, not 22023); club requires club and null team → 22023 `'A club decision names a club and no team.'`; site requires both null → 22023.
6. `internal.lock_club_people(p_club_id)` — advisory xact lock `'club-admin:'||club_id`, taken **before** anything about the person or actor is read (invariant R19: a decision never races a suspension or the actor's own loss of authority). Same lock as membership/role transitions.
7. Legacy key → canonical via `capability_key_map`; key must exist and be `ACTIVE` → 22023 `'Unknown capability.'`
8. **`key like 'site.%'` or `valid_scopes = array['site']` → 22023** `'Site capabilities are given through Site Admin profiles, not permission decisions.'`
9. Non-site scope must be in `valid_scopes` → 23514 `'That permission does not apply at % level.'`
10. **Authority:** `v_level := internal.override_authority_level(key, scope, club, team)` for club/team, or `'SITE'` when `internal.has_site_capability('site.capabilities.override')` for site scope. Null → 42501 `'You are not authorised to change that permission.'`
11. **Self refused:** `p_user_id = v_actor` → 42501 `'You cannot change your own permissions.'`
12. Subject account active → 23514 `'That account is not active.'`
13. Subject must have an `ACTIVE` `club_memberships` row in that club (or, at site scope, anywhere) → 23514 `'This person is not an active member of the club -- a permission decision adjusts real authority, it does not create a relationship.'`
14. **Age:** for `p_effect='grant'` on a `minor_prohibited` key: `internal.person_is_established_adult` → 23514 with `hint='AGE_ELIGIBILITY_REQUIRED'` and message `'That permission needs a date of birth on file showing this person is an adult.'`; then `internal.person_is_minor` → 23514 `'That permission cannot be given to someone under 18.'`
15. **Volunteer prohibition:** a non-SITE grant of a `domain in ('finance','people')` key to someone whose only ACTIVE club role is `VOLUNTEER` → 23514 `'A Volunteer cannot be given people or finance permissions by the club.'`
16. **Reason:** `p_effect='deny' and v_level <> 'SITE' and reason is null` → 22023 `'Give a reason for withholding this permission.'`
17. `p_expires_at <= now()` → 22023 `'The end date must be in the future.'`
18. `pg_advisory_xact_lock(hashtextextended('capability-override:'||user||':'||key, 0))`.
19. Existing active row for the exact `(user, key, scope_type, club, team)` selected `FOR UPDATE`. **P36:** if the existing `granted_level` outranks the actor's level, the actor is re-levelled to the needed minimum; still null → 42501 `'Ovalball has already decided this permission at a higher level, so it cannot be changed here.'`
20. **P37:** a `grant` that a more senior withhold at a broader scope would defeat is **refused, not recorded** → 42501 `'Ovalball has withheld this permission at a higher level, so allowing it here would have no effect.'`
21. Existing row → `status='revoked'`, `revoked_by/revoked_at/revoked_level`, `revocation_reason='Replaced by a new decision'`, plus an `override.revoked` security event.
22. New row inserted; `override.granted` security event emitted; returns the new `id`.

**`internal.override_authority_level(p_key, p_scope_type, p_club, p_team, p_minimum default null)`** is the whole authority model:
- `CLUB` level requires: `p_scope_type in ('club','team')` AND `c.delegable` AND `not c.safeguarding_sensitive` AND `c.grant_level in ('C','T')` AND `bundle_source(actor,'people.capability.manage','club',club,…,true) is not null` AND `internal.can('people.capability.manage','club',club,…)` AND `bundle_source(actor, p_key, p_scope_type, club, team, null, c.inherits_to_team) is not null`.
- `TEAM` level requires: team scope, `c.grant_level='T'`, `internal.can('people.capability.manage','team',club,team,…)`, and `bundle_source(actor, p_key, 'team', …)` non-null.
- `SITE` is appended whenever `internal.has_site_capability('site.capabilities.override')` — **unconditionally, bypassing delegable / grant_level / safeguarding_sensitive**.
- Returns the **lowest** level at or above `p_minimum` (`internal.override_level_rank`: SITE=3, CLUB=2, TEAM=1, null=0).

**Critical for the native UI:** "the key must be in the actor's own bundle" means **`bundle_source`**, i.e. the actor must hold the key **from a role bundle or relationship** — an actor who only holds the key via an override **cannot re-delegate it**.

### `public.revoke_capability_override(p_override_id uuid, p_reason text DEFAULT NULL) RETURNS void`
- Signed in + `session_ok` + `require_not_impersonating`.
- Unknown id → 42501 `'You are not authorised to change that permission.'` (deliberately not "not found" — no enumeration).
- `lock_club_people(club)`, then the same per-(user,key) advisory lock, then `SELECT … FOR UPDATE`.
- `v_level := override_authority_level(key, scope, club, team, v_override.granted_level)` (or SITE for site scope); null → 42501.
- **P36:** `override_level_rank(granted_level) > override_level_rank(v_level)` → 42501 `'Ovalball decided this permission at a higher level, so it cannot be removed here.'`
- **Self refused:** `v_override.user_id = v_actor` → 42501 `'You cannot change your own permissions.'`
- Already `revoked` → **silent no-op return** (idempotent; safe to retry on mobile).
- Sets `status='revoked'`, `revoked_by/revoked_at/revoked_level`, `revocation_reason` (trimmed, may be null), emits `override.revoked`.

### `public.capability_overrides` columns
`id uuid pk default gen_random_uuid(), user_id uuid → auth.users, capability_key text → capabilities(key), scope_type text, club_id uuid → clubs, team_id uuid → teams, effect text, reason text, granted_by uuid → auth.users, granted_at timestamptz default now(), revoked_by uuid, revoked_at timestamptz, status text default 'active', created_at, updated_at, granted_level text, expires_at timestamptz, revoked_level text, revocation_reason text`

Constraints: `effect in ('grant','deny')` · `scope_type in ('site','club','team')` · `status in ('active','revoked')` · `granted_level in ('SITE','CLUB','TEAM')` · `revoked_level` null or same set · `capability_overrides_scope_shape` (site→no club/team; club→club, no team; team→club+team) · `capability_overrides_site_scope_level` (site scope ⇒ granted_level='SITE') · `capability_overrides_team_level_scope` (granted_level='TEAM' ⇒ scope_type='team').

Indexes: `capability_overrides_lookup_idx (user_id, capability_key, scope_type, status)`, `capability_overrides_active_unique` UNIQUE on `(user_id, capability_key, scope_type, coalesce(club_id,0…0), coalesce(team_id,0…0)) WHERE status='active'` — **one active decision per person-key-scope**, enforced in the index not just in code.

**States:** `active` | `revoked`. **Expiry is not a status** — an `expires_at <= now()` row stays `status='active'` but is skipped by the engine (`o.expires_at is null or o.expires_at > now()` in rules 2-4 and 5). There is **no cron job** clearing them (`cron.job` has no matching entry). A native UI must therefore compute "expired" client-side from `expires_at`, and note that `club_member_capabilities`/`club_team_capabilities` join on `status='active'` only — so an expired row still surfaces as `override_id` non-null (offering Reset) while `effective` already reflects the expiry.

**"Inherit / restore default" is expressed as `revoke_capability_override(override_id)`.** There is no third effect value and no `p_effect='inherit'`. The web calls it "Reset" (`app/(app)/club/permissions/permissions-panel.tsx:253-262`, `app/(app)/club/permissions/actions.ts:71-77`).

Triggers on the table:
- `a_capability_override_defaults` (BEFORE INSERT / UPDATE OF capability_key) → `internal.capability_override_defaults()`: canonicalises the key via `capability_key_map`, and defaults `granted_level` to `'SITE'` when scope is site or `granted_by` is an active site admin, else `'CLUB'`.
- `enforce_capability_override_scope` (BEFORE INSERT/UPDATE) → team must belong to club (23514).
- `set_updated_at`.
- `audit_row_change` (AFTER INSERT/UPDATE/DELETE) → `internal.audit_row_change()`.

RLS: `relrowsecurity` on. `capability_overrides_select_scoped` (SELECT): `user_id = auth.uid()` OR (`club_id is not null` AND `internal.can('people.capability.manage','club',club_id,…)`) OR `internal.has_site_capability('site.users.view')`. `session_ok_required` (ALL, restrictive-style): `internal.session_ok()` for both USING and CHECK. **No INSERT/UPDATE/DELETE policy** — writes only through the DEFINER RPCs.

Site Admin wrapper: `public.site_set_capability_override(...)` = `internal.master_control_preamble('site.capabilities.override', p_reason, p_user_id)` + `master_control_target` + `set_capability_override`. Called from `app/(app)/admin/users/[userId]/master-control.ts:290-292`.

---

## 5. Protected capabilities

Nothing in `grant_level` is an explicit "protected" flag; protection is **emergent from the club/team level predicates** in `override_authority_level` requiring `grant_level in ('C','T')`. So:

- **Keys a club/team can never override:** `grant_level = 'N'` (54 ACTIVE) or `'S'` (56 ACTIVE). `'C'` = 41, `'T'` = 32.
- `'N'` includes the whole permission-administration set: **`people.capability.manage`, `people.role.assign_club`, `people.membership.revoke`, `people.membership.suspend`, `people.access.explain`, `people.manage`, `people.view`**, plus `club.settings.manage`, `team.lifecycle.manage`, `team.handover.apply`, `governing.access.manage`, all `account.*`, all `family.*` self keys, `messaging.policy.manage`, `safeguarding.officer.*`, `player.profile.edit_protected`, `finance.gocardless.connect`, `finance.subscription.configure`, `finance.platform_billing.manage`, `finance.payment.act`, etc.
- `'S'` = **reserved to Site Admin**: every `site.*` key plus `people.member.view_contact`, `safeguarding.dispensation.notify/view`, `safeguarding.officer.confirm`, `safeguarding.transfer.notify/view`.
- `people.capability.manage` is additionally `delegable=false` — doubly unreachable — and is excluded from the grid outright (both `club_*_capabilities` filter `c.delegable and c.grant_level in ('C','T')`). Test OC16 asserts "only `people.capability.manage`" is the ungrantable one on this screen.
- `safeguarding_sensitive = true` keys are excluded from CLUB/TEAM authority in `override_authority_level` **and** from rule 5 allows (`not c.delegable or c.safeguarding_sensitive → GRANTOR_AUTHORITY_LAPSED`). Today: `people.member.view_contact` and `site.users.view_personal` among the permission-adjacent set.
- `impersonation_blocked = true` ⇒ rule 1 refuses the key for **any** impersonated session (`internal.impersonation_mode() is not null`), regardless of VIEW/ACT. Every `site.*` key including `site.capabilities.override` is `impersonation_blocked`. Separately, a `VIEW`-mode impersonation refuses any capability whose `action` does not match `^view`.
- `minor_prohibited` defaults **true** (183 keys; only `people.access.explain` among the people keys is false).
- **A Site Admin holding `site.capabilities.override` can override any non-`site.*` key at club or team scope**, including `grant_level='N'` and `safeguarding_sensitive` ones, because `override_authority_level` appends `SITE` unconditionally. That is the "Restricted by Ovalball" state the club UI shows read-only.
- `set_capability_override` flatly refuses `key like 'site.%'` or `valid_scopes = {site}` at any scope — site capabilities come only from `site_admins.profile_key` bundles and `site_capability_grants`.

---

## 6. Delegation rules

`capabilities.delegable boolean default false`. Semantics: *may a club or team authority hand this key to an individual at all*. It gates **both** the write (`override_authority_level`, CLUB and TEAM branches) **and** the read of an existing grant (rule 5).

**Rule 5 re-validation, per candidate grant** (in `granted_level` order SITE→CLUB→TEAM):
- If the subject's `club_memberships.state` is not `'ACTIVE'` → trail `{result:'ignored', why:'MEMBERSHIP_INACTIVE'}`, continue.
- `granted_level='SITE'` → allowed immediately (no delegable / safeguarding / grantor checks).
- Otherwise (CLUB or TEAM), **all** of these must hold or the grant is ignored with `why:'GRANTOR_AUTHORITY_LAPSED'`:
  1. `c.delegable`
  2. `not c.safeguarding_sensitive`
  3. `granted_level='CLUB'` ⇒ `c.grant_level in ('C','T')`; `granted_level='TEAM'` ⇒ `c.grant_level='T'`
  4. `granted_by is not null`
  5. `internal.is_account_active(granted_by)`
  6. `internal.bundle_source(granted_by, 'people.capability.manage', o.scope_type, o.club_id, o.team_id, null, true) is not null` — the grantor **still holds the delegation authority from a role bundle**
  7. `internal.bundle_source(granted_by, p_key, o.scope_type, o.club_id, o.team_id, null, c.inherits_to_team) is not null` — the grantor **still holds the key itself from a role bundle**
  8. No `club_memberships` row for the grantor in that club with `state='SUSPENDED'`

So a grant **silently stops working** the moment the grantor loses Club Admin, is suspended, or loses the key — the row stays `status='active'` and `effective` goes false, with `reason_code` falling through to rule 6/8. The native UI must never infer "granted ⇒ allowed": read `effective` and `source` separately, exactly as the web does.

Proved in `supabase/tests/js/capability_override_races.test.mts` R19d/R19e.

---

## 7. Reason requirements and audit

**Reason:** `set_capability_override` does **not** use `internal.require_reason`; it has its own rule at one place — `p_effect='deny' AND v_level <> 'SITE' AND trim(reason) is null` → 22023 `'Give a reason for withholding this permission.'` So:
- club/team **withhold** → reason mandatory
- club/team **allow** → reason optional
- **site**-level decision through plain `set_capability_override` → reason optional…
- …but via `site_set_capability_override` → `internal.master_control_preamble` requires `internal.require_reason(p_reason, true)` **plus a ≥10-character trimmed minimum** (22023 `'Give a fuller reason -- at least ten characters, so the record makes sense later.'`), `internal.require_recent_aal2(interval '10 minutes')`, and `internal.refuse_self_target`.
- `revoke_capability_override` reason is **always optional** (stored in `revocation_reason`).
- `internal.require_reason` caps any reason at 500 characters (22023 `'Keep the reason to 500 characters or fewer.'`).
- `set_capability_override` / `revoke_capability_override` are deliberately **absent** from `packages/contracts/src/required-reasons.ts:22-35` (that list is the twelve RPCs whose bodies call `require_reason`, asserted by `supabase/tests/club_profile_domain_operation.sql`). A native slice adding a reason field must either extend that contract with its own conditional entry or keep it separate — do not silently add these two to `REASON_REQUIRED_OPERATIONS` without updating that assertion.

**Audit — three layers, all present:**
1. `audit_row_change` trigger on `capability_overrides` → `internal.audit_row_change()` (generic row-level audit into `audit_log`), made append-only by `internal.refuse_history_rewrite()`.
2. **Explicit `security_events` rows** via `internal.emit_security_event`: `override.granted` (metadata `override_id, capability_key, effect, granted_level, scope_type, expires_at`; reason carried in `reason`), `override.revoked` (metadata `override_id, capability_key, effect, granted_level, revoked_level, scope_type`), `override.preset_applied` (metadata `preset_key, preset_label, scope_type`). All three are registered in `public.security_event_types`. Note a replacement emits **`override.revoked` then `override.granted`** — two events for one button press.
3. Club-readable timeline: `public.club_access_history(p_club_id, p_subject_user_id, p_limit)`, used at `app/(app)/people/[membershipId]/page.tsx:196`; deliberately strips ip/user-agent/request-id/raw metadata (club screens are not forensic surfaces).

`emit_security_event` rejects unknown event types (22023) and non-object metadata.

---

## 8. Recent-authenticator `R`

- `capabilities.aal` ∈ {`A2`, `R`}: **110 ACTIVE keys at `A2`, 73 at `R`**.
- Permission-related `R` keys: `people.capability.manage`, `people.invitation.create`, `people.membership.revoke`, `people.membership.suspend`, `people.role.assign_club`, `people.role.assign_team`, `site.capabilities.override`, `site.permissions.manage`, `site.club_roles.manage`, `site.team_roles.manage`, `site.users.*` (all), `site.admins.manage`. Notably `people.access.explain` and `people.member.view` are `A2`, not `R`.
- **`internal.require_recent_aal2(p_within interval default '00:10:00')`** → calls `internal.recent_aal2(greatest(1, minutes))`; on failure raises 42501 `'Enter a code from your authenticator to continue.'`
- **`internal.recent_aal2(p_minutes int default 10)`**: null `auth.uid()` → false. If `auth.jwt()->>'session_id'` is absent/empty/not a 36-char UUID → **returns true** (service key and test harness are not a browser session). Otherwise `max(auth.mfa_amr_claims.updated_at) where session_id = <session> and authentication_method='totp'` must be `> now() - interval`.
- **Who actually calls it today:** only `approve_privileged_recovery`, `request_privileged_recovery`, `start_impersonation`, and `internal.master_control_preamble` (hence every `site_*` master-control RPC). **No club-scope operation calls it** — `set_capability_override` and `revoke_capability_override` do **not**. `aal='R'` on `people.capability.manage` is a declaration only, per the owner decision recorded in `docs/mobile/RECENT_AUTH_CONVERGENCE.md:11-24` and `:52-58` (converge when the owning slice ships).
- **Web `guardAction({recentMinutes})`** — `lib/auth/action-boundary.ts:35-43` wraps `requireSession` and maps a refusal to `{ok:false, error, href}`. `lib/auth/require-session.ts:42-62` reads the verified user via `getUser()` and then `supabase.rpc('my_session_assurance')`. `lib/auth/session-decision.ts:53-70` is the pure decision; `session-decision.ts:66-68` is the `R` clause: `if (options.recentMinutes && !assurance.recent_aal2) return {ok:false, reason:'VERIFY_AGAIN'}` → `sessionRefusal` (`session-decision.ts:74-85`) gives `{message:'Enter a code from your authenticator to continue.', href:'/security/verify'}`.
  **`recentMinutes` is a boolean gate, not a duration** — the actual window is baked into `my_session_assurance`, which hardcodes `internal.recent_aal2(10)`. Any value passed for `recentMinutes` means "within 10 minutes".
  **No club action passes `recentMinutes` today** — the only `guardAction` call sites are `app/(app)/account/actions.ts`, `app/(app)/account/security/actions.ts`, `app/(app)/account/security/recovery-actions.ts`, `app/security/verify/actions.ts`, `app/security/enrol/actions.ts`, `app/signup/complete-authenticated-signup.ts`, and `app/(app)/club/permissions/actions.ts` calls it **not at all**.
- `public.my_session_assurance()` returns `{account_usable, session_live, aal, enforcement_required, recent_aal2, enforcement_group}`. This is the one RPC mobile should adopt to know whether a re-auth step is needed before an override write.
- **What a client must do to satisfy AAL2 recency:** perform a fresh TOTP verification on the same GoTrue session — `supabase.auth.mfa.listFactors()` → `mfa.challenge({factorId})` → `mfa.verify({factorId, challengeId, code})`, which writes `auth.mfa_amr_claims.updated_at` for `authentication_method='totp'` on that `session_id`.
- **How mobile already handles MFA:** `apps/mobile/src/auth/session.tsx:34` declares `SessionStatus = "restoring" | "signed-out" | "needs-mfa" | "signed-in" | "recovering"`; `session.tsx:65-76` (`classify`) asks `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` and **fails closed to `needs-mfa` on error**; `session.tsx:169-172` exposes `refreshAssurance()`. `apps/mobile/app/_layout.tsx:178-181` routes `needs-mfa → /verify`. `apps/mobile/app/verify.tsx:26-79` is the full listFactors → challenge → verify → `refreshAssurance()` flow; it deliberately does not navigate itself and has no cancel (sign out is the only way back). Enrolment is web-only (no TOTP secret or QR on mobile).
  **Gap for CA-M4:** this is a *sign-in* gate, not a *step-up* gate. `/verify` is only reachable when `status === 'needs-mfa'`, and there is nothing that (a) reads `my_session_assurance().recent_aal2`, or (b) re-challenges an already-AAL2 session and returns to the pending action. Both are new work if CA-M4 converges any `R` key.

---

## 9. Self-protection

- **In `set_capability_override`:** `if p_user_id = v_actor then raise 42501 'You cannot change your own permissions.'` — before any write, after the authority check. Same clause in `revoke_capability_override`.
- **In the read model:** `editable` includes `subject <> internal.actor()` in both `club_member_capabilities` and `club_team_capabilities`, so a person's own rows render with no buttons at all (`permissions-panel.tsx:225`).
- **`people.capability.manage` specifically cannot be removed by override at club level at all**: `grant_level='N'` and `delegable=false`, so `override_authority_level` never returns CLUB or TEAM for it. It is also absent from the grid's key universe. Only a Site Admin with `site.capabilities.override` can withhold it (surfacing as `source='restricted'`, `editable=false`, "Ovalball decided this, so it can only be changed by Ovalball." — `permissions-panel.tsx:74-78`).
- **No "last Club Admin" invariant exists in `set_capability_override`.** The invariant lives only in role-land: `internal.assert_club_keeps_an_admin(p_club_id, p_ending uuid[], p_allow boolean, p_reason text)` → 23514 `'This would leave the club without a Club Admin. Make someone else Club Admin first.'`, escapable only by `p_allow=true` + `site.club_roles.manage` + a non-null reason, and skipped when the club is not active. Called from `public.transition_role_assignment(p_assignment_id, p_to_state, p_reason, p_allow_no_club_admin)` on both `SUSPENDED` and `REVOKED`. `transition_role_assignment` also refuses self-changes when acting at `SITE`/`TEAM_ADMIN` level (`'You cannot change your own roles.'`), refuses `SAFEGUARDING_OFFICER` outright (that goes through safeguarding settings), and always requires a reason (`internal.require_reason(p_reason, true)`; `REVOKED` at non-SITE level is conditional).
  Because overrides cannot touch `people.capability.manage`, no override path can produce a club with no permission administrator — the invariant is not duplicated because it cannot be breached there.

---

## 10. Stale-authority behaviour

**Web:** server-rendered page + server actions + `revalidatePath("/club/permissions")` after every write (`app/(app)/club/permissions/actions.ts:36`, `:66`, `:75`, `:104`). Actions are wrapped in `useTransition` (`permissions-panel.tsx:101`, `:106-109`, `:113-119`, `:123-127`); on failure the message is set into local state and shown at `permissions-panel.tsx:140-144` with `role="alert"`. The panel holds **no optimistic copy of the capability rows** — every state change comes from the re-rendered server payload, so the whole grid (including `editable` and `source`) is recomputed by the database on each mutation. `openMember` (the expanded accordion) is the only client state that survives.

**Mobile precedent to mirror:** `apps/mobile/src/admin/access.ts:36-57` — `setSections(null)` **first** on every context change (the previous context's answer must never decide this one), then `refresh()`, plus `useFocusEffect(refresh)` so a yes is never held across a screen return. `packages/contracts/src/club/admin-centre.ts:53-58` is the read. The same pattern applies to a native permissions screen: re-read `club_member_capabilities` / `club_team_capabilities` on focus, on context change, and after every write; never mutate a local row.

**Documented cross-client expectations** (`docs/mobile/CLUB_ADMIN_CENTRE_MAP.md:601-603`): #5 withhold on web → mobile hides/disables on next `my_capabilities` (engine rules 2-4); #6 revoke `people.capability.manage` on web while mobile has Permissions open → next mutation fails 42501, UI updates after refresh (the RPC re-asks `override_authority_level`; mobile maps 42501 to a refusal and re-reads); #7 one shared `audit_log`/`security_events` timeline.

Mobile error mapping already swallows raw authority text: `apps/mobile/src/errors/translate.ts:30` `const FORBIDDEN = /permission denied|42501|not authorised|not authorized|row-level security/i`. **Caution:** the override RPCs' 42501 messages are deliberately product-language and worth showing verbatim (`'Ovalball has withheld this permission at a higher level…'`, `'You cannot change your own permissions.'`) — a native slice should allow-list these rather than flatten them to a generic refusal.

---

## 11. Existing SQL suites covering overrides

| Suite | Coverage |
|---|---|
| `supabase/tests/capability_override_ceilings.sql` (316 lines) | The canonical one. OC1-OC4 club allow/withhold incl. reason; OC5-OC8 TEAM-level ceilings; OC9-OC14 refusals (self, minor, non-member, forged scope, Volunteer people/finance, past expiry, expiry honoured); OC15 legacy key canonicalised; OC16 provenance (`source`/`rule`/`level`/`editable`, "only `people.capability.manage`"); OC17-OC18 Site Admin levels; OC19 actor is the session; OC20 R19 sequencing. Registry disposition `CANONICAL_GATE` (`supabase/tests/suite-registry.json:195-199`). |
| `supabase/tests/capability_precedence_truth_table.sql` (402) | Rows P01-P38 incl. P36/P37, each asserting decision + decisive rule + `internal.can` agreement. `CANONICAL_GATE`. |
| `supabase/tests/capability_engine.sql` (411) | Engine regression + the persistent multi-club fixture personas. |
| `supabase/tests/capability_attack_matrix.sql` (307) | AM1-AM12+: anonymous, no relationship, wrong role/club/team, suspended/revoked membership and role, **AM10 explicit withhold**, malformed and forged scope. |
| `supabase/tests/capability_scope_isolation.sql` (295) | SI1-SI8: club vs team vs family scope isolation, immediate effect of suspension/revocation. |
| `supabase/tests/capability_defaults_architecture.sql` (352) | The three-layer separation (capabilities / bundles / overrides) and their precedence. |
| `supabase/tests/capability_catalogue_integrity.sql` (237) | CI1-CI7: catalogue counts, legacy-key resolution, metadata completeness, minor-prohibition coverage, impersonation-blocked coverage. |
| `supabase/tests/explain_access_matches_enforcement.sql` (255) | X1-X9: `explain_access` and `my_capabilities` must equal `internal.can`/`has_capability`, same decisive rule; redaction for non-admin viewers. |
| `supabase/tests/capability_adapters.sql` (240) | Club Home and fixture adapters over the resolver; FA8 withhold scoping. |
| `supabase/tests/team_fixture_authority.sql` | Sections H and I: the database side of team-scoped delegation. |
| `supabase/tests/js/capability_override_races.test.mts` | R19a-R19e: concurrent SITE/CLUB decisions, two Club Admins, delegated allow vs grantor losing authority, delegated allow vs member suspension (both orders). |
| `supabase/tests/js/team_permission_scope.test.mts` | Structural: the screen has a scope, writes through the canonical RPC, and club-wide fixture powers are absent from `TEAM_GROUPS`. **Imports `@/app/(app)/club/permissions/groups`** — so moving `groups.ts` into `packages/contracts` for the native slice will break this test and must be updated with it. |
| `supabase/tests/perf/capability_decision_benchmark.sql` | Decision latency. |
| Others touching overrides | `age_eligibility_matrix.sql`, `bundle_legacy_parity.sql`, `club_settings_capability_security.sql`, `fixture_management_authority.sql`, `roster_authority_matrix.sql`, `mobile_fixture_authority.sql`, `cross_club_isolation_matrix.sql`, `audit_immutability.sql`, `security_events_no_secrets.sql`, `site_admin_users_access_closure.sql`, `js/shared_contracts.test.mts` |

---

## 12. Web UI structure to mirror natively

**`app/(app)/club/permissions/page.tsx` (254 lines) — server component**
- `:35` `searchParams.team`; `:36-40` client + `getUser`; `:42-46` `getSessionContext` → `resolveActiveContext(ACTIVE_CONTEXT_COOKIE)` → `activeManageableClubId` (scoped to the **active** club context, not "any club this account administers" — `:17-28`); `:48-50` `hasCapability(supabase,'people.capability.manage','club',{clubId})` else redirect `/club` (friendly redirect only; the real boundary is the RPCs).
- `:55-63` teams for the switcher; `:66-67` club name via `clubs → club_directory(name)`.
- `:69-146` **team branch** and `:148-253` **club branch**.
- Comment at `:148-152` records why the three reads are sequential rather than `Promise.all` (Supabase generated types blow up with "type instantiation is excessively deep" on a 3-tuple of differently-shaped builders). Not a concern in a native client.
- Header: `ShieldCheck` icon + eyebrow "Club Admin", `h1` "Permissions", then a scope-specific explanatory paragraph, then (club branch only) the ceiling note at `:245-247`: *"Ovalball sets the ceiling. Where Ovalball has switched something off, allowing it here has no effect."*
- Container `mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12`.

**`scope-switcher.tsx` (58 lines)** — card `rounded-lg border bg-ink/[0.02]`, label "Deciding for", chips: "All of {clubName}" + one per team, `aria-current="page"` on active, footer note *"A club decision applies everywhere at {clubName}. A team decision applies to that team only."* Returns `null` when the club has no teams. Min touch target `min-h-9`.

**`permissions-panel.tsx` (278 lines) — client component**
- Types `MemberCapability` (`:8-18`: `capabilityKey, effective, source, overrideId, overrideLevel, editable`), `CapabilityPreset` (`:28-34`), `ClubMember` (`:36-43`: `userId, name, email, roleLabel, capabilities`).
- `SOURCE_LABEL` (`:66-72`): `role→"From their role"`, `granted→"Granted"`, `denied→"Withheld"`, `restricted→"Restricted by Ovalball"`, `none→"Not from their role"`.
- `lockReason` (`:74-78`): `editable` → null; `overrideLevel==='SITE'` → "Ovalball decided this, so it can only be changed by Ovalball."; else "You cannot change this permission."
- `:100-102` state: `openMember` (single-open accordion), `pending` from `useTransition`, `error`.
- `:130-136` empty state (dashed border), message injected per scope (`page.tsx:142` gives the team-specific wording).
- `:140-144` single `role="alert"` error banner at the top of the list.
- **Person row** `:152-167`: accordion button with `aria-expanded`, name + `roleLabel · email` secondary line, and a right-aligned count `"{granted} of {n} allowed"`.
- **Expanded body** `:169-272`:
  - **Presets section** `:171-197` (club scope only): heading "Give them a job", explanation "Everything that job needs, allowed in one go. Each permission is recorded separately, so you can still change any one of them below afterwards.", then one button per preset, `disabled={pending || !preset.mayApply}`, `title` = description + "Allows: …" when permitted, else "You cannot give a permission you do not hold yourself."
  - **Groups** `:199-270`: per `groups[]` a `section` with `h3` title + blurb, then a `ul` of rows filtered to keys the member actually has a row for (`:200-204` — a key absent from the RPC result is silently dropped, which is how non-delegable/ceiling-excluded keys disappear).
  - **Capability row** `:212-265`: left column = label, description, then a status line `"{Allowed|Not allowed} · {SOURCE_LABEL[source]}"` and, when locked, the `lockReason` line. Right column, **only when `editable`** (`:225`): `Allow` button (`aria-pressed={source==='granted'}`, active style pitch-green), `Withhold` button (`aria-pressed={source==='denied'}`, active style amber), and `Reset` (underlined text button) **only when `overrideId` is non-null**. All `min-h-9`, all `disabled={pending}`.
- **There is no reason input in the web UI.** The reason is hard-coded in the server action: `"Set from the club's permissions screen"` (`actions.ts:33`) and `"Set from the club's permissions screen, for this team"` (`actions.ts:63`). `revoke_capability_override` is called with no reason at all (`actions.ts:73`), and `apply_capability_preset` passes `p_reason: null` so the RPC falls back to the preset label. A native reason field would therefore be an **improvement over parity**, and is the one thing the server's `deny`-requires-a-reason rule actually wants (today the rule is satisfied by a boilerplate string that tells a later auditor nothing).

**`groups.ts` (72 lines)** — presentation-only capability grouping, deliberately **no raw keys in the UI** (rationale `permissions-panel.tsx:45-64`).
- `GROUPS` (`:5-41`): *Fixture Operations* (`fixture.fixture.view/create/edit/cancel`, `fixture.request.respond`, `fixture.fixture.bulk_edit`, `fixture.import.run`), *Training Operations* (`training.plan.manage`), *Pitch Allocation* (`venue.pitch_allocation.view/manage`), *Calendar and Events* (`calendar.event.view/manage`).
- `TEAM_GROUPS` (`:56-72`): one group *Team Fixtures* with team-worded labels — `fixture.fixture.view/create/edit/cancel`, `fixture.request.create`, `fixture.request.respond`, `fixture.result.record`.
- Both are passed to the RPC as `p_capability_keys` (`page.tsx:76`, `:157`), so the database answers exactly the set the screen renders.

**Related pieces worth mirroring / promoting to contracts**
- `lib/permissions/access-explanation.ts` — the **one** place a `reason_code` becomes a sentence. `AccessDecision` (`:20-27`), `REASON_SENTENCE` for 22 codes (`:34-77`), `explainDecision(name, capabilityLabel, decision)` (`:81-87`) producing "`{name} cannot {label}, because {reason}.`" with `decisiveRule` as the verbatim fallback, and `decisionRemedy(decision)` (`:93-111`) naming the lever ("Clear the override to fall back to their role.", "This club cannot change it.", …) without being a control. This is a pure function with no server-only import — ready to move into `packages/contracts` for shared use, and is exactly what `CLUB_ADMIN_CENTRE_MAP.md:587` names as a blocker.
- `lib/permissions/role-presentation.ts` → `roleAssignmentLabel(role_key, label, confirmation_state)` (`page.tsx:91`, `:175`) — a `PENDING_CONFIRMATION` Safeguarding Officer must not read as settled (`page.tsx:159-165`).
- `packages/contracts/src/club/admin-centre.ts:36` already has the row `{ key: "permissions", capability: "people.capability.manage", native: false, webPath: "/club/permissions" }` — CA-M4 flips `native: true` and adds the native route; `readAdminCentreAccess` (`:53-58`) needs no change.
- `lib/permissions/has-capability.ts:23-41` is the web's per-request-cached `my_capabilities` wrapper; the mobile equivalent is `apps/mobile/src/admin/access.ts` + `readAdminCentreAccess`.
- `app/(app)/club/settings/resolve-nav-capabilities.ts:29-30` has `canPermissions` as the single canonical nav visibility flag.

**Not to copy:** `app/(app)/admin/permissions/**` is a **read-only Site Admin catalogue** of `permission_groups` / `permission_group_capabilities` (legacy tables), explicitly "roles change only through a reviewed release, so these groups are read-only" (`admin/permissions/page.tsx:14-18`). It is not the override surface and is gated by `requireActiveSiteAdmin`. The Site Admin override surface is `app/(app)/admin/users/[userId]/master-control.ts:290-292` via `site_set_capability_override`, plus `app/(app)/admin/safeguarding/actions.ts:33`/`:56` which records Site-level withholds through the same canonical RPCs.

---

## Gaps / decisions CA-M4 must own

1. **`groups.ts` and `access-explanation.ts` must move to `packages/contracts`** so both clients name the same capabilities and the same sentences. `supabase/tests/js/team_permission_scope.test.mts` imports `groups.ts` by its `app/` path and will need updating in the same change.
2. **No reason input exists on web.** Native can add one (server already wants it for withholds); decide whether to also add it to web for parity, and whether to extend `packages/contracts/src/required-reasons.ts` (which is assertion-locked to `require_reason` callers — these two RPCs are not).
3. **`R` step-up is unimplemented on both clients for club work.** If CA-M4 enforces `require_recent_aal2` on `set_capability_override`, it needs: (a) a `my_session_assurance` read in mobile, (b) a step-up variant of `apps/mobile/app/verify.tsx` reachable from an already-AAL2 session that returns to the pending action, and (c) the same on web (`guardAction({recentMinutes: 10})` in `app/(app)/club/permissions/actions.ts`). Record the convergence in `docs/mobile/RECENT_AUTH_CONVERGENCE.md`.
4. **Expired-but-active override rows** have no cleanup job; the native UI must derive "expired" from `expires_at` itself, and note `set_capability_override` exposes `p_expires_at` which no client currently sets.
5. **Two events per replacement** (`override.revoked` + `override.granted`) — any native audit view must not read that as two separate administrative acts.
6. **`error.message` from these RPCs is intentionally user-facing**; `apps/mobile/src/errors/translate.ts:30` would currently flatten them. Allow-list the override messages.
7. **`my_capabilities` returns legacy-alias rows with null `decisive_rule`/`reason_code`** — dedupe on `canonical_key`.
8. Slice numbering: reconcile CA-M4 against `CLUB_ADMIN_CENTRE_MAP.md:583-591` (CA-M4 currently = messaging/pitch policy/training/documents; CA-M7 = the permissions panel) and `RECENT_AUTH_CONVERGENCE.md:54` (CA-M3 = People & Permissions).
