-- Identity foundation: every authentication identity has exactly one profile.
--
-- Identity/Auth Slice 1 (Phase 2 design, sections C and Y.1). A profile is the
-- application identity of a person. It is never, by itself, club membership,
-- team membership, a player or parent relationship, or any authority.
--
--   1. account_state      canonical account security state, owned by Site
--                         Admin administration; account_status is kept in step
--                         as a compatibility column until legacy retirement.
--   2. email authority    profiles.email always equals the authentication
--                         identity's email; nothing else can set it.
--   3. lifecycle          creating an auth user creates its profile in the same
--                         transaction, holding a place (setup_state
--                         PENDING_DETAILS) until the person supplies their
--                         details. The first profile insert for that identity
--                         completes the held place instead of failing.
--   4. backfill           identities without a profile receive one from auth
--                         facts only: email, and nothing that implies a
--                         relationship or authority.
--   5. is_account_active  a missing profile, or no identity at all, is never
--                         active.

-- ---------------------------------------------------------------------
-- 1. Account state and setup state
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists account_state text not null default 'ACTIVE',
  add column if not exists setup_state text not null default 'COMPLETE',
  add column if not exists created_source text not null default 'LEGACY',
  add column if not exists state_changed_at timestamptz,
  add column if not exists state_changed_by uuid references auth.users(id) on delete set null,
  add column if not exists state_reason text;

update public.profiles set account_state = 'SUSPENDED' where account_status = 'suspended' and account_state <> 'SUSPENDED';

