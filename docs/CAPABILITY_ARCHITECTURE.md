# Capability architecture

How Ovalball decides whether someone may do something, and how to add a new
capability without breaking somebody else's.

**If you only read one thing:** to give a role a new capability, `insert` a
row into `public.role_capability_defaults`. Never re-declare
`internal.has_club_role_capability` or `internal.has_team_role_capability`
to do it. Section 8 explains what happens when you do.

---

## 1. The three layers

They answer three different questions and must not be collapsed.

| Layer | Table | Question it answers | Who writes it |
|---|---|---|---|
| **Catalogue** | `public.capabilities` | Does this capability *exist*, and at which scopes is it meaningful? | Migrations |
| **Role defaults** | `public.role_capability_defaults` | Does this *role* get it automatically? | Migrations |
| **Overrides** | `public.capability_overrides` | Is this *person* specifically granted or denied it? | Site Admin, at runtime, audited |

A capability that is not in the catalogue can never resolve, whatever the
defaults say — `internal.has_capability` checks the catalogue before it
consults anything else. That is why `role_capability_defaults.capability_key`
carries a foreign key to `capabilities(key)`: a default naming a
non-existent capability is dead weight, and the FK turns a silent no-op into
a migration-time error.

### The catalogue

```
public.capabilities (key, label, description, category, applicable_scopes)
```

`applicable_scopes` is the real gate on scope: a `club`-only capability
cannot be exercised at `site` scope no matter how the arguments are shaped.

### Role defaults

```
public.role_capability_defaults (scope_type, role_key, capability_key)
```

**Presence of a row means allowed.** There is deliberately no `effect`,
`allowed` or `deny` column. A denial is always about a *person* — an
explicit override — never about a role. Giving roles a deny concept would
create two ways to express the same thing and a precedence question nobody
needs.

Role keys:

| Scope | Role key | Who that is |
|---|---|---|
| `club` | `CLUB_ADMIN` | `club_memberships.role = 'CLUB_ADMIN'`, active, not authority-suspended |
| `club` | `FIXTURE_SECRETARY` | same, role `FIXTURE_SECRETARY` |
| `club` | `CLUB_MEMBER` | any active club membership |
| `team` | `CLUB_ADMIN` | a Club Admin acting at team scope |
| `team` | `TEAM_STAFF` | `team_permissions.permission in ('team_admin','coach','manager')` |
| `team` | `TEAM_MEMBER` | any team permission at all |

The first matching branch wins — a Club Admin is evaluated as a Club Admin,
not additionally as a member.

### Overrides

`public.capability_overrides` grants or denies one capability to one person
at one scope, with `granted_by`, `reason`, and a revocation trail. This is
runtime data, written through `set_capability_override` /
`revoke_capability_override`, and it is audited. Role defaults are not
runtime data and are not audited at runtime — they change only by migration,
and the migration *is* the record.

---

## 2. Precedence

`internal.has_capability(capability_key, scope_type, club_id, team_id)`
resolves in this exact order. Nothing short-circuits earlier than shown.

1. **Account active?** No → `false`.
2. **Catalogue + scope.** The capability must exist and the scope must be in
   its `applicable_scopes`; the club/team arguments must be shaped correctly
   for the scope, and a `team_id` must genuinely belong to the `club_id`
   passed alongside it. A caller-supplied pairing is never trusted.
3. **Explicit DENY override** → `false`. This is the strongest rule in the
   system and outranks everything below it, Site Admin included.
4. **Site Admin**, at `club` or `team` scope → `true`.
5. **Explicit GRANT override** → `true`.
6. **Role default** → the table lookup described above.

Two consequences worth stating plainly, both regression-tested:

- A deny override removes one capability from one person and leaves both the
  role default and every other capability of that role untouched.
- A grant override gives one person one capability without changing what any
  role gets.

---

## 3. Site scope is deliberately different

`internal.has_site_role_capability` is **not** table-driven, and converting
it would be a mistake.

Its capabilities map to per-user boolean columns on `public.site_admins`
(`manage_permissions`, `manage_global_lookups`, `view_commercial`, and so
on), written by the `set_site_admin_*_capability` RPCs. That is already
per-person grant data. Moving it into `role_capability_defaults` would turn
a per-person switch into a platform-wide one — the opposite of what it is
for.

A Full Site Admin (`internal.is_full_site_admin()`) short-circuits to `true`;
everyone else gets exactly the columns they were granted.

`site.commercial.manage` is hard-coded `false`: the capability exists in the
catalogue but nothing grants it yet. That is intentional and should stay
until a real commercial-management surface exists.

---

## 4. Adding a capability — the procedure

One migration. It touches its own domain and nothing else.

