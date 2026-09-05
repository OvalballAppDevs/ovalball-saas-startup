-- Side Project 1 integration (SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05),
-- Phase 2 step 2: Parent/Guardian/Player Safeguarding + Attendance + Team
-- Community foundation, and the self-service Add-a-Child / pending-
-- membership-approval / optional-Player-login extension.
--
-- This is a Main-authored integration migration, not a verbatim replay of
-- Side Project 1's fork history: it represents the FINAL correct state of
-- every object in this domain (the side project's own later same-domain
-- migrations already superseded several earlier versions of the same
-- function -- only the final version of each is included here), and its
-- two role-bundle functions (has_club_role_capability/has_team_role_
-- capability) are re-derived from MAIN'S OWN CURRENT definitions (which
-- already include manage_mini_rugby_groups/manage_fixture_callups/
-- approve_fixture_callups/manage_player_dispensations/approve_player_
-- dispensations/place_graduating_players from Main's independent
-- post-fork work) rather than overwritten with Side Project 1's older
-- fork-point copy of those two functions, which would have silently
-- regressed Main's own subsequent capability model.
--
-- player_team_memberships.status was already widened to include
-- 'pending' in 20260928000000/20260928100000 (Phase 2 step 1); this
-- migration does not repeat that.

-- =====================================================================
-- PART A: CAPABILITIES
-- =====================================================================
insert into public.capabilities (key, label, description, category, applicable_scopes) values
  ('team.guardians.invite', 'Invite Parent/Guardian', 'Invite a Parent/Guardian to a specific team.', 'people', array['club','team']),
  ('club.guardians.manage', 'Manage Guardian relationships', 'Remove or replace a Guardian relationship. High safeguarding sensitivity -- Club Admin only, never Team staff.', 'people', array['club']),
  ('team.community.manage', 'Manage Team Community', 'Enable or disable the Team Community conversation for a team.', 'messaging', array['club','team']),
  ('team.attendance.view', 'View Team Attendance', 'View the fixture attendance summary and per-player responses for a team.', 'team', array['club','team'])
on conflict (key) do nothing;

-- Re-derived from Main's CURRENT live definition (confirmed via
-- pg_get_functiondef immediately before writing this migration) plus the
-- four new keys above, slotted into the same tiers Side Project 1
-- specified: team.guardians.invite / team.attendance.view / team.
-- community.manage granted to Club Admin and Team Admin/Coach/Manager;
-- club.guardians.manage Club-Admin-only (Team staff must never gain
-- authority to break a Guardian relationship).
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players',
      'team.guardians.invite', 'club.guardians.manage', 'team.community.manage', 'team.attendance.view'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$function$;