alter table public.profiles
  add constraint profiles_account_state_check
    check (account_state in ('PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'DISABLED')) not valid,
  add constraint profiles_setup_state_check
    check (setup_state in ('PENDING_DETAILS', 'COMPLETE')) not valid,
  add constraint profiles_created_source_check
    check (created_source in ('LEGACY', 'SELF_SIGNUP', 'INVITATION', 'SITE_ADMIN_CREATE', 'CLAIM', 'SOCIAL', 'SYSTEM')) not valid;
alter table public.profiles validate constraint profiles_account_state_check;
alter table public.profiles validate constraint profiles_setup_state_check;
alter table public.profiles validate constraint profiles_created_source_check;

comment on column public.profiles.account_state is
  'Canonical account security state. Changed only by Site Admin administration (set_account_status) or system jobs; no browser role holds a privilege on it. account_status mirrors it for compatibility.';
comment on column public.profiles.setup_state is
  'PENDING_DETAILS while the identity exists but the person has not yet supplied their details; COMPLETE afterwards. Not an authority signal.';
comment on column public.profiles.created_source is
  'How the identity came to exist. Informational provenance only.';

-- ---------------------------------------------------------------------
-- 2. Keep account_status and account_state in step; enforce email authority
-- ---------------------------------------------------------------------

create or replace function internal.profile_identity_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  -- Email is the authentication identity's, always.
  select u.email into v_email from auth.users u where u.id = new.id;
  new.email := v_email;

  if tg_op = 'INSERT' then
    if new.account_status = 'suspended' and new.account_state = 'ACTIVE' then
      new.account_state := 'SUSPENDED';
    end if;
    new.account_status := case when new.account_state in ('SUSPENDED', 'DISABLED') then 'suspended' else 'active' end;
    return new;
  end if;

  if new.account_state is distinct from old.account_state then
    new.account_status := case when new.account_state in ('SUSPENDED', 'DISABLED') then 'suspended' else 'active' end;
    new.state_changed_at := now();
  elsif new.account_status is distinct from old.account_status then
    new.account_state := case
      when new.account_status = 'suspended' and old.account_state = 'DISABLED' then 'DISABLED'
      when new.account_status = 'suspended' then 'SUSPENDED'
      else 'ACTIVE'
    end;
    new.state_changed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function internal.profile_identity_facts() from public, anon, authenticated;

drop trigger if exists profile_identity_facts on public.profiles;
create trigger profile_identity_facts
  before insert or update on public.profiles
  for each row execute function internal.profile_identity_facts();

create or replace function internal.sync_profile_email_from_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p set email = new.email
  where p.id = new.id and p.email is distinct from new.email;
  return null;
end;
$$;

revoke all on function internal.sync_profile_email_from_identity() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Lifecycle: a profile for every new identity, completed by the first
--    profile insert
-- ---------------------------------------------------------------------

create or replace function internal.create_profile_for_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, surname, email, account_state, setup_state, created_source)
  values (
    new.id, '', '', new.email, 'ACTIVE', 'PENDING_DETAILS',
    case
      when coalesce(new.raw_app_meta_data ->> 'provider', 'email') in ('google', 'apple', 'facebook') then 'SOCIAL'
      when new.invited_at is not null then 'INVITATION'
      else 'SELF_SIGNUP'
    end
  )
  on conflict (id) do nothing;
  return null;
end;
$$;

revoke all on function internal.create_profile_for_identity() from public, anon, authenticated;

drop trigger if exists create_profile_for_identity on auth.users;
create trigger create_profile_for_identity
  after insert on auth.users
  for each row execute function internal.create_profile_for_identity();

drop trigger if exists sync_profile_email_from_identity on auth.users;
create trigger sync_profile_email_from_identity
  after update of email on auth.users
  for each row execute function internal.sync_profile_email_from_identity();

-- The existing sign-up and invitation code inserts the profile once the
-- person has given their details. When the identity already holds a
-- PENDING_DETAILS place, that insert completes the place instead of failing
-- on the primary key. A browser session may complete only its own profile;
-- the insert column grants still limit what it can supply.
create or replace function internal.complete_pending_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('role', true), ''), 'none');
begin
  if not exists (select 1 from public.profiles p where p.id = new.id and p.setup_state = 'PENDING_DETAILS') then
    return new;
  end if;

  if v_role in ('anon', 'authenticated') and new.id is distinct from auth.uid() then
    raise exception 'You can only complete your own profile.' using errcode = '42501';
  end if;

  update public.profiles p set
    first_name = new.first_name,
    surname = new.surname,
    date_of_birth = coalesce(new.date_of_birth, p.date_of_birth),
    address_line_1 = new.address_line_1,
    address_line_2 = new.address_line_2,
    address_line_3 = new.address_line_3,
    town = new.town,
    county = new.county,
    country = new.country,
    postcode = new.postcode,
    phone_number = coalesce(new.phone_number, p.phone_number),
    avatar_storage_path = coalesce(new.avatar_storage_path, p.avatar_storage_path),
    -- Account state is never supplied by a browser session (no column grant);
    -- a trusted backend writer's explicit state is honoured.
    account_state = case
      when v_role in ('anon', 'authenticated') then p.account_state
      when new.account_status = 'suspended' and new.account_state = 'ACTIVE' then 'SUSPENDED'
      else new.account_state
    end,
    setup_state = 'COMPLETE'
  where p.id = new.id;
  return null;
end;
$$;

revoke all on function internal.complete_pending_profile() from public, anon, authenticated;

drop trigger if exists a_complete_pending_profile on public.profiles;
-- Named to sort before profile_identity_facts and profiles_normalise_names:
-- a completed place skips the insert entirely.
create trigger a_complete_pending_profile
  before insert on public.profiles
  for each row execute function internal.complete_pending_profile();

-- ---------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------

update public.profiles p set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

