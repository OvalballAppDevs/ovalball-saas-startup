-- =====================================================================
-- WHICH CLUB ROLES ARE THE ONE-AT-A-TIME SEAT — written down once.
--
-- A club membership carries a "primary club role": Member, Fixture Secretary
-- or Club Admin. Exactly one at a time -- giving one takes the other two away.
-- Every other canonical role is ADDITIVE: a person can be a Volunteer and a
-- Coach and a Team Manager at once, and Slice 8 makes that reachable from the
-- club's own screen for the first time.
--
-- That distinction was written down in exactly one place, as a list of three
-- strings inside internal.apply_primary_club_role:
--
--     role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')
--
-- which is fine while only that function needs to know. Slice 8's People &
-- Access screen needs to know too -- it shows the seat in one section and
-- everything else in another -- and the obvious way to make it know is to
-- repeat the three strings in a React component. That is how a presentation
-- list becomes an authority list two slices later, and it is what
-- scripts/verify-authority-guards.mjs exists to refuse.
--
-- So the catalogue carries the fact, and both readers ask it. One definition,
-- in the table that already describes what a role IS.
-- =====================================================================

alter table public.role_definitions
  add column if not exists is_primary_seat boolean not null default false;

comment on column public.role_definitions.is_primary_seat is
  'True for the mutually exclusive club-wide seat -- Member, Fixture Secretary, Club Admin. '
  'Giving one of these takes the others away; every other role is additive. Read by '
  'internal.apply_primary_club_role and by the People & Access screen, so the rule has one home.';

update public.role_definitions
   set is_primary_seat = (role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER'));

-- The function now ASKS rather than restates. Its behaviour is unchanged: the
-- same three roles, resolved from the catalogue instead of from a literal.
create or replace function internal.apply_primary_club_role(
  p_membership_id uuid, p_role text, p_source text, p_reason text, p_allow_no_club_admin boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_membership public.club_memberships;
  v_target text;
  v_ending uuid[];
  v_row record;
begin
  select * into v_membership from public.club_memberships where id = p_membership_id;
  v_target := case p_role
    when 'CLUB_ADMIN' then 'CLUB_ADMIN'
    when 'FIXTURE_SECRETARY' then 'FIXTURES_SECRETARY'
    when 'BASIC_USER' then 'MEMBER'
  end;
  if v_target is null then
    raise exception 'Choose Member, Fixtures Secretary or Club Admin.' using errcode = '22023';
  end if;
  if v_membership.state <> 'ACTIVE' then
    raise exception 'Only an active member''s club role can be changed.' using errcode = '23514';
  end if;

  select coalesce(array_agg(ra.id), '{}'::uuid[]) into v_ending
  from public.role_assignments ra
  join public.role_definitions rd on rd.role_key = ra.role_key
  where ra.membership_id = p_membership_id and ra.team_id is null
    and rd.is_primary_seat and ra.role_key <> v_target and ra.state <> 'REVOKED';
  perform internal.assert_club_keeps_an_admin(v_membership.club_id, v_ending, p_allow_no_club_admin, p_reason);

  perform internal.grant_role(p_membership_id, v_target, null, p_source, p_reason);

  for v_row in
    select ra.id from public.role_assignments ra
    join public.role_definitions rd on rd.role_key = ra.role_key
    where ra.membership_id = p_membership_id and ra.team_id is null
      and rd.is_primary_seat and ra.role_key <> v_target and ra.state <> 'REVOKED'
  loop
    perform internal.end_role(v_row.id, 'REVOKED', coalesce(p_reason, 'Club role changed'), null);
  end loop;
end;
$function$;

do $guard$
declare
  v_seat text;
  v_def text;
begin
  select string_agg(role_key, ',' order by role_key) into v_seat
    from public.role_definitions where is_primary_seat;
  if v_seat is distinct from 'CLUB_ADMIN,FIXTURES_SECRETARY,MEMBER' then
    raise exception 'The primary seat is now %, which is not the three mutually exclusive club roles.', coalesce(v_seat, '(none)');
  end if;

  -- Volunteer is the reason this distinction matters: it is a club role that a
  -- person holds ALONGSIDE their seat, and treating it as a seat would mean
  -- giving it silently took somebody's Club Admin away.
  if (select is_primary_seat from public.role_definitions where role_key = 'VOLUNTEER') then
    raise exception 'Volunteer is marked as a primary seat. It is additive -- giving it must not remove anything.';
  end if;

  -- And the function must be reading the catalogue rather than the old list.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'apply_primary_club_role';
  if v_def like '%''CLUB_ADMIN'', ''FIXTURES_SECRETARY'', ''MEMBER''%' then
    raise exception 'apply_primary_club_role still carries its own copy of the seat list.';
  end if;
  if v_def not like '%is_primary_seat%' then
    raise exception 'apply_primary_club_role does not read the catalogue.';
  end if;
end;
$guard$;