create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when not internal.is_club_active(p_club_id) then false
    when internal.is_club_admin(p_club_id) then p_capability_key in (
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'team.roster.manage',
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send',
      'manage_fixture_callups', 'approve_fixture_callups', 'place_graduating_players',
      'manage_player_dispensations', 'approve_player_dispensations',
      'team.guardians.invite', 'team.community.manage', 'team.attendance.view'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
        and tp.permission in ('team_admin', 'coach', 'manager')
    ) then p_capability_key in (
      -- Deliberately NOT club.teams.manage / club.team_lifecycle.manage /
      -- club.roster.manage / team.roster.manage / club.guardians.manage --
      -- preserves the standing "no new Team Admin write capability
      -- granted" decision and the explicit "Team staff cannot remove a
      -- Guardian" rule.
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send',
      'manage_fixture_callups', 'approve_fixture_callups', 'place_graduating_players',
      'manage_player_dispensations', 'approve_player_dispensations',
      'team.guardians.invite', 'team.community.manage', 'team.attendance.view'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('team.view', 'fixture.view', 'calendar.view')
    else false
  end;
$function$;

-- =====================================================================
-- PART B: GUARDIAN INVITATIONS
-- =====================================================================
create table public.guardian_invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  team_id uuid not null references public.teams(id),
  invited_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  invited_by_user_id uuid not null references auth.users(id),
  -- Set only when a Club Admin sends this invitation specifically to
  -- replace an orphaned player's last Guardian -- the acceptance flow
  -- links the accepting user to THIS existing player rather than showing
  -- the ordinary "add a new child" form. Null for every ordinary team
  -- invitation.
  replacement_for_player_id uuid references public.players(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guardian_invitations_club_id_idx on public.guardian_invitations(club_id);
create index guardian_invitations_team_id_idx on public.guardian_invitations(team_id);
create index guardian_invitations_invited_email_idx on public.guardian_invitations(lower(invited_email));
create index guardian_invitations_status_idx on public.guardian_invitations(status);

create or replace function internal.enforce_guardian_invitation_team_club_match()
returns trigger
language plpgsql
as $function$
begin
  if not exists (select 1 from public.teams where id = new.team_id and club_id = new.club_id) then
    raise exception 'team_id does not belong to club_id.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger enforce_guardian_invitation_team_club_match
  before insert or update on public.guardian_invitations
  for each row execute function internal.enforce_guardian_invitation_team_club_match();

create trigger set_updated_at before update on public.guardian_invitations
  for each row execute function set_updated_at();

create trigger audit_row_change after insert or delete or update on public.guardian_invitations
  for each row execute function internal.audit_row_change();

alter table public.guardian_invitations enable row level security;

create policy guardian_invitations_insert_scoped on public.guardian_invitations
  for insert with check (internal.has_capability('team.guardians.invite', 'team', club_id, team_id) or internal.has_capability('team.guardians.invite', 'club', club_id, null));

create policy guardian_invitations_select_scoped on public.guardian_invitations
  for select using (
    internal.is_site_admin()
    or internal.has_capability('team.guardians.invite', 'team', club_id, team_id)
    or internal.has_capability('team.guardians.invite', 'club', club_id, null)
    or invited_by_user_id = auth.uid()
  );

create policy guardian_invitations_update_scoped on public.guardian_invitations
  for update using (
    internal.is_site_admin()
    or internal.has_capability('team.guardians.invite', 'team', club_id, team_id)
    or internal.has_capability('team.guardians.invite', 'club', club_id, null)
  );

comment on table public.guardian_invitations is 'Team-scoped Guardian invitation record. Acceptance links the accepting user to a scoped Guardian onboarding context (Player creation) -- it does NOT create a club_membership/team_permission and does NOT auto-create a Player.';
comment on column public.guardian_invitations.replacement_for_player_id is 'Set only when a Club Admin sends this invitation specifically to replace an orphaned player''s last Guardian -- the acceptance flow links the accepting user to THIS existing player (link_guardian_to_existing_player) rather than showing the ordinary "add a new child" form. Null for every ordinary team invitation.';

create or replace function public.accept_guardian_invitation(p_token text)
returns table (invitation_id uuid, club_id uuid, team_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inv public.guardian_invitations;
  v_email text;
begin
  select * into inv from public.guardian_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invitation is no longer available.';
  end if;
  if inv.expires_at < now() then
    update public.guardian_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired.';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null or lower(v_email) <> lower(inv.invited_email) then
    raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
  end if;

  update public.guardian_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = inv.id;

  return query select inv.id, inv.club_id, inv.team_id;
end;
$function$;

create or replace function public.get_guardian_invitation_preview(p_token text)
returns table (
  invitation_id uuid,
  club_name text,
  team_display_name text,
  team_alias text,
  status text,
  expires_at timestamptz,
  invited_email text,
  accepted_by uuid,
  replacement_for_player_id uuid,
  replacement_for_player_first_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    gi.id, cd.name, t.display_name, ta.alias, gi.status, gi.expires_at, gi.invited_email, gi.accepted_by,
    gi.replacement_for_player_id, p.first_name
  from public.guardian_invitations gi
  join public.teams t on t.id = gi.team_id
  join public.clubs c on c.id = gi.club_id
  join public.club_directory cd on cd.id = c.directory_id
  left join public.team_aliases ta on ta.team_id = t.id
  left join public.players p on p.id = gi.replacement_for_player_id
  where gi.token = p_token;
$$;

revoke execute on function public.get_guardian_invitation_preview(text) from public;
grant execute on function public.get_guardian_invitation_preview(text) to anon, authenticated;

-- =====================================================================
-- PART C: DUPLICATE-SAFE PLAYER CREATION (final shape: supports both the
-- invitation-driven path and the self-service Add-a-Child path on the
-- SAME table, never a parallel review table)
-- =====================================================================
create table public.player_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  guardian_invitation_id uuid references public.guardian_invitations(id),
  team_id uuid not null references public.teams(id),
  submitted_first_name text not null,
  submitted_surname text not null,
  submitted_date_of_birth date,
  matched_player_id uuid not null references public.players(id),
  status text not null default 'pending' check (status in ('pending', 'linked_existing', 'created_new', 'dismissed')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  submitted_by uuid not null references auth.users(id),
  -- Populated directly for a self-service Add-a-Child submission where
  -- there is no guardian_invitations row to derive the submitter from.
  -- Null for the original invitation-driven path, which still derives the
  -- submitter via guardian_invitation_id.accepted_by.
  requesting_guardian_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint player_duplicate_reviews_source_check check ((guardian_invitation_id is not null) or (requesting_guardian_user_id is not null))
);

create index player_duplicate_reviews_team_id_idx on public.player_duplicate_reviews(team_id) where status = 'pending';

alter table public.player_duplicate_reviews enable row level security;

create policy player_duplicate_reviews_select_scoped on public.player_duplicate_reviews
  for select using (
    internal.is_site_admin()
    or internal.has_capability('team.guardians.invite', 'team', (select club_id from public.teams where id = team_id), team_id)
    or internal.has_capability('team.guardians.invite', 'club', (select club_id from public.teams where id = team_id), null)
  );

-- The requesting guardian may see their OWN pending request exists
-- (privacy-safe status only -- never candidate Player data, enforced by
-- what the RPC layer returns, not by this row-visibility policy) without
-- gaining the staff-only visibility into other clubs' reviews.
create policy player_duplicate_reviews_select_own_request on public.player_duplicate_reviews
  for select using (requesting_guardian_user_id = auth.uid());

create policy player_duplicate_reviews_update_scoped on public.player_duplicate_reviews
  for update using (
    internal.is_site_admin()
    or internal.has_capability('team.guardians.invite', 'team', (select club_id from public.teams where id = team_id), team_id)
    or internal.has_capability('team.guardians.invite', 'club', (select club_id from public.teams where id = team_id), null)
  );

create trigger audit_row_change after insert or delete or update on public.player_duplicate_reviews
  for each row execute function internal.audit_row_change();

comment on table public.player_duplicate_reviews is 'A possible-duplicate flag raised instead of silently creating a second Player row. Never exposed to the submitting Parent -- staff-only review workflow, resolved by linking the existing Player or confirming a genuinely new one.';
comment on column public.player_duplicate_reviews.requesting_guardian_user_id is 'Populated directly for a self-service Add-a-Child submission where there is no guardian_invitations row to derive the submitter from. Null for the original invitation-driven path, which still derives the submitter via guardian_invitation_id.accepted_by.';

create or replace function public.create_player_for_guardian(
  p_guardian_invitation_id uuid,
  p_first_name text,
  p_surname text,
  p_date_of_birth date
)
returns table (result text, player_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inv public.guardian_invitations;
  v_match_player_id uuid;
  v_player_id uuid;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid() then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_surname), '') = '' then
    raise exception 'First name and surname are required.';
  end if;

  select ptm.player_id into v_match_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = inv.team_id
    and ptm.status = 'active'
    and lower(p.first_name) = lower(trim(p_first_name))
    and lower(p.surname) = lower(trim(p_surname))
    and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;

  if v_match_player_id is not null then
    insert into public.player_duplicate_reviews (guardian_invitation_id, team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by)
    values (inv.id, inv.team_id, trim(p_first_name), trim(p_surname), p_date_of_birth, v_match_player_id, auth.uid());
    return query select 'under_review'::text, null::uuid;
    return;
  end if;

  insert into public.players (first_name, surname, date_of_birth, created_by)
  values (trim(p_first_name), trim(p_surname), p_date_of_birth, auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), v_player_id, 'guardian', auth.uid());

  insert into public.player_team_memberships (player_id, team_id, created_by)
  values (v_player_id, inv.team_id, auth.uid());

  return query select 'created'::text, v_player_id;
end;
$function$;

-- Final version (supersedes the fork-history's own first draft): derives
-- the submitter from EITHER source the review actually has, so the same
-- pair of resolve RPCs serves both the invitation-driven and self-service
-- paths.
create or replace function public.resolve_player_duplicate_review_as_existing(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.player_duplicate_reviews;
  v_club_id uuid;
  v_submitter uuid;
begin
  select * into r from public.player_duplicate_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found.';
  end if;
  if r.status <> 'pending' then
    raise exception 'This review has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = r.team_id;
  if v_club_id is null or not (internal.has_capability('team.guardians.invite', 'team', v_club_id, r.team_id) or internal.has_capability('team.guardians.invite', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to resolve this review.' using errcode = '42501';
  end if;

  v_submitter := r.requesting_guardian_user_id;
  if v_submitter is null and r.guardian_invitation_id is not null then
    select accepted_by into v_submitter from public.guardian_invitations where id = r.guardian_invitation_id;
  end if;
  if v_submitter is null then
    raise exception 'The original applicant for this review could not be found.';
  end if;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (v_submitter, r.matched_player_id, 'guardian', auth.uid())
  on conflict (guardian_user_id, player_id) where status = 'active' do nothing;

  insert into public.player_team_memberships (player_id, team_id, created_by)
  select r.matched_player_id, r.team_id, auth.uid()
  where not exists (
    select 1 from public.player_team_memberships where player_id = r.matched_player_id and team_id = r.team_id and status = 'active'
  );

  update public.player_duplicate_reviews set status = 'linked_existing', resolved_by = auth.uid(), resolved_at = now() where id = p_review_id;
end;
$function$;

create or replace function public.resolve_player_duplicate_review_as_new(p_review_id uuid)
returns table(player_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.player_duplicate_reviews;
  v_club_id uuid;
  v_submitter uuid;
  v_player_id uuid;
begin
  select * into r from public.player_duplicate_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found.';
  end if;
  if r.status <> 'pending' then
    raise exception 'This review has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = r.team_id;
  if v_club_id is null or not (internal.has_capability('team.guardians.invite', 'team', v_club_id, r.team_id) or internal.has_capability('team.guardians.invite', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to resolve this review.' using errcode = '42501';
  end if;

  v_submitter := r.requesting_guardian_user_id;
  if v_submitter is null and r.guardian_invitation_id is not null then
    select accepted_by into v_submitter from public.guardian_invitations where id = r.guardian_invitation_id;
  end if;
  if v_submitter is null then
    raise exception 'The original applicant for this review could not be found.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, created_by)
  values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (v_submitter, v_player_id, 'guardian', auth.uid());

  insert into public.player_team_memberships (player_id, team_id, created_by)
  values (v_player_id, r.team_id, auth.uid());

  update public.player_duplicate_reviews set status = 'created_new', resolved_by = auth.uid(), resolved_at = now() where id = p_review_id;

  return query select v_player_id;
end;
$function$;

-- Defense-in-depth: staff-only, never anon (both checks internally deny
-- an unauthenticated caller anyway, but never rely on that alone).
revoke all on function public.resolve_player_duplicate_review_as_existing(uuid) from public, anon;
revoke all on function public.resolve_player_duplicate_review_as_new(uuid) from public, anon;
grant execute on function public.resolve_player_duplicate_review_as_existing(uuid) to authenticated;
grant execute on function public.resolve_player_duplicate_review_as_new(uuid) to authenticated;

-- Club Admin ONLY (club.guardians.manage) -- sending a replacement
-- invitation for an orphaned player's last Guardian.
create or replace function public.send_replacement_guardian_invitation(p_player_id uuid, p_team_id uuid, p_invited_email text)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_row public.guardian_invitations;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;
  if not internal.has_capability('club.guardians.manage', 'club', v_club_id, null) then
    raise exception 'You are not authorized to manage Guardian relationships for this player.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships where player_id = p_player_id and team_id = p_team_id and status = 'active') then
    raise exception 'That player is not on this team.' using errcode = '42501';
  end if;

  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id, replacement_for_player_id)
  values (v_club_id, p_team_id, lower(trim(p_invited_email)), auth.uid(), p_player_id)
  returning * into v_row;

  return query select v_row.id, v_row.token;
end;
$function$;

revoke all on function public.send_replacement_guardian_invitation(uuid, uuid, text) from public, anon;
grant execute on function public.send_replacement_guardian_invitation(uuid, uuid, text) to authenticated;

-- =====================================================================
-- PART D: GUARDIAN CONSENT MODEL
-- =====================================================================
create table public.player_permission_types (
  key text primary key,
  label text not null,
  description text not null,
  min_age int,
  max_age int,
  sort_order int not null
);

insert into public.player_permission_types (key, label, description, min_age, max_age, sort_order) values
  ('view_fixtures', 'View Fixtures', 'See upcoming fixtures for this team.', null, null, 1),
  ('view_results', 'View Results', 'See match results, subject to governing-body eligibility rules.', null, null, 2),
  ('view_calendar', 'View Calendar', 'See the team calendar.', null, null, 3),
  ('view_team_conversation', 'View Team Conversation', 'Read the Team Community conversation for this team.', null, null, 4),
  ('send_team_messages', 'Send Team Messages', 'Send messages in the Team Community conversation for this team.', null, null, 5),
  ('direct_coach_communication', 'Direct Communication with Coach', 'Message an authorized coach for this team directly. Available from age 16.', 16, 17, 6),
  ('approve_own_attendance', 'Approve Own Attendance', 'Set your own fixture attendance response. Available from age 16.', 16, 17, 7)
on conflict (key) do nothing;

alter table public.player_permission_types enable row level security;
create policy player_permission_types_select_all on public.player_permission_types for select to anon, authenticated using (true);

create table public.guardian_player_permissions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id),
  permission_key text not null references public.player_permission_types(key),
  guardian_user_id uuid not null references auth.users(id),
  granted boolean not null,
  source text not null default 'guardian_dashboard',
  actor uuid not null references auth.users(id),
  -- clock_timestamp(), not now(): an append-only decision log where "most
  -- recent row wins" is the entire effective-state mechanism -- now() is
  -- frozen for the whole transaction, so a grant immediately followed by a
  -- revoke inside one transaction would tie and lose the revoke's effect.
  created_at timestamptz not null default clock_timestamp()
);

create index guardian_player_permissions_lookup_idx on public.guardian_player_permissions (player_id, permission_key, guardian_user_id, created_at desc);

alter table public.guardian_player_permissions enable row level security;

create policy guardian_player_permissions_select_scoped on public.guardian_player_permissions
  for select using (
    internal.is_site_admin()
    or guardian_user_id = auth.uid()
    or internal.is_active_player_guardian(player_id)
    or internal.can_manage_player(player_id)
    or internal.is_own_linked_player(player_id)
  );

create policy guardian_player_permissions_insert_scoped on public.guardian_player_permissions
  for insert with check (
    guardian_user_id = auth.uid()
    and actor = auth.uid()
    and exists (
      select 1 from public.guardians g where g.player_id = guardian_player_permissions.player_id and g.guardian_user_id = auth.uid() and g.status = 'active'
    )
  );

comment on table public.guardian_player_permissions is 'Normalized, append-only Guardian consent decisions. Effective state is computed by internal.guardian_permission_effective() -- ALL active guardians'' latest decision must be granted=true for a sensitive permission to be effectively enabled; a player with zero active guardians is effectively denied everything (fail closed).';

create or replace function internal.guardian_permission_effective(p_player_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with active_guardians as (
    select guardian_user_id from public.guardians where player_id = p_player_id and status = 'active'
  ),
  latest_decision as (
    select ag.guardian_user_id,
      (select gpp.granted from public.guardian_player_permissions gpp
       where gpp.player_id = p_player_id and gpp.permission_key = p_permission_key and gpp.guardian_user_id = ag.guardian_user_id
       order by gpp.created_at desc limit 1) as granted
    from active_guardians ag
  )
  select
    (select count(*) from active_guardians) > 0
    and not exists (select 1 from latest_decision where granted is distinct from true);
$function$;

comment on function internal.guardian_permission_effective is 'Deny-by-default consent aggregation. A player with no active guardian, or where any active guardian has not affirmatively granted (including a guardian who has never decided), resolves to false. Any single active guardian''s revocation immediately flips this to false for every consumer.';

create or replace function public.set_guardian_player_permission(p_player_id uuid, p_permission_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.guardians where player_id = p_player_id and guardian_user_id = auth.uid() and status = 'active') then
    raise exception 'You are not an active guardian of this player.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_permission_types where key = p_permission_key) then
    raise exception 'Unknown permission.';
  end if;
  insert into public.guardian_player_permissions (player_id, permission_key, guardian_user_id, granted, actor)
  values (p_player_id, p_permission_key, auth.uid(), p_granted, auth.uid());
end;
$function$;

create or replace function public.get_player_permission_summary(p_player_id uuid)
returns table (
  permission_key text, label text, description text, min_age int, max_age int,
  effective boolean, my_decision boolean, co_guardians_pending boolean
)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
begin
  if not (
    internal.is_site_admin()
    or internal.is_active_player_guardian(p_player_id)
    or internal.is_own_linked_player(p_player_id)
  ) then
    raise exception 'You are not authorized to view this player''s access settings.' using errcode = '42501';
  end if;

  return query
  select
    pt.key, pt.label, pt.description, pt.min_age, pt.max_age,
    internal.guardian_permission_effective(p_player_id, pt.key),
    (
      select gpp.granted from public.guardian_player_permissions gpp
      where gpp.player_id = p_player_id and gpp.permission_key = pt.key and gpp.guardian_user_id = auth.uid()
      order by gpp.created_at desc limit 1
    ),
    exists (
      select 1 from public.guardians g
      where g.player_id = p_player_id and g.status = 'active' and g.guardian_user_id <> auth.uid()
        and coalesce((
          select gpp2.granted from public.guardian_player_permissions gpp2
          where gpp2.player_id = p_player_id and gpp2.permission_key = pt.key and gpp2.guardian_user_id = g.guardian_user_id
          order by gpp2.created_at desc limit 1
        ), false) is not true
    )
  from public.player_permission_types pt
  order by pt.sort_order;
end;
$function$;

revoke all on function public.get_player_permission_summary(uuid) from public, anon;
grant execute on function public.get_player_permission_summary(uuid) to authenticated;

-- =====================================================================
-- PART E: AGE HELPER (SQL-side DOB arithmetic only -- NOT a substitute
-- for the sporting age-grade resolver in Part I below, and never trusted
-- as the sole safeguarding check on its own beyond what's used for below).
-- =====================================================================
create or replace function internal.player_effective_age(p_player_id uuid, p_as_of date default current_date)
returns int
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when p.date_of_birth is null then null
    else extract(year from age(p_as_of, p.date_of_birth))::int
  end
  from public.players p where p.id = p_player_id;
$function$;

-- =====================================================================
-- PART F: FIXTURE ATTENDANCE
-- =====================================================================
create table public.player_fixture_attendance (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id),
  player_id uuid not null references public.players(id),
  status text not null check (status in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE')),
  responded_by_user_id uuid not null references auth.users(id),
  response_source text not null check (response_source in ('guardian', 'player', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_fixture_attendance_unique unique (fixture_id, player_id)
);

create index player_fixture_attendance_fixture_id_idx on public.player_fixture_attendance(fixture_id);
create index player_fixture_attendance_player_id_idx on public.player_fixture_attendance(player_id);

create trigger set_updated_at before update on public.player_fixture_attendance
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or delete or update on public.player_fixture_attendance
  for each row execute function internal.audit_row_change();

alter table public.player_fixture_attendance enable row level security;

create policy player_fixture_attendance_select_scoped on public.player_fixture_attendance
  for select using (
    internal.is_site_admin()
    or internal.is_active_player_guardian(player_id)
    or internal.is_own_linked_player(player_id)
    or exists (
      select 1 from public.fixtures f
      where f.id = fixture_id
        and (
          internal.has_capability('team.attendance.view', 'team', (select club_id from public.teams where id = f.home_team_id), f.home_team_id)
          or internal.has_capability('team.attendance.view', 'team', (select club_id from public.teams where id = f.away_team_id), f.away_team_id)
          or internal.has_capability('team.attendance.view', 'club', (select club_id from public.teams where id = f.home_team_id), null)
          or internal.has_capability('team.attendance.view', 'club', (select club_id from public.teams where id = f.away_team_id), null)
        )
    )
  );

comment on table public.player_fixture_attendance is 'Attendance keyed to (fixture_id, player_id) -- the CURRENT effective response; audit_row_change preserves full history. Cancelling a fixture never deletes these rows. A fixture''s date/pitch/kickoff change never creates a new row -- the same fixture_id keeps the same attendance rows automatically (nothing here references date/time/pitch).';

create or replace function public.respond_to_attendance(p_fixture_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_guardian boolean;
  v_is_self boolean;
  v_age int;
  v_source text;
  v_involved boolean;
begin
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  v_is_guardian := exists (select 1 from public.guardians where player_id = p_player_id and guardian_user_id = auth.uid() and status = 'active');
  v_is_self := exists (select 1 from public.players where id = p_player_id and user_id = auth.uid());

  if v_is_guardian then
    v_source := 'guardian';
  elsif v_is_self then
    v_age := internal.player_effective_age(p_player_id);
    if v_age is null then
      raise exception 'Age could not be verified for self-service attendance.' using errcode = '42501';
    elsif v_age >= 18 then
      v_source := 'player';
    elsif v_age in (16, 17) then
      if not internal.guardian_permission_effective(p_player_id, 'approve_own_attendance') then
        raise exception 'Guardian consent for self-attendance is not currently granted.' using errcode = '42501';
      end if;
      v_source := 'player';
    else
      raise exception 'Players under 16 cannot respond to their own attendance.' using errcode = '42501';
    end if;
  else
    raise exception 'You are not authorized to respond to attendance for this player.' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.fixtures f
    join public.player_team_memberships ptm on ptm.player_id = p_player_id and ptm.status = 'active'
    where f.id = p_fixture_id and ptm.team_id in (f.home_team_id, f.away_team_id)
  ) into v_involved;
  if not v_involved then
    raise exception 'This player is not associated with a team involved in this fixture.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (p_fixture_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (fixture_id, player_id) do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();
end;
$function$;

-- =====================================================================
-- PART G: TEAM COMMUNITY
-- =====================================================================
create table public.team_conversations (
  team_id uuid primary key references public.teams(id),
  active boolean not null default false,
  enabled_by uuid references auth.users(id),
  enabled_at timestamptz,
  disabled_by uuid references auth.users(id),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.team_conversations
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or delete or update on public.team_conversations
  for each row execute function internal.audit_row_change();

alter table public.team_conversations enable row level security;

create policy team_conversations_select_scoped on public.team_conversations
  for select using (
    internal.is_site_admin()
    or internal.can_manage_team(team_id)
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = team_id))
    or exists (select 1 from public.player_team_memberships ptm where ptm.team_id = team_conversations.team_id and ptm.status = 'active' and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id)))
  );

create policy team_conversations_write_scoped on public.team_conversations
  for all using (
    internal.has_capability('team.community.manage', 'team', (select club_id from public.teams where id = team_id), team_id)
    or internal.has_capability('team.community.manage', 'club', (select club_id from public.teams where id = team_id), null)
  ) with check (
    internal.has_capability('team.community.manage', 'team', (select club_id from public.teams where id = team_id), team_id)
    or internal.has_capability('team.community.manage', 'club', (select club_id from public.teams where id = team_id), null)
  );

alter table public.fixture_messages add column if not exists team_conversation_id uuid references public.team_conversations(team_id);
alter table public.fixture_messages drop constraint if exists fixture_messages_check;
alter table public.fixture_messages add constraint fixture_messages_check
  check (num_nonnulls(fixture_request_id, fixture_id, club_conversation_id, team_conversation_id) = 1);

create or replace function internal.can_view_team_conversation(p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_enabled boolean;
  v_linked_player_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if internal.is_site_admin() or internal.can_manage_team(p_team_id) or internal.can_manage_club_fixtures(v_club_id) then
    return true;
  end if;

  select active into v_enabled from public.team_conversations where team_id = p_team_id;
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  if exists (
    select 1 from public.player_team_memberships ptm
    where ptm.team_id = p_team_id and ptm.status = 'active' and internal.is_active_player_guardian(ptm.player_id)
  ) then
    return true;
  end if;

  select ptm.player_id into v_linked_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = p_team_id and ptm.status = 'active' and p.user_id = auth.uid()
  limit 1;

  if v_linked_player_id is null then
    return false;
  end if;

  if coalesce(internal.player_effective_age(v_linked_player_id), -1) >= 18 then
    return true;
  end if;

  return internal.guardian_permission_effective(v_linked_player_id, 'view_team_conversation');
end;
$function$;

create or replace function internal.can_send_team_conversation(p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_enabled boolean;
  v_linked_player_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if internal.is_site_admin() or internal.can_manage_team(p_team_id) or internal.can_manage_club_fixtures(v_club_id) then
    return true;
  end if;

  select active into v_enabled from public.team_conversations where team_id = p_team_id;
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  if exists (
    select 1 from public.player_team_memberships ptm
    where ptm.team_id = p_team_id and ptm.status = 'active' and internal.is_active_player_guardian(ptm.player_id)
  ) then
    return true;
  end if;

  select ptm.player_id into v_linked_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = p_team_id and ptm.status = 'active' and p.user_id = auth.uid()
  limit 1;

  if v_linked_player_id is null then
    return false;
  end if;

  if coalesce(internal.player_effective_age(v_linked_player_id), -1) >= 18 then
    return true;
  end if;

  return internal.guardian_permission_effective(v_linked_player_id, 'send_team_messages');
end;
$function$;

create or replace function public.can_view_team_conversation(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select internal.can_view_team_conversation(p_team_id);
$function$;

create or replace function public.can_send_team_conversation(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select internal.can_send_team_conversation(p_team_id);
$function$;

revoke all on function public.can_view_team_conversation(uuid) from public, anon;
revoke all on function public.can_send_team_conversation(uuid) from public, anon;
grant execute on function public.can_view_team_conversation(uuid) to authenticated;
grant execute on function public.can_send_team_conversation(uuid) to authenticated;

drop policy if exists fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages
  for select using (
    internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
    or (team_conversation_id is not null and internal.can_view_team_conversation(team_conversation_id))
  );

drop policy if exists fixture_messages_insert_scoped on public.fixture_messages;
create policy fixture_messages_insert_scoped on public.fixture_messages
  for insert with check (
    sender_user_id = auth.uid()
    and (
      (team_conversation_id is not null and internal.can_send_team_conversation(team_conversation_id))
      or (
        team_conversation_id is null
        and internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
        and (club_conversation_id is null or (select status from public.club_conversations where id = fixture_messages.club_conversation_id) = 'accepted')
      )
    )
  );

comment on column public.fixture_messages.team_conversation_id is 'Team Community scope -- structurally distinct from FIXTURE/CLUB_OPERATIONAL (never fixture negotiation, never opposition/staff-only content). Reuses the existing message/report/moderation/tombstone columns on this same table rather than a parallel messaging system.';

-- =====================================================================
-- PART H: GUARDIAN REMOVAL / REPLACEMENT
-- =====================================================================
create or replace function public.remove_guardian_relationship(p_guardian_id uuid, p_reason text)
returns table (orphaned boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g public.guardians;
  v_club_id uuid;
  v_remaining int;
begin
  select * into g from public.guardians where id = p_guardian_id for update;
  if not found then
    raise exception 'Guardian relationship not found.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to remove a Guardian relationship.';
  end if;

  select t.club_id into v_club_id
  from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
  where ptm.player_id = g.player_id and ptm.status = 'active'
  limit 1;

  if v_club_id is null or not internal.has_capability('club.guardians.manage', 'club', v_club_id, null) then
    raise exception 'You are not authorized to manage Guardian relationships for this player.' using errcode = '42501';
  end if;

  update public.guardians set status = 'revoked', updated_by = auth.uid() where id = p_guardian_id;

  select count(*) into v_remaining from public.guardians where player_id = g.player_id and status = 'active';

  return query select (v_remaining = 0);
end;
$function$;

comment on function public.remove_guardian_relationship is 'Club Admin only. Returns orphaned=true when this removal leaves the player with zero active guardians -- callers (UI) must surface a high-impact safeguarding warning using this return value; a zero-guardian player is already fail-closed automatically via guardian_permission_effective() regardless of whether the UI shows the warning.';

create or replace function public.link_guardian_to_existing_player(p_guardian_invitation_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inv public.guardian_invitations;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid() then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships where player_id = p_player_id and team_id = inv.team_id and status = 'active') then
    raise exception 'That player is not on the invited team.' using errcode = '42501';
  end if;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), p_player_id, 'guardian', auth.uid())
  on conflict (guardian_user_id, player_id) where status = 'active' do nothing;
end;
$function$;

comment on function public.link_guardian_to_existing_player is 'The acceptance step of a Club-Admin-initiated replacement-Guardian invitation for a specific already-existing (orphaned) Player -- never a direct attach by player_id alone; the invited person must hold an accepted guardian_invitations row for that player''s team first.';

create or replace function public.get_team_guardian_directory(p_team_id uuid)
returns table (
  player_id uuid, player_first_name text, player_surname text,
  guardian_id uuid, guardian_user_id uuid, guardian_first_name text, guardian_surname text, guardian_email text,
  relationship_type text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id, p.first_name, p.surname,
    g.id, g.guardian_user_id, prof.first_name, prof.surname, prof.email, g.relationship_type
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.guardians g on g.player_id = p.id and g.status = 'active'
  join public.profiles prof on prof.id = g.guardian_user_id
  where ptm.team_id = p_team_id
    and ptm.status = 'active'
    and (
      internal.is_site_admin()
      or internal.has_capability('club.guardians.manage', 'club', (select club_id from public.teams where id = p_team_id), null)
    );
$$;

revoke all on function public.get_team_guardian_directory(uuid) from public, anon;
grant execute on function public.get_team_guardian_directory(uuid) to authenticated;

-- =====================================================================
-- PART I: CANONICAL AGE-GRADE RESOLVER (kept strictly separate from
-- chronological/legal age). Rule provenance: age at midnight on 31
-- August immediately before the season begins (the 1 September - 31
-- August school-year cohort). Verified against Main's own current
-- `seasons` table (season_year_start still an integer column, unchanged
-- in meaning by structured_season_identity/seasons_canonical_hardening).
-- =====================================================================
create or replace function internal.resolve_player_age_grade(p_rugby_code text, p_season_id uuid, p_date_of_birth date)
returns table(
  rugby_code text, season_id uuid, date_of_birth date, age_grade_cutoff_date date,
  age_at_cutoff integer, school_year integer, canonical_category text, canonical_age_group text, status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_season public.seasons;
  v_cutoff date;
  v_age integer;
  v_u_number integer;
begin
  select s.* into v_season from public.seasons s where s.id = p_season_id and s.rugby_code = p_rugby_code;
  if not found then
    raise exception 'Season not found for this rugby code.' using errcode = '22023';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required to resolve an age grade.' using errcode = '22023';
  end if;
  if p_date_of_birth > current_date then
    raise exception 'Date of birth cannot be in the future.' using errcode = '22023';
  end if;

  v_cutoff := make_date(v_season.season_year_start, 8, 31);
  v_age := extract(year from age(v_cutoff, p_date_of_birth))::integer;
  v_u_number := v_age + 1;

  if v_u_number < 6 then
    return query select p_rugby_code, p_season_id, p_date_of_birth, v_cutoff, v_age, null::integer, null::text, null::text, 'TOO_YOUNG'::text;
    return;
  elsif v_u_number = 17 then
    return query select p_rugby_code, p_season_id, p_date_of_birth, v_cutoff, v_age, 12, 'colts'::text, 'JuniorColts'::text, 'RESOLVED'::text;
    return;
  elsif v_u_number = 18 then
    return query select p_rugby_code, p_season_id, p_date_of_birth, v_cutoff, v_age, 13, 'colts'::text, 'SeniorColts'::text, 'RESOLVED'::text;
    return;
  elsif v_u_number > 18 then
    return query select p_rugby_code, p_season_id, p_date_of_birth, v_cutoff, v_age, null::integer, null::text, null::text, 'OUT_OF_YOUTH_RANGE'::text;
    return;
  end if;

  return query select p_rugby_code, p_season_id, p_date_of_birth, v_cutoff, v_age, (v_u_number - 5), 'youth'::text, ('U' || v_u_number::text), 'RESOLVED'::text;
end;
$function$;

revoke all on function internal.resolve_player_age_grade(text, uuid, date) from public, anon, authenticated;

create or replace function internal.resolve_player_chronological_age(p_date_of_birth date, p_as_of date default current_date)
returns table(age_years integer, is_minor boolean)
language sql
immutable
as $function$
  select
    extract(year from age(p_as_of, p_date_of_birth))::integer,
    extract(year from age(p_as_of, p_date_of_birth))::integer < 18;
$function$;

-- =====================================================================
-- PART J: SELF-SERVICE ADD-A-CHILD + PENDING MEMBERSHIP APPROVAL
-- =====================================================================
create or replace function public.add_child_for_guardian(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text)
returns table(result text, player_id uuid, age_grade text, school_year integer, team_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_season_id uuid;
  v_grade record;
  v_existing_player_id uuid;
  v_match_player_id uuid;
  v_match_count integer;
  v_match_team_id uuid;
  v_new_player_id uuid;
  v_candidate_team_id uuid;
  v_candidate_team_count integer;
  v_result text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id and status = 'active') then
    raise exception 'Club not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || lower(v_first) || ':' || lower(v_surname) || ':' || p_date_of_birth::text, 0));

  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;

  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.';
  end if;

  select p.id into v_existing_player_id
  from public.players p
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
  join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status in ('pending', 'active')
  join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
  where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;
  if v_existing_player_id is not null then
    return query select 'already_linked'::text, v_existing_player_id, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.player_duplicate_reviews pdr
    where pdr.requesting_guardian_user_id = auth.uid()
      and pdr.status = 'pending'
      and lower(pdr.submitted_first_name) = lower(v_first) and lower(pdr.submitted_surname) = lower(v_surname)
      and pdr.submitted_date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id and ptm.status in ('pending', 'active')
    and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count >= 1 then
    select distinct ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id and ptm.status in ('pending', 'active')
      and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  if v_match_count = 1 then
    select ptm.team_id into v_match_team_id
    from public.player_team_memberships ptm
    where ptm.player_id = v_match_player_id and ptm.status in ('pending', 'active')
    order by (ptm.status = 'active') desc, ptm.joined_at desc
    limit 1;

    insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by, requesting_guardian_user_id)
    values (v_match_team_id, v_first, v_surname, p_date_of_birth, v_match_player_id, auth.uid(), auth.uid());

    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  elsif v_match_count > 1 then
    raise exception 'We found more than one possible existing match for this player at this club. Please contact the club directly so they can confirm the correct player.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, created_by)
  values (v_first, v_surname, p_date_of_birth, auth.uid())
  returning id into v_new_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), v_new_player_id, 'guardian', auth.uid());

  select count(*) into v_candidate_team_count
  from public.teams t
  where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

  if v_candidate_team_count = 1 then
    select t.id into v_candidate_team_id
    from public.teams t
    where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

    insert into public.player_team_memberships (player_id, team_id, status, created_by)
    values (v_new_player_id, v_candidate_team_id, 'pending', auth.uid());
    v_result := 'created_pending_team';
  else
    v_candidate_team_id := null;
    v_result := 'created_needs_club_review';
  end if;

  return query select v_result, v_new_player_id, v_grade.canonical_age_group, v_grade.school_year, v_candidate_team_id;
end;
$function$;

revoke all on function public.add_child_for_guardian(text, text, date, uuid, text) from public, anon;
grant execute on function public.add_child_for_guardian(text, text, date, uuid, text) to authenticated;

-- Final version (includes the Parent notification on approve/reject,
-- supersedes the fork-history's earlier draft that had no notification).
create or replace function public.approve_pending_team_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_guardian_user_id uuid;
  v_player_first_name text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.status <> 'pending' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to approve this request.' using errcode = '42501';
  end if;

  update public.player_team_memberships set status = 'active' where id = p_membership_id;

  select g.guardian_user_id, p.first_name into v_guardian_user_id, v_player_first_name
  from public.guardians g join public.players p on p.id = g.player_id
  where g.player_id = m.player_id and g.status = 'active'
  order by g.created_at asc limit 1;
  if v_guardian_user_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_guardian_user_id, 'add_child_approved', 'Team join confirmed', v_player_first_name || ' has been confirmed onto the team.', jsonb_build_object('player_id', m.player_id));
  end if;
end;
$function$;

create or replace function public.reject_pending_team_membership(p_membership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_guardian_user_id uuid;
  v_player_first_name text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.status <> 'pending' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to reject this request.' using errcode = '42501';
  end if;

  update public.player_team_memberships set status = 'ended', ended_at = now() where id = p_membership_id;

  select g.guardian_user_id, p.first_name into v_guardian_user_id, v_player_first_name
  from public.guardians g join public.players p on p.id = g.player_id
  where g.player_id = m.player_id and g.status = 'active'
  order by g.created_at asc limit 1;
  if v_guardian_user_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_guardian_user_id, 'add_child_declined', 'Team join declined', v_player_first_name || '''s team join request was declined by the club.', jsonb_build_object('player_id', m.player_id));
  end if;
end;
$function$;

revoke all on function public.approve_pending_team_membership(uuid) from public, anon;
revoke all on function public.reject_pending_team_membership(uuid, text) from public, anon;
grant execute on function public.approve_pending_team_membership(uuid) to authenticated;
grant execute on function public.reject_pending_team_membership(uuid, text) to authenticated;

-- Real bug found live in Side Project 1's own verification, preserved
-- here: internal.can_manage_player only recognizes ACTIVE memberships, so
-- without this additive policy an authorized roster manager could not
-- even SELECT a candidate player's own row for a still-pending join,
-- silently vanishing it from the approval queue. Deliberately NOT
-- widening can_manage_player itself -- its "active only" semantics are
-- relied on elsewhere (e.g. subscription eligibility) and must stay
-- exactly as they are; this is a separate, additive SELECT policy (RLS
-- SELECT policies OR together), narrowly scoped to PENDING rows only,
-- using the SAME capability the approval RPCs themselves already require.
create policy players_select_pending_roster_review on public.players
  for select
  using (
    exists (
      select 1 from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where ptm.player_id = players.id
        and ptm.status = 'pending'
        and (internal.has_capability('team.roster.manage', 'team', t.club_id, t.id) or internal.has_capability('club.roster.manage', 'club', t.club_id, null))
    )
  );

-- =====================================================================
-- PART K: OPTIONAL PLAYER-ACCOUNT INVITATION (decoupled entirely from
-- Guardian invitations -- an email invited to become the SAME player_id's
-- own login).
-- =====================================================================
create table public.player_account_invitations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id),
  invited_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '14 days'),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index player_account_invitations_player_id_idx on public.player_account_invitations (player_id);
create index player_account_invitations_invited_email_idx on public.player_account_invitations (lower(invited_email));

create trigger set_updated_at before update on public.player_account_invitations for each row execute function set_updated_at();
create trigger audit_row_change after insert or delete or update on public.player_account_invitations for each row execute function internal.audit_row_change();

alter table public.player_account_invitations enable row level security;

create policy player_account_invitations_select_scoped on public.player_account_invitations
  for select
  using (internal.is_site_admin() or internal.is_active_player_guardian(player_id) or invited_by = auth.uid());

create or replace function public.invite_player_account(p_player_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not internal.is_active_player_guardian(p_player_id) then
    raise exception 'You are not authorized to invite a login for this player.' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required.';
  end if;
  if exists (select 1 from public.players where id = p_player_id and user_id is not null) then
    raise exception 'This player already has their own Ovalball login.';
  end if;
  if exists (select 1 from public.player_account_invitations where player_id = p_player_id and status = 'pending') then
    raise exception 'A login invitation is already pending for this player.';
  end if;

  insert into public.player_account_invitations (player_id, invited_email, invited_by)
  values (p_player_id, v_email, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.accept_player_account_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inv public.player_account_invitations;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into inv from public.player_account_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invitation has already been used or is no longer valid.';
  end if;
  if inv.expires_at < now() then
    update public.player_account_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired.';
  end if;
  if exists (select 1 from public.players where user_id = auth.uid()) then
    raise exception 'Your account is already linked to a player profile.';
  end if;
  if exists (select 1 from public.players where id = inv.player_id and user_id is not null) then
    raise exception 'This player already has an Ovalball login.';
  end if;

  update public.players set user_id = auth.uid() where id = inv.player_id;
  update public.player_account_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;

  return inv.player_id;
end;
$function$;

create or replace function public.get_player_account_invitation_preview(p_token text)
returns table(invitation_id uuid, player_first_name text, status text, expires_at timestamptz, invited_email text, accepted_by uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select pai.id, p.first_name, pai.status, pai.expires_at, pai.invited_email, pai.accepted_by
  from public.player_account_invitations pai
  join public.players p on p.id = pai.player_id
  where pai.token = p_token;
$function$;

revoke all on function public.invite_player_account(uuid, text) from public, anon;
revoke all on function public.accept_player_account_invitation(text) from public, anon;
revoke execute on function public.get_player_account_invitation_preview(text) from public;
grant execute on function public.invite_player_account(uuid, text) to authenticated;
grant execute on function public.accept_player_account_invitation(text) to authenticated;
grant execute on function public.get_player_account_invitation_preview(text) to anon, authenticated;