```sql
-- 1. Catalogue it.
insert into public.capabilities (key, label, description, category, applicable_scopes)
values ('club.widgets.manage', 'Manage widgets',
        'Create, edit and retire this club''s widgets.', 'club', array['club']);

-- 2. Give it to the roles that should have it by default.
insert into public.role_capability_defaults (scope_type, role_key, capability_key)
values ('club', 'CLUB_ADMIN', 'club.widgets.manage');
```

That is the whole procedure. Note what is absent: no function is
re-declared, and no other domain's capabilities appear anywhere in the
migration.

**Removing** a default is a `delete` of that one row. **Renaming** a
capability is an `update` on `capabilities.key`, which cascades to the
defaults via `on update cascade`.

---

## 5. The rule

> **New feature migrations must add their own capability definitions and
> defaults without restating or replacing any other domain's capabilities.**

A migration that contains a capability key belonging to a domain it is not
changing is almost certainly wrong.

---

## 6. Safety invariants are not capabilities

A capability decides whether an actor may *attempt* an operation. It never
decides whether the operation is *sound*. These remain enforced structurally
in RLS, constraints and `security definer` function bodies, and no override
can reach them:

- **Cross-club isolation.** A grant at club A grants nothing at club B. RPCs
  re-derive the club from the record, never from a caller argument.
- **Cross-row integrity.** A pitch must belong to a venue of its own club; a
  `team_id` must belong to the `club_id` it is passed with. RLS is row-scoped
  and cannot express these, so they live in function bodies.
- **Youth safety and guardian consent.** Guardian relationships and consent
  are canonical records, not permissions.
- **Canonical identity.** An active team must resolve to a canonical team
  type; a fixture keeps its `is_primary_mirror` contract.
- **Club lifecycle.** A deactivated or suspended club yields no club
  capability to anyone, whatever the defaults or overrides say — the
  `is_club_active` check runs before any role branch.

If a future requirement seems to need an override that crosses one of these,
the requirement is wrong, not the invariant.

---

## 7. Security and performance

**Security.** `role_capability_defaults` has RLS enabled and *no* grant to
`anon` or `authenticated` — not even `select`. The evaluation functions are
`security definer` and read it as the owner. A Club Admin, who holds every
club capability there is, still cannot write the table that decides what
those capabilities are. Regression-tested.

**Performance.** The primary key is `(scope_type, role_key, capability_key)`
and every lookup is an equality probe on all three columns, so it is an
index-only scan of one row. No separate index is needed, and there is no
N+1: one probe replaces what was a linear scan of an inline `IN` list.

---

## 8. Why inline lists are prohibited

Before this, role defaults lived as inline `p_capability_key in (...)` lists
inside the evaluation functions. Adding a capability meant re-declaring the
whole function. A re-declaration written from an older copy of the list
silently deleted every capability added since — no error, no warning. A
product area simply stopped working for every Club Admin on the platform.

**This happened ten times.** The two most recent:

- `20261011000000` (training) dropped four commercial capabilities.
  `20261012000000` restored them and added the R-0 regression assertion.
- `20261018000000` (safeguarding) correctly added
  `club.safeguarding.view` / `manage_contact` / `message` and silently
  dropped **twelve**: all of platform billing, referrals, training,
  GoCardless connection, the subscription capabilities and
  `club.guardians.manage`. Seven previously-green suites failed at once and
  the R-0 assertion named the missing keys exactly.
  `20261019000000` restored the union.

`20261020000000` removes the failure mode rather than the symptom. The lists
are now rows. Adding a row cannot delete a row.

`supabase/tests/capability_defaults_architecture.sql` proves it directly: it
adds a new domain's capability and default, then asserts every capability
the R-0 incident destroyed still resolves. If someone reintroduces an inline
list, that suite fails.

---

## 9. Compatibility notes

**Safeguarding.** The Safeguarding Officer feature's three role-default
capabilities are seeded like any other domain's and coexist with everything
else. Its per-officer capabilities — `club.dispensation.view`,
`club.dispensation.notify`, `club.transfer.safeguarding_view`,
`club.transfer.safeguarding_notify` — are deliberately **not** role defaults:
they are granted individually per accepted officer through the override
layer, which is exactly the right layer for a per-person grant.

**Commercial and referrals.** All of `club.platform_billing.*`,
`club.referrals.*`, `club.subscription.*` and `club.gocardless.connect` are
CLUB_ADMIN defaults and are asserted by name in two suites, so a future
regression names them rather than failing vaguely.

**Team staff.** `TEAM_STAFF` deliberately holds no club-level write
capability — not `club.teams.manage`, `club.team_lifecycle.manage`,
`club.roster.manage`, `team.roster.manage` or `club.guardians.manage`. This
preserves the standing "no new Team Admin write capability" decision and the
explicit "team staff cannot remove a Guardian" rule. The migration guard
fails if any of those keys appears in a `TEAM_STAFF` row.
