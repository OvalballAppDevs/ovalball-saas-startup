-- Identity and authorisation containment.
--
-- Closes the directly exploitable findings of the identity/auth audit at the
-- layer that actually decides: grants, row policies and the SECURITY DEFINER
-- functions themselves. Nothing here hides a button. Each section names the
-- attack it stops; supabase/tests/identity_security_containment.sql runs each
-- attack as the real database role and fails if it succeeds.
--
-- This is containment, not the redesign. The capability model, Site Admin
-- bundles and unified invitations follow in their own slices.

-- ---------------------------------------------------------------------
-- 1. Children's records are written only through checked functions.
--
-- players_write carried WITH CHECK (is_site_admin() OR true), so anyone --
-- anonymous included -- could insert a player. guardians_write and
-- player_team_memberships_write let team staff create or remove a guardian
-- relationship and attach any child to their team. Every legitimate writer
-- of these three tables is a SECURITY DEFINER function, so browser roles
-- need no write access at all.
-- ---------------------------------------------------------------------

drop policy if exists players_write on public.players;
drop policy if exists guardians_write on public.guardians;
drop policy if exists player_team_memberships_write on public.player_team_memberships;

revoke all on public.players, public.guardians, public.player_team_memberships from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.players, public.guardians, public.player_team_memberships from authenticated;

-- ---------------------------------------------------------------------
-- 2. Nobody administers their own account status.
--
-- profiles_update_self_or_admin let a user update every column of their own
-- row, account_status included, so a suspended user could reactivate
-- themselves; it also let any Site Admin, read-only included, rewrite anyone's
-- profile. A person may still edit their own name, address, phone and photo.
-- Email follows the Auth email-change flow, date of birth is set at signup,
-- and account status changes only through set_account_status.
-- ---------------------------------------------------------------------

revoke all on public.profiles from anon;
revoke insert, update, delete, truncate, trigger, references on public.profiles from authenticated;
grant insert (id, first_name, surname, date_of_birth, address_line_1, address_line_2, address_line_3,
  town, county, country, postcode, phone_number, avatar_storage_path) on public.profiles to authenticated;
grant update (first_name, surname, address_line_1, address_line_2, address_line_3,
  town, county, country, postcode, phone_number, avatar_storage_path) on public.profiles to authenticated;

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

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

  update public.profiles set account_status = p_status where id = p_user_id;
  if not found then
    raise exception 'That account has no Ovalball profile yet.';
  end if;
end;
$$;

revoke all on function public.set_account_status(uuid, text) from public, anon;
grant execute on function public.set_account_status(uuid, text) to authenticated;

comment on function public.set_account_status(uuid, text) is
  'The one way to suspend or reactivate an account. Full and User Access Site Admins only, never on themselves. profiles.account_status is not writable by any browser role.';

-- ---------------------------------------------------------------------
-- 3. Club membership rows keep their person, club and suspension.
--
-- A Club Admin may change a member's role, title, group and status, as the
-- People screens do. They may not move a membership to someone else, into
-- another club, or lift an authority suspension, and they may not bring a
-- revoked membership back to life with its old role and team authority.
-- ---------------------------------------------------------------------

revoke all on public.club_memberships from anon;
revoke update, truncate, trigger, references on public.club_memberships from authenticated;
grant update (role, status, club_role_title, assigned_group_id, updated_by, updated_at)
  on public.club_memberships to authenticated;

drop policy if exists club_memberships_update_scoped on public.club_memberships;
create policy club_memberships_update_scoped on public.club_memberships
  for update
  using (internal.is_site_admin() or internal.is_club_admin(club_id))
  with check (internal.is_site_admin() or internal.is_club_admin(club_id));

-- SECURITY INVOKER on purpose: current_user is the browser role for a direct
-- update and the function owner inside the checked RPCs, which is exactly the
-- distinction this guard draws.
create or replace function internal.guard_club_membership_revival()
returns trigger
language plpgsql
set search_path = public, internal, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated')
     and old.status = 'revoked' and new.status <> 'revoked'
     and (not internal.is_account_active(auth.uid())
          or coalesce(internal.site_admin_role(auth.uid()), '') not in ('full', 'user_access')) then
    raise exception 'A revoked membership is restored by a Site Admin or by a new invitation, not by editing the row.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_club_membership_revival on public.club_memberships;