-- One definition of the backfill, used here and by the permanent test. It
-- gives an identity without a profile only what the authentication record
-- justifies: a PENDING_DETAILS profile carrying its email. No membership,
-- relationship, role or authority is created or implied.
create or replace function internal.ensure_profiles_for_identities()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  insert into public.profiles (id, first_name, surname, email, account_state, setup_state, created_source)
  select u.id, '', '', u.email, 'ACTIVE', 'PENDING_DETAILS', 'LEGACY'
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict (id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function internal.ensure_profiles_for_identities() from public, anon, authenticated;

select internal.ensure_profiles_for_identities();

do $$
declare v_missing integer; v_mismatch integer; v_dupes integer;
begin
  select count(*) into v_missing from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
  select count(*) into v_mismatch from public.profiles p join auth.users u on u.id = p.id where p.email is distinct from u.email;
  select count(*) into v_dupes from (
    select lower(email) from public.profiles where email is not null group by 1 having count(*) > 1
  ) d;
  if v_missing <> 0 or v_mismatch <> 0 or v_dupes <> 0 then
    raise exception 'Identity backfill incomplete: % identities without a profile, % email mismatches, % duplicate emails', v_missing, v_mismatch, v_dupes;
  end if;
end $$;

create unique index if not exists profiles_email_unique on public.profiles (lower(email)) where email is not null;

-- ---------------------------------------------------------------------
-- 5. Active means a known, ACTIVE identity
-- ---------------------------------------------------------------------

create or replace function internal.is_account_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
     and exists (select 1 from public.profiles where id = p_user_id and account_state = 'ACTIVE');
$$;

comment on function internal.is_account_active(uuid) is
  'True only for an identity whose profile is ACTIVE. A missing profile or a null identity is never active: every auth identity has a profile (create_profile_for_identity), so a missing one is an inconsistency, not a pending state.';

create or replace function public.set_account_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid())
     or coalesce(internal.site_admin_role(auth.uid()), '') not in ('full', 'user_access') then
    raise exception 'Only a Full or User Access Site Admin may change an account''s status.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change the status of your own account.' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Account status must be active or suspended.';
  end if;

  update public.profiles
  set account_state = case p_status when 'suspended' then 'SUSPENDED' else 'ACTIVE' end,
      state_changed_by = auth.uid()
  where id = p_user_id;
  if not found then
    raise exception 'That account does not exist.';
  end if;
end;
$$;

revoke all on function public.set_account_status(uuid, text) from public, anon;
grant execute on function public.set_account_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Registered users are completed signups
--
-- The Site Admin dashboard has always defined a registered user as a person
-- who completed signup, not an authentication identity. Profile-less
-- identities used to be excluded by having no profile; every identity now has
-- one, so the definition is stated directly.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.site_admin_dashboard_platform()
 RETURNS TABLE(registered_users integer, suspended_users integer, registered_clubs integer, active_clubs integer, registered_teams integer, active_teams integer, registered_parents integer, registered_players integer, active_players integer, directory_clubs integer, generated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  return query
  select
    -- A completed person account. profiles is written by
    -- completeSignupIfNeeded, so this excludes half-finished signups --
    -- which auth.users would have counted.
    (select count(*)::int from public.profiles p where p.setup_state = 'COMPLETE'),
    (select count(*)::int from public.profiles p where p.setup_state = 'COMPLETE' and p.account_state in ('SUSPENDED', 'DISABLED')),

    -- A clubs row exists only once approve_club_claim has run, so every
    -- row here is an activated club. club_directory is NOT this.
    (select count(*)::int from public.clubs),
    (select count(*)::int from public.clubs c where c.status = 'active'),

    (select count(*)::int from public.teams),
    (select count(*)::int from public.teams t
      where t.active = true and t.folded_at is null and t.archived_at is null),

    -- DISTINCT PEOPLE. public.guardians is one row per
    -- (guardian_user_id, player_id) pair, so count(*) would report a parent
    -- of three children as three parents.
    (select count(distinct g.guardian_user_id)::int from public.guardians g
      where g.status = 'active'),

    -- Players are sporting identities, not accounts: players.user_id is
    -- nullable. Never added to registered_users.
    (select count(*)::int from public.players),
    (select count(*)::int from public.players pl where pl.active = true),

    -- Addressable market. Named so it cannot be mistaken for a club count.
    (select count(*)::int from public.club_directory d where d.active = true),

    now();
end;
$$;
