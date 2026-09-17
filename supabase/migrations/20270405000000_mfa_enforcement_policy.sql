-- =====================================================================================================
-- SLICE 6 (2/n) -- the flags that make mandatory MFA survivable (Phase 2 Y.4, AG.1)
--
-- Mandatory TOTP is a locked decision (L3). Turning it on for everyone the moment the code ships is not,
-- and L16 says so in as many words: "no big bang. Privileged roles upgrade first; at least two Full Site
-- Admins upgraded and break-glass tested before mandatory enforcement."
--
-- So enforcement is DATA, not code. Every group starts null, which means not enforced, and the whole of
-- Slice 6 ships in that state (AG.2 T0). Turning a group on later is an UPDATE, and turning it back off
-- is an UPDATE too -- rollback needs no deploy, which is the point (AG.4).
--
-- This matters concretely here and now. Production has four identities, ZERO verified TOTP factors and a
-- single Full Site Admin. If session_ok demanded AAL2 today, the release would lock every user out of
-- Ovalball, including the only person who could fix it.
-- =====================================================================================================

create table if not exists public.mfa_enforcement_policy (
  enforcement_group      text primary key,
  require_aal2_from      timestamptz,
  grace_until            timestamptz,
  block_magic_link_login boolean not null default false,
  reason                 text,
  updated_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  constraint mfa_enforcement_policy_group_check
    check (enforcement_group in ('PRIVILEGED','STAFF','FAMILY','PLAYER','MINOR','NONE'))
);

comment on table public.mfa_enforcement_policy is
  'Phase 2 Y.4 / AG.1. One row per rollout group. require_aal2_from null means NOT ENFORCED. Every group '
  'is null at creation so that Slice 6 deploys with no enforcement at all (AG.2 T0).';

comment on column public.mfa_enforcement_policy.require_aal2_from is
  'Null = not enforced. A timestamp = sessions must reach AAL2 from that moment. Rolling back is setting '
  'it back to null, which needs no deploy.';

-- All six groups, all off. Written as a plain insert rather than a default row per group so that a group
-- appearing later is a visible schema change rather than silently unenforced.
insert into public.mfa_enforcement_policy (enforcement_group, reason)
select g, 'Slice 6 T0: shipped with no enforcement (AG.2)'
  from unnest(array['PRIVILEGED','STAFF','FAMILY','PLAYER','MINOR','NONE']) g
on conflict (enforcement_group) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- Perimeter. session_ok has to read this on every request, so `authenticated` may SELECT it -- there is
-- nothing secret in it. Nobody may write it from a browser; AG.1 puts that behind a site RPC with R2.
-- ---------------------------------------------------------------------------------------------------
alter table public.mfa_enforcement_policy enable row level security;

drop policy if exists mfa_enforcement_policy_select on public.mfa_enforcement_policy;
create policy mfa_enforcement_policy_select on public.mfa_enforcement_policy
  for select to authenticated using (true);

revoke all on public.mfa_enforcement_policy from anon, authenticated;
grant select on public.mfa_enforcement_policy to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Is this group being enforced right now?
--
-- Deliberately generous about the ways a group can be NOT enforced, because every one of them is a way
-- somebody keeps working: no row at all, no date, a future date, or a grace window still running.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.mfa_enforced_for_group(p_group text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.require_aal2_from is not null
       and p.require_aal2_from <= now()
       and (p.grace_until is null or p.grace_until <= now())
      from public.mfa_enforcement_policy p
     where p.enforcement_group = p_group
  ), false);
$$;

create or replace function internal.magic_link_blocked_for_group(p_group text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.block_magic_link_login from public.mfa_enforcement_policy p
                    where p.enforcement_group = p_group), false);
$$;

do $$
declare v_on int;
begin
  select count(*) into v_on from public.mfa_enforcement_policy where require_aal2_from is not null;
  if v_on <> 0 then
    raise exception 'Slice 6: enforcement is ON for % group(s) at deploy. T0 ships with none.', v_on;
  end if;
  if (select count(*) from public.mfa_enforcement_policy) <> 6 then
    raise exception 'Slice 6: a rollout group has no policy row, so it would be silently unenforced.';
  end if;
  if exists (select 1 from unnest(array['PRIVILEGED','STAFF','FAMILY','PLAYER','MINOR','NONE']) g
              where internal.mfa_enforced_for_group(g)) then
    raise exception 'Slice 6: a group reports as enforced at T0.';
  end if;
  raise notice 'Slice 6: 6 rollout groups, all OFF -- nobody is locked out by this release';
end $$;
