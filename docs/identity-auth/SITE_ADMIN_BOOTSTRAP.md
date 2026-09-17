# Creating the first additional Full Site Admin (AN-3)

**Status:** required procedure. Written for Slice 7c, which made a Site Admin grant take two people.

## Why this document has to exist

Slice 7c closed every route by which one person could make somebody a Site Admin. A grant now needs a
request from one Full Site Admin and an approval from a different one, and the rule sits on the
`site_admins` row itself rather than on any one door into it, so writing the table directly, issuing a
Site Admin invitation and redeeming a Slice 5 `SITE_ADMIN` invitation all go through the same gate.

Production has **one** Full Site Admin. A rule that needs two therefore cannot be satisfied, and that
is not a defect: it is the rule refusing to make an exception for exactly the situation it exists to
cover. Phase 2 AN-3 says so directly — the first additional Full Site Admin is created by

> a one-off, documented, audited bootstrap procedure run by the platform owner, **not by relaxing the
> rule in code**.

This is that procedure. Nothing in the application performs it, and nothing in the application can.

## What this procedure deliberately is not

- **Not a code path.** There is no flag, no environment variable and no "bootstrap mode". Anything of
  that kind is a permanent single-person route to platform authority wearing a temporary name.
- **Not a way to skip the second approver afterwards.** It runs once. After it, two Full Site Admins
  exist and the ordinary rule works, including for the third and every one after.
- **Not something a Site Admin can do.** It requires direct database access, which means the platform
  owner and nobody else.

## Before you start

The second administrator must already have an Ovalball account, and must have finished setting it up
— a password and an authenticator. Master control refuses anybody whose second factor is not recent,
so an administrator who cannot produce an authenticator code is an administrator who cannot act.

Confirm, in production:

```sql
select p.email, p.account_state, p.setup_state,
       (select count(*) from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') as authenticators
  from public.profiles p
 where p.email = '<the second administrator>';
```

Expect `ACTIVE`, `COMPLETE`, and at least one verified authenticator. If not, stop: finish setting the
account up first, through the ordinary flow, as that person.

## The procedure

Run as the database owner, in one transaction, with the reason written before you start rather than
invented at the prompt.

```sql
begin;

-- 1. Say who, and why. The reason is read later by somebody who was not here.
\set target_email '<the second administrator>'
\set reason 'AN-3 bootstrap: Ovalball had one Full Site Admin, so no grant could be approved and no
account could be recovered if that one were lost. Authorised by the platform owner on <date>.'

-- 2. The grant request and its approval, recorded as the two separate acts they are. There is no
--    second administrator to approve it, so the platform owner stands as both -- which is precisely
--    what makes this a bootstrap and precisely why it is done here and not in the product.
insert into public.site_admin_grant_requests
  (target_user_id, profile_key, requested_by, reason, state, decided_by, decided_at, decision_reason)
select p.id, 'SITE_FULL', owner.user_id, :'reason', 'APPROVED', owner.user_id, now(), :'reason'
  from public.profiles p
  cross join (select user_id from public.site_admins where status = 'active' and profile_key = 'SITE_FULL' limit 1) owner
 where p.email = :'target_email';

-- 3. Apply it through the SAME function every other grant goes through, so the row is created the
--    one canonical way and the site_admin.granted event is written by the trigger that owns it.
select internal.apply_site_admin_grant(
  (select id from public.profiles where email = :'target_email'), 'SITE_FULL');

-- 4. Leave a mark that says this was a bootstrap and not an ordinary grant.
select internal.emit_security_event('site_admin.grant_approved',
  (select id from public.profiles where email = :'target_email'), 'SUCCESS',
  'AN-3 BOOTSTRAP -- ' || :'reason',
  jsonb_build_object('bootstrap', true, 'profile_key', 'SITE_FULL'), null, null, null);

commit;
```

Note that step 3 does not bypass anything: `internal.apply_site_admin_grant` still refuses unless it
finds an approved request, and step 2 is what supplies one. The exception being made is visible in
exactly one place — that the requester and the approver are the same person — and the database's own
`site_admin_grant_requests_decider_not_requester` CHECK will refuse it, which is why step 2 writes the
row with `decided_by` set rather than calling the approval RPC.

If the CHECK refuses the insert, that is the constraint doing its job. Drop it for the length of this
transaction and restore it before you commit:

```sql
alter table public.site_admin_grant_requests drop constraint site_admin_grant_requests_decider_not_requester;
-- ... steps 2 to 4 ...
alter table public.site_admin_grant_requests add constraint site_admin_grant_requests_decider_not_requester
  check (decided_by is null or decided_by <> requested_by);
```

The final `alter table` revalidates every existing row, so a forgotten restore fails loudly the next
time anybody looks, and the constraint cannot quietly stay off.

## Afterwards

```sql
select count(*) from public.site_admins where status = 'active' and profile_key = 'SITE_FULL';
```

Expect **2**. Then, in the product and not in SQL:

1. Both administrators sign in and confirm they can reach Site Admin.
2. Raise and approve a genuine grant request between them — any narrow profile, for a test account,
   revoked immediately afterwards. This proves the ordinary two-person path works, which is the whole
   point of having done the bootstrap.
3. Rehearse break-glass (`docs/security/BREAK_GLASS.md`) now that a second administrator exists to
   perform the other half of it.

Record the date, the two people and the reason in `docs/identity-auth/IDENTITY_AUTH_DECISION_RECORD.md`.

## The pending invitation

At the time of the Slice 7 release, production held one **pending Site Admin invitation for `full`**,
issued 14 September 2026 and expiring 21 September 2026. Slice 7c means that invitation, on its own,
grants nothing: `accept_site_admin_invitation` now asks `internal.apply_site_admin_grant`, which needs
an approved request behind it.

This was not weakened for it, and should not be. Either

- run this procedure for that person, after which they are a Full Site Admin and the invitation is
  redundant (revoke it: `select public.revoke_invitation(...)`), **or**
- let the invitation expire and grant them through the ordinary two-person path once a second Full
  Site Admin exists.

What must not happen is the invitation being clicked and failing with no explanation, so whoever holds
it should be told which of the two is happening.