create trigger guard_club_membership_revival
  before update of status on public.club_memberships
  for each row execute function internal.guard_club_membership_revival();

-- ---------------------------------------------------------------------
-- 4. The fixture overview is evaluated as the caller.
--
-- admin_fixture_overview ran with its owner's rights, so its rows ignored
-- row-level security and anonymous callers could read every club's fixtures,
-- notes and contacts. As an invoker view it shows each caller only the
-- fixtures they could already read.
-- ---------------------------------------------------------------------

alter view public.admin_fixture_overview set (security_invoker = true);
revoke all on public.admin_fixture_overview from anon;

-- ---------------------------------------------------------------------
-- 5. A club's GoCardless merchant token never reaches a browser role.
--
-- Both token functions were executable by authenticated, so a paying parent
-- or a Club Admin could call them straight from the browser and hold the
-- club's live merchant credential. They now run only for service_role, from
-- server code that has already checked the signed-in user, and they re-check
-- that user's authority themselves.
--
-- The club check needs internal.has_capability, which reads the caller from
-- request.jwt.claims. The function sets the claims to the named actor for the
-- duration of the check and restores them. That is not an escalation: only
-- service_role can call it, and service_role can already read the table.
-- ---------------------------------------------------------------------

drop function if exists public.get_gocardless_token_for_payer_subscription(uuid);
drop function if exists public.get_gocardless_token_for_club_admin_action(uuid);

create or replace function public.get_gocardless_token_for_payer_subscription(p_payer_subscription_id uuid, p_actor_user_id uuid)
returns table (access_token text, environment text, club_id uuid)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if p_actor_user_id is null or not internal.is_account_active(p_actor_user_id) then
    return;
  end if;
  return query
  select mc.access_token, mc.environment, mc.club_id
  from public.player_subscription_payers psp
  join public.club_subscription_programmes prog on prog.id = psp.programme_id
  join public.gocardless_merchant_connections mc on mc.club_id = prog.club_id and mc.disconnected_at is null
  where psp.id = p_payer_subscription_id and psp.payer_user_id = p_actor_user_id;
end;
$$;

create or replace function public.get_gocardless_token_for_club_admin_action(p_club_id uuid, p_actor_user_id uuid)
returns table (access_token text, environment text)
language plpgsql
volatile
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_allowed boolean;
begin
  if p_actor_user_id is null then
    return;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_actor_user_id, 'role', 'authenticated')::text, true);
  v_allowed := internal.has_capability('club.subscription.manage_payment_actions', 'club', p_club_id, null);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  if not coalesce(v_allowed, false) then
    return;
  end if;
  return query
  select mc.access_token, mc.environment
  from public.gocardless_merchant_connections mc
  where mc.club_id = p_club_id and mc.disconnected_at is null;
end;
$$;

