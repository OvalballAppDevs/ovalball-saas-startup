# Break glass — no Full Site Admin can sign in

**This procedure is a gate on Slice 6's rollout, not a routine tool.** Phase 2 G requires it to exist
before mandatory MFA is switched on for anyone, and L16 requires it to have been *rehearsed* on a
disposable clone of production before that.

It is written down because the situation it covers is the one where nobody can log in to write it.

## When this applies

Only when **no Full Site Admin can reach Ovalball at all** — every Full Site Admin has lost their
authenticator and their recovery codes, or the enforcement flags have been set in a way that excludes
them.

It does **not** apply when:

- one Full Site Admin can still sign in. Use the ordinary recovery flow (Account → Security, or a
  privileged recovery request approved by the other administrator);
- somebody has lost a password. That is `/forgot-password`;
- somebody has lost an authenticator but has a recovery code. That is `/security/recovery`.

## Why it is outside Ovalball

The escape route must not depend on the thing that has failed. It runs through the **Supabase dashboard
owner account**, which is a different identity, protected by its own MFA, and is not an Ovalball
account at all. Ovalball has no path that lets an administrator restore their own access — that is
deliberate, and it is what makes the two-person rule meaningful.

## The procedure

Carried out by the platform owner, signed in to the Supabase dashboard as the project owner.

1. **Record why.** Before touching anything, write down what has happened and who is involved. This is
   an incident, and the post-incident review below is not optional.

2. **Confirm the situation is real.** In the SQL editor:

   ```sql
   select u.email, s.admin_role,
          (select count(*) from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as factors,
          (select count(*) from public.account_recovery_codes r where r.user_id = u.id and r.used_at is null) as codes
     from public.site_admins s join auth.users u on u.id = s.user_id
    where s.status = 'active' and s.admin_role = 'full';
   ```

   If any row shows a factor or an unused code, **stop**: this is not a break-glass situation and the
   ordinary flow applies.

3. **Restore ONE administrator, not all of them.** Choose the single Full Site Admin who will recover,
   and remove only their factors:

   ```sql
   -- Replace the address. One person, deliberately.
   with target as (select id from auth.users where email = 'REPLACE@example.com')
   delete from auth.mfa_factors where user_id in (select id from target);
   ```

4. **Record it in Ovalball's own audit**, by hand, because no Ovalball session did this:

   ```sql
   with target as (select id from auth.users where email = 'REPLACE@example.com')
   insert into public.security_events (event_type, subject_user_id, reason, metadata)
   select 'mfa.factors_reset', id,
          'BREAK GLASS: dashboard owner restored access. Incident REPLACE-WITH-REFERENCE.',
          jsonb_build_object('procedure', 'docs/security/BREAK_GLASS.md')
     from target;
   ```

   Never put a password, a code, a secret or a token in that metadata. The audit trigger rejects
   secret-shaped keys, and it is right to.

5. **The administrator signs in and re-enrols immediately**, at `/security/enrol`, and saves new
   recovery codes.

6. **If enforcement caused the lockout**, roll it back rather than working around it:

   ```sql
   update public.mfa_enforcement_policy set require_aal2_from = null where enforcement_group = 'PRIVILEGED';
   ```

   That is AG.4's sanctioned rollback. It restores the pre-enforcement authentication posture for that
   group and nothing else: Phase 0 containment, the perimeter grants, capability decisions, the hard
   prohibitions, master-control audit and invitation hashing are all untouched by that flag.

## What this procedure must never be used for

- Granting Site Admin to somebody who did not have it.
- Resetting a factor for an administrator who *can* still sign in — that is a privileged recovery
  request, and it needs a second administrator on purpose.
- Bypassing the two-person rule because it is inconvenient. If a recovery genuinely needs two
  administrators and only one exists, the answer is to appoint a second (AN-3), not to route around it.

## After

Within one working day: a written post-incident review covering what failed, why the ordinary recovery
paths were unavailable, and what would prevent it recurring. If the cause was a single point of failure
in the administrator population, appointing an additional Full Site Admin is the fix.

## Rehearsal status

**Not yet rehearsed against a clone of production.** Phase 2 L16 requires that rehearsal before
mandatory enforcement is switched on for the PRIVILEGED group, and it also requires a second Full Site
Admin to exist first (AN-3). Production currently has one. Both are deferred steps, and they are the
gate on AG.2 step T3 — not on this release, which ships with no enforcement at all.
