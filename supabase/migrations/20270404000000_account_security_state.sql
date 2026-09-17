-- =====================================================================================================
-- SLICE 6 (1/n) -- what Ovalball knows about an account's own security (Phase 2 Y.2)
--
-- One row per identity, recording POSTURE and never a credential: when a password was set, when MFA was
-- enrolled, when recovery codes were generated. The password itself, its hash, and every TOTP secret stay
-- in GoTrue, which is the credential authority. Ovalball stores the dates and nothing else (E, "Storage").
--
-- The enforcement GROUP is the other half. Phase 2 AG rolls mandatory MFA out group by group rather than
-- all at once (L16, "no big bang"), and a group is derived from what a person actually holds, not chosen
-- by hand: anyone with site or club authority is PRIVILEGED, team staff are STAFF, guardians FAMILY,
-- players PLAYER or MINOR by age, and an identity holding nothing is NONE.
--
-- Deriving it rather than storing a decision means a person who becomes a Club Admin tomorrow is
-- PRIVILEGED tomorrow, without anybody remembering to move them.
-- =====================================================================================================

create table if not exists public.account_security_state (
  user_id                    uuid primary key references auth.users(id) on delete cascade,
  password_set_at            timestamptz,
  mfa_enrolled_at            timestamptz,
  recovery_codes_generated_at timestamptz,
  must_reset_password        boolean not null default false,
  enforcement_group          text not null default 'NONE',
  enforcement_override       text,
  enforcement_override_until timestamptz,
  last_security_review_at    timestamptz,
  last_aal2_at               timestamptz,
  updated_at                 timestamptz not null default now(),
  constraint account_security_state_group_check
    check (enforcement_group in ('PRIVILEGED','STAFF','FAMILY','PLAYER','MINOR','NONE')),
  constraint account_security_state_override_check
    check (enforcement_override is null
           or (enforcement_override in ('EXEMPT_UNTIL_DATE','FORCE_NOW')
               and (enforcement_override <> 'EXEMPT_UNTIL_DATE' or enforcement_override_until is not null)))
);

create index if not exists account_security_state_group_idx
  on public.account_security_state (enforcement_group, mfa_enrolled_at);

comment on table public.account_security_state is
  'Phase 2 Y.2. Security POSTURE for one identity -- dates and an enforcement group, never a credential. '
  'Passwords and TOTP secrets live in GoTrue and are never copied here.';

-- ---------------------------------------------------------------------------------------------------
-- Which group an identity belongs to, derived from what they hold.
--
-- Ordered most privileged first and returns on the first match, because a person who is both a Club
-- Admin and a parent is PRIVILEGED: the rollout has to be driven by the greatest authority somebody
-- holds, never the most convenient one.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.derive_enforcement_group(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_user_id is null then 'NONE'
    -- Site authority of any profile, or a club role that governs people, money or children.
    when exists (select 1 from public.site_admins sa where sa.user_id = p_user_id and sa.status = 'active')
      or exists (select 1 from public.role_assignments ra
                   join public.club_memberships m on m.id = ra.membership_id
                  where m.user_id = p_user_id and ra.state = 'ACTIVE'
                    and ra.role_key in ('CLUB_ADMIN','SAFEGUARDING_OFFICER','FIXTURES_SECRETARY'))
      then 'PRIVILEGED'
    -- Team staff: real authority over a squad, but not over the club.
    when exists (select 1 from public.role_assignments ra
                   join public.club_memberships m on m.id = ra.membership_id
                  where m.user_id = p_user_id and ra.state = 'ACTIVE'
                    and ra.role_key in ('COACH','TEAM_MANAGER','TEAM_ADMINISTRATION','VOLUNTEER'))
      then 'STAFF'
    -- A guardian acts for somebody else's data, so they come before a player who acts only for their own.
    when exists (select 1 from public.guardians g
                  where g.guardian_user_id = p_user_id and g.state = 'ACTIVE')
      then 'FAMILY'
    when exists (select 1 from public.players pl where pl.user_id = p_user_id)
      then case when internal.person_is_minor(p_user_id) then 'MINOR' else 'PLAYER' end
    else 'NONE'
  end;
$$;

comment on function internal.derive_enforcement_group(uuid) is
  'Phase 2 Y.2 backfill rule. The GREATEST authority an identity holds decides its rollout group, so a '
  'Club Admin who is also a parent is PRIVILEGED.';

-- ---------------------------------------------------------------------------------------------------
-- Keep the row honest.
--
-- mfa_enrolled_at and password_set_at are FACTS ABOUT GOTRUE, so they are read from GoTrue rather than
-- trusted from whatever last wrote here. A row that disagrees with auth is worse than no row: it is the
-- thing an enforcement decision would be made from.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.refresh_account_security_state(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_security_state (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  update public.account_security_state s
     set enforcement_group = internal.derive_enforcement_group(p_user_id),
         mfa_enrolled_at = (select min(f.updated_at) from auth.mfa_factors f
                             where f.user_id = p_user_id and f.status = 'verified'),
         password_set_at = coalesce(
           s.password_set_at,
           (select u.updated_at from auth.users u
             where u.id = p_user_id and u.encrypted_password is not null and u.encrypted_password <> '')),
         updated_at = now()
   where s.user_id = p_user_id;
end $$;

-- Every identity gets a row, including the ones GoTrue never gave an auth.identities row to.
insert into public.account_security_state (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

do $$
declare r record;
begin
  for r in select user_id from public.account_security_state loop
    perform internal.refresh_account_security_state(r.user_id);
  end loop;
end $$;

-- A new identity starts with a row, so nothing has to remember to create one.
create or replace function internal.account_security_state_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_security_state (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists account_security_state_bootstrap on auth.users;
create trigger account_security_state_bootstrap
  after insert on auth.users
  for each row execute function internal.account_security_state_for_new_user();

-- ---------------------------------------------------------------------------------------------------
-- Perimeter. A person may read their OWN posture (F, AAL1 allowed operation 3), and nothing else.
-- Nobody writes it from a browser: every write is a definer function.
-- ---------------------------------------------------------------------------------------------------
alter table public.account_security_state enable row level security;

drop policy if exists account_security_state_select_self on public.account_security_state;
create policy account_security_state_select_self on public.account_security_state
  for select to authenticated
  using (user_id = (select auth.uid()) or internal.has_site_capability('site.users.view'));

revoke all on public.account_security_state from anon, authenticated;
grant select on public.account_security_state to authenticated;

do $$
begin
  if (select count(*) from public.account_security_state) <> (select count(*) from auth.users) then
    raise exception 'Slice 6: an identity has no security state row.';
  end if;
  raise notice 'Slice 6: % identities have a security posture row', (select count(*) from public.account_security_state);
end $$;