revoke all on function public.get_gocardless_token_for_payer_subscription(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_gocardless_token_for_club_admin_action(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_gocardless_token_for_payer_subscription(uuid, uuid) to service_role;
grant execute on function public.get_gocardless_token_for_club_admin_action(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 6. A player login invitation binds only its recipient.
--
-- Anyone holding the link could become the child's login. The signed-in
-- account's verified email must now be the invited one.
-- ---------------------------------------------------------------------

create or replace function public.accept_player_account_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = lower(inv.invited_email)
  ) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
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
$$;

-- ---------------------------------------------------------------------
-- 7. A guardian invitation cannot be pointed at a different child.
--
-- link_guardian_to_existing_player accepted any player on the invited team.
-- It exists only for the replacement flow, so it now links the one child the
-- invitation names and nothing else.
-- ---------------------------------------------------------------------

create or replace function public.link_guardian_to_existing_player(p_guardian_invitation_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.guardian_invitations;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if not found or inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid() then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if inv.replacement_for_player_id is null or inv.replacement_for_player_id <> p_player_id then
    raise exception 'This invitation is not for that player.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships where player_id = p_player_id and team_id = inv.team_id and status = 'active') then
    raise exception 'That player is not on the invited team.' using errcode = '42501';
  end if;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), p_player_id, 'guardian', auth.uid())
  on conflict (guardian_user_id, player_id) where status = 'active' do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. A team's children and guardians are visible to the people who look
--    after that team, not to every club member.
--
-- team.view is held by every club member club-wide, so team_people handed
-- the club's whole child-to-guardian graph to any member. Viewing now needs
-- roster or guardian authority for the team, or club roster/team management.
-- ---------------------------------------------------------------------

create or replace function internal.team_people_authority(p_team_id uuid)
returns table (may_view boolean, may_manage boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    return query select false, false;
    return;
  end if;

  return query
  select
    internal.has_capability('team.roster.manage', 'team', v_club_id, p_team_id)
      or internal.has_capability('team.guardians.invite', 'team', v_club_id, p_team_id)
      or internal.has_capability('club.roster.manage', 'club', v_club_id, null)
      or internal.has_capability('club.teams.manage', 'club', v_club_id, null),
    internal.has_capability('team.manage', 'team', v_club_id, p_team_id)
      or internal.has_capability('club.teams.manage', 'club', v_club_id, null);
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Nobody approves their own guardian request.
--
-- A guardian could propose any account as an additional guardian and then
-- approve it themselves, because the proposer is an active guardian of the
-- child. The requester never decides their own request, and adding a further
-- adult to a child is a club safeguarding decision. A request for someone
-- without an account is never approved onto the requester instead.
-- ---------------------------------------------------------------------

create or replace function internal.can_decide_guardian_link_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1
    from public.guardian_link_requests r
    where r.id = p_request_id
      and r.requested_by_user_id is distinct from auth.uid()
      and (
        internal.has_capability('club.guardians.manage', 'club', r.club_id, null)
        or (
          r.kind <> 'ADDITIONAL_GUARDIAN'
          and exists (
            select 1 from public.guardians g
            where g.guardian_user_id = auth.uid()
              and g.status = 'active'
              and g.player_id = coalesce(r.target_player_id, r.matched_player_id)
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.approve_guardian_link_request(p_request_id uuid)
 RETURNS TABLE(result text, player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $$
declare
  r public.guardian_link_requests%rowtype;
  v_player_id uuid;
  v_subject uuid;
  v_season_id uuid;
  v_grade record;
  v_team_id uuid;
  v_team_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- Lock the row so two approvers cannot both act on one request and
  -- produce two guardian relationships or two players.
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null then
    -- Same message for "does not exist" and "not yours to see", so this
    -- cannot be used to probe for request ids.
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if not internal.can_decide_guardian_link_request(p_request_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  -- An additional guardian is the SUBJECT of the request, never the person
  -- who asked; only a first-child request is about the requester themselves.
  if r.kind = 'ADDITIONAL_GUARDIAN' then
    v_subject := r.subject_user_id;
  else
    v_subject := coalesce(r.subject_user_id, r.requested_by_user_id);
  end if;
  if v_subject is null then
    -- An additional-guardian request for someone with no account yet cannot
    -- be completed here; they must accept the invitation and sign in first.
    raise exception 'This person needs to accept their invitation and sign in before the relationship can be approved.';
  end if;

  if r.kind = 'ADDITIONAL_GUARDIAN' then
    v_player_id := r.target_player_id;
  elsif r.matched_player_id is not null then
    -- Existing child: attach to the CANONICAL player. No duplicate is ever
    -- created on this branch -- that is the whole point of matching.
    v_player_id := r.matched_player_id;
  else
    -- No existing child: create the canonical Player now, at approval time,
    -- by a human with real authority -- never at request time.
    insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
    values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, r.submitted_playing_pathway, auth.uid())
    returning id into v_player_id;

    -- Place them on a team using the existing canonical age-grade domain,
    -- exactly as add_child_for_guardian does. Ambiguity leaves the player
    -- without a membership for the club to resolve, rather than guessing.
    v_season_id := internal.resolve_season_for_date(coalesce(r.rugby_code, 'union'), current_date);
    if v_season_id is not null then
      select * into v_grade from internal.resolve_player_age_grade(coalesce(r.rugby_code, 'union'), v_season_id, r.submitted_date_of_birth);
      if v_grade.status not in ('TOO_YOUNG', 'OUT_OF_YOUTH_RANGE') then
        select count(*) into v_team_count
        from public.teams t
        where t.club_id = r.club_id and t.active = true
          and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
        if v_team_count = 1 then
          select t.id into v_team_id
          from public.teams t
          where t.club_id = r.club_id and t.active = true
            and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
          insert into public.player_team_memberships (player_id, team_id, status, created_by)
          values (v_player_id, v_team_id, 'active', auth.uid());
        end if;
      end if;
    end if;
  end if;

  -- The relationship itself -- created ONLY here, only on approval.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, created_by)
  values (v_subject, v_player_id, 'guardian', 'active', auth.uid())
  on conflict do nothing;

  update public.guardian_link_requests
  set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), resolved_player_id = v_player_id
  where id = p_request_id;

  return query select 'approved'::text, v_player_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Revoked authority does not come back through a lesser door.
--
-- A revoked Club Admin who accepted an ordinary member invitation, or whose
-- join request was approved, got their CLUB_ADMIN role and team authority
-- back, because the conflict branch only flipped status to active. A revoked
-- Site Admin re-invited as read-only kept every capability flag they held
-- before. A revoked row now restarts from what the new grant says.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_inv public.invitations;
  v_membership_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept an invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  v_role := coalesce(v_inv.club_role, 'BASIC_USER');

  -- A revoked membership is not "an existing membership" for the purpose of
  -- keeping the higher role: it restarts from this invitation, and the team
  -- authority it held before does not come back with it.
  select id into v_membership_id from public.club_memberships
  where club_id = v_inv.club_id and user_id = auth.uid() and status = 'revoked'
  for update;
  if v_membership_id is not null then
    delete from public.team_permissions where membership_id = v_membership_id;
    update public.club_memberships
    set role = v_role, assigned_group_id = null, club_role_title = null, updated_by = auth.uid()
    where id = v_membership_id;
  end if;

  -- On conflict (an existing membership, e.g. from an earlier join
  -- request), never silently downgrade: keep whichever of the two roles
  -- ranks higher rather than overwriting an existing CLUB_ADMIN with a
  -- lesser team-only invite's implicit BASIC_USER.
  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_inv.club_id, auth.uid(), v_role, 'active', v_inv.created_by, auth.uid())
  on conflict (club_id, user_id) do update
    set status = 'active',
        role = case
          when public.club_memberships.role = 'CLUB_ADMIN' or excluded.role = 'CLUB_ADMIN' then 'CLUB_ADMIN'
          when public.club_memberships.role = 'FIXTURE_SECRETARY' or excluded.role = 'FIXTURE_SECRETARY' then 'FIXTURE_SECRETARY'
          else 'BASIC_USER'
        end,
        updated_by = auth.uid()
  returning id into v_membership_id;

  insert into public.team_permissions (membership_id, team_id, permission, created_by)
  select v_membership_id, it.team_id, it.team_permission, v_inv.created_by
  from public.invitation_teams it
  where it.invitation_id = v_inv.id
  on conflict (membership_id, team_id) do update set permission = excluded.permission;

  update public.invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'club_invitation_accepted', 'Invitation accepted',
    format('%s accepted your invitation.', coalesce(p.first_name || ' ' || p.surname, 'A new member')),
    jsonb_build_object('club_id', v_inv.club_id, 'invitation_id', v_inv.id)
  from public.club_memberships cm
  left join public.profiles p on p.id = auth.uid()
  where cm.club_id = v_inv.club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active' and cm.user_id <> auth.uid();

  return v_inv.club_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.approve_club_join_request(p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_request public.club_join_requests;
begin
  select * into v_request from public.club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Join request not found.'; end if;
  if not (internal.is_site_admin() or internal.is_club_admin(v_request.club_id)) then
    raise exception 'Only that club''s admin or a Site Admin may approve a join request.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Join request is not pending (current status: %).', v_request.status;
  end if;

  -- A revoked member rejoins as a member: no old role, group or team authority.
  delete from public.team_permissions tp
  using public.club_memberships cm
  where tp.membership_id = cm.id
    and cm.club_id = v_request.club_id and cm.user_id = v_request.requesting_user_id and cm.status = 'revoked';
  update public.club_memberships
  set role = 'BASIC_USER', assigned_group_id = null, club_role_title = null, updated_by = auth.uid()
  where club_id = v_request.club_id and user_id = v_request.requesting_user_id and status = 'revoked';

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_request.club_id, v_request.requesting_user_id, 'BASIC_USER', 'active', auth.uid(), auth.uid())
  on conflict (club_id, user_id) do update set status = 'active', updated_by = auth.uid();

  update public.club_join_requests
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_request.requesting_user_id,
    'club_claim_approved',
    'Club access approved',
    'Your request to join has been approved.',
    jsonb_build_object('club_id', v_request.club_id, 'join_request_id', p_request_id)
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.accept_site_admin_invitation(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_inv public.site_admin_invitations;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.site_admin_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.site_admin_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  insert into public.site_admins (user_id, admin_role, status, granted_by)
  values (auth.uid(), v_inv.admin_role, 'active', v_inv.invited_by)
  on conflict (user_id) do update set
    admin_role = excluded.admin_role,
    status = 'active',
    granted_by = excluded.granted_by,
    granted_at = now(),
    revoked_by = null,
    revoked_at = null,
    -- A revoked Site Admin comes back with the profile this invitation
    -- grants and nothing they held before it.
    diagnostic_club_access = case when public.site_admins.status = 'revoked' then false else public.site_admins.diagnostic_club_access end,
    manage_team_catalogue = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_team_catalogue end,
    manage_competitions = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_competitions end,
    manage_fixture_support = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_fixture_support end,
    manage_global_lookups = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_global_lookups end,
    manage_permissions = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_permissions end,
    manage_seasons = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_seasons end,
    manage_system = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_system end,
    view_commercial = case when public.site_admins.status = 'revoked' then false else public.site_admins.view_commercial end,
    view_regulatory_content = case when public.site_admins.status = 'revoked' then false else public.site_admins.view_regulatory_content end,
    manage_regulatory_content = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_regulatory_content end,
    view_hub_content = case when public.site_admins.status = 'revoked' then false else public.site_admins.view_hub_content end,
    manage_hub_content = case when public.site_admins.status = 'revoked' then false else public.site_admins.manage_hub_content end;

  update public.site_admin_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_inv.invited_by,
    'site_admin_invitation_accepted',
    'Site Admin invitation accepted',
    format('Your Site Admin invitation for %s was accepted.', v_inv.invited_email),
    jsonb_build_object('site_admin_invitation_id', v_inv.id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 11. A session cannot declare itself newer than the server.
--
-- record_session_version stored whatever the client sent, so a session could
-- set a version far ahead and survive the next forced re-authentication.
-- The server's current version lives here and must move together with
-- AUTH_SESSION_VERSION in lib/auth/session-version.ts.
-- ---------------------------------------------------------------------

create or replace function internal.auth_session_version()
returns integer
language sql
immutable
set search_path = public
as $$ select 1 $$;

create or replace function public.record_session_version(p_version integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := least(coalesce(p_version, 0), internal.auth_session_version());
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  insert into public.user_session_versions (user_id, version, set_at)
  values (auth.uid(), v_version, now())
  on conflict (user_id) do update
    set version = greatest(public.user_session_versions.version, excluded.version), set_at = now();
end;
$$;

-- A version already stored ahead of the server is brought back into line, so
-- the next deliberate bump still reaches that session.
update public.user_session_versions
set version = internal.auth_session_version()
where version > internal.auth_session_version();

revoke all on function public.record_session_version(integer) from public, anon;
grant execute on function public.record_session_version(integer) to authenticated;

-- ---------------------------------------------------------------------
-- 12. A club's suspended officers are listed to Site Admins only.
-- ---------------------------------------------------------------------

create or replace function public.list_suspended_club_memberships(p_club_id uuid)
returns table (membership_id uuid, user_id uuid, role text, authority_suspended_at timestamptz, first_name text, surname text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;
  return query
  select cm.id, cm.user_id, cm.role, cm.authority_suspended_at, p.first_name, p.surname
  from public.club_memberships cm
  join public.profiles p on p.id = cm.user_id
  where cm.club_id = p_club_id and cm.status = 'active' and cm.authority_suspended = true
  order by cm.role, p.surname;
end;
$$;

revoke all on function public.list_suspended_club_memberships(uuid) from public, anon;
grant execute on function public.list_suspended_club_memberships(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 13. Older fixture and competition functions need a signed-in caller, and
--     a fixture request's existence is not revealed to someone who may not
--     answer it.
-- ---------------------------------------------------------------------

revoke all on function public.accept_fixture_request(uuid, uuid) from public, anon;
revoke all on function public.create_competition(text, text, text, boolean, uuid[]) from public, anon;
revoke all on function public.publish_import_row(uuid) from public, anon;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;
grant execute on function public.create_competition(text, text, text, boolean, uuid[]) to authenticated;
grant execute on function public.publish_import_row(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_team_id uuid;
  v_target_group_id uuid;
  v_requesting_team_id uuid;
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
  v_both_clubs_active boolean;
  v_pitch_id uuid;
  v_venue_id uuid;
  v_venue_address text;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if v_req.requesting_team_id is not null then
    v_requesting_team_id := v_req.requesting_team_id;
  else
    select min(team_id) into v_requesting_team_id from public.scheduling_group_members where group_id = v_req.requesting_scheduling_group_id;
    if v_requesting_team_id is null then
      raise exception 'This shared calendar has no member teams to book against.';
    end if;
  end if;

  if v_req.target_team_id is null and v_req.target_scheduling_group_id is not null then
    if p_target_team_id is not null then
      if not exists (select 1 from public.scheduling_group_members where group_id = v_req.target_scheduling_group_id and team_id = p_target_team_id) then
        raise exception 'That team is not a member of this shared calendar.';
      end if;
      if not internal.teams_can_play_fixture(v_requesting_team_id, p_target_team_id) then
        raise exception 'That team is not age-eligible against your requesting team.';
      end if;
      v_target_team_id := p_target_team_id;
      v_target_group_id := null;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this shared calendar is age-eligible against the requesting team.';
      end if;
      -- One or more eligible members: accept against the WHOLE group
      -- (the auto-resolved member is only the required real anchor).
      v_target_team_id := v_auto_resolved_team_id;
      v_target_group_id := v_req.target_scheduling_group_id;
    end if;
  else
    v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
    v_target_group_id := null;
  end if;

  if v_target_team_id is not null then
    select club_id into v_target_club_id from public.teams where id = v_target_team_id;
  else
    v_target_club_id := v_group.opponent_club_id;
  end if;

  if not (internal.is_site_admin()
          or (v_target_team_id is not null and internal.can_manage_team(v_target_team_id))
          or (v_target_club_id is not null and internal.can_manage_club_fixtures(v_target_club_id))) then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;
  if v_req.status <> 'sent' then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  v_requesting_club_venue := case v_req.venue_preference
    when 'home' then 'Home' when 'away' then 'Away' else 'TBD' end;
  v_target_venue := case v_req.venue_preference
    when 'home' then 'Away' when 'away' then 'Home' else 'TBD' end;

  v_pitch_id := case when v_requesting_club_venue = 'Home' then v_req.pitch_id else null end;
  v_venue_id := case when v_requesting_club_venue = 'Home' then v_req.venue_id else null end;

  -- AN AWAY REQUEST'S PROPOSED GROUND. The host is accepting the fixture at the
  -- ground it was asked about. When that names one of the host's own venues it
  -- becomes that venue record; otherwise it is kept as the ground's text.
  if v_requesting_club_venue = 'Away' and nullif(btrim(v_req.proposed_ground), '') is not null then
    select v.id into v_venue_id
    from public.venues v
    where v.club_id = v_target_club_id and v.active and lower(btrim(v.name)) = lower(btrim(v_req.proposed_ground))
    order by v.is_default_home desc, v.id
    limit 1;
    if v_venue_id is null then
      v_venue_address := btrim(v_req.proposed_ground)
        || coalesce(', ' || nullif(btrim(v_req.proposed_pitch), ''), '');
    elsif nullif(btrim(v_req.proposed_pitch), '') is not null then
      select p.id into v_pitch_id
      from public.club_pitches p
      where p.venue_id = v_venue_id and p.active and lower(btrim(p.display_name)) = lower(btrim(v_req.proposed_pitch))
      limit 1;
    end if;
  end if;

  -- AN EXISTING FIXTURE, CONFIRMED. A request raised from the fixture editor
  -- asks the opposition to confirm which of their teams plays a fixture that
  -- already exists; accepting it completes that fixture rather than creating
  -- a second one. Anything else is the ordinary new fixture.
  if v_req.existing_fixture_id is not null then
    update public.fixtures f
    set opponent_team_id = v_target_team_id,
        opponent_directory_id = coalesce((select c.directory_id from public.clubs c where c.id = v_target_club_id), f.opponent_directory_id),
        updated_by = auth.uid()
    where f.id = v_req.existing_fixture_id
      and f.status <> 'Cancelled'
      and f.opponent_team_id is null
      and f.owning_team_id = v_requesting_team_id
    returning f.id into v_fixture_id;
    if v_fixture_id is null then
      raise exception 'That fixture has been cancelled or changed since this request was sent, so there is nothing to confirm.' using errcode = '23514';
    end if;
  else
    insert into public.fixtures (
      owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id, opponent_scheduling_group_id,
      game_type, competition_edition_id, pitch_id, venue_id, venue_address,
      created_by, updated_by
    )
    values (
      v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
      v_requesting_club_venue, 'Booked',
      v_group.raw_opponent_text,
      -- A fixture carries ONE canonical opponent identity: either an
      -- opponent scheduling group or an opponent directory club, never
      -- both (fixtures_opponent_group_excludes_directory). When the
      -- request resolves against a Mini-Rugby Group, the group IS the
      -- opponent identity, so the directory reference must be dropped.
      -- Previously both were inserted unconditionally, so accepting any
      -- group-targeted request whose opponent came from the directory
      -- (the normal case) failed outright on that check constraint.
      case when v_target_group_id is not null then null else v_group.opponent_directory_id end,
      v_target_team_id, v_target_group_id,
      v_group.game_type, v_group.competition_edition_id, v_pitch_id, v_venue_id, v_venue_address,
      v_req.created_by, auth.uid()
    )
    returning id into v_fixture_id;
  end if;

  update public.fixture_requests
  set status = 'accepted', target_team_id = v_target_team_id,
      resulting_fixture_id = v_fixture_id, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
    format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = v_requesting_team_id;

  if v_target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
      format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_target_team_id;
  end if;

  if v_target_club_id is not null and v_group.requesting_club_id <> v_target_club_id then
    select (select status from public.clubs where id = v_group.requesting_club_id) = 'active'
           and (select status from public.clubs where id = v_target_club_id) = 'active'
      into v_both_clubs_active;

    if v_both_clubs_active and not exists (
      select 1 from public.club_partnerships cp
      where cp.status <> 'revoked'
        and least(cp.requesting_club_id, cp.partner_club_id) = least(v_group.requesting_club_id, v_target_club_id)
        and greatest(cp.requesting_club_id, cp.partner_club_id) = greatest(v_group.requesting_club_id, v_target_club_id)
    ) then
      begin
        insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by, source_fixture_id)
        values (v_group.requesting_club_id, v_target_club_id, v_req.created_by, v_fixture_id);
      exception when unique_violation then
        null;
      end;
    end if;
  end if;

  return v_fixture_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. Overdue fixture results are finalised by the scheduler.
--
-- reconcile_overdue_fixture_results is service_role only, but pages called it
-- with the signed-in user's session, where it could never run. It now runs
-- every fifteen minutes from pg_cron, whose null auth.uid() is the function's
-- own legitimate path, and the page calls are removed.
-- ---------------------------------------------------------------------

do $$
begin
  if current_database() = nullif(current_setting('cron.database_name', true), '') then
    execute 'create extension if not exists pg_cron';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reconcile-overdue-fixture-results', '*/15 * * * *', $job$select public.reconcile_overdue_fixture_results()$job$);
  else
    raise notice 'pg_cron is not installed in %; reconcile-overdue-fixture-results was not scheduled.', current_database();
  end if;
end $$;
