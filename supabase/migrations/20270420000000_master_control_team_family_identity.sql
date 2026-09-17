-- =====================================================================================================
-- SLICE 7 (4/n) -- the rest of master control (Phase 2 Q.3)
--
-- Team, family, and platform access. Same preamble, same delegation to canonical transitions, same
-- refusal to reimplement anything: every one of these writes through the function that already owns
-- the rule, so a Site Admin meets the minor prohibition, the D-S5-1 age gate, the pathway rules and
-- the terminal-state rules exactly as a club does.
--
-- WHAT A SITE ADMIN STILL CANNOT DO, and these are the interesting ones:
--   * put a minor into a minor-prohibited role -- internal.grant_role refuses whoever calls it;
--   * make somebody a Safeguarding Officer outright -- the appointment enters PENDING_CONFIRMATION
--     and AN-6 still wants a separate confirmation;
--   * link a guardian to their own player record -- Q.3's "guardian is not the player's own user";
--   * act on their own account -- the self-target rule.
-- =====================================================================================================

-- =====================================================================================================
-- TEAM
-- =====================================================================================================
create or replace function public.site_assign_team_role(
  p_user_id uuid, p_team_id uuid, p_role_key text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_membership uuid; v_assignment uuid; v_scope text;
begin
  perform internal.master_control_preamble('site.team_roles.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);

  select t.club_id into v_club from public.teams t where t.id = p_team_id and t.active;
  if v_club is null then
    raise exception 'That team does not exist, or is not active.' using errcode = 'P0002';
  end if;
  perform internal.master_control_club(v_club, false);

  select rd.scope into v_scope from public.role_definitions rd where rd.role_key = p_role_key;
  if v_scope is null then
    raise exception 'That is not a role.' using errcode = '22023';
  end if;
  if v_scope not in ('TEAM','CLUB_OR_TEAM') then
    raise exception 'That role is not held at a team.' using errcode = '22023';
  end if;

  -- A team role needs a club membership to hang from, so one is created if missing. That is the
  -- "auto-creates club membership" in Q.3, and it is the canonical admission path, not an insert.
  perform internal.lock_club_people(v_club);
  select m.id into v_membership from public.club_memberships m
   where m.club_id = v_club and m.user_id = p_user_id and m.state = 'ACTIVE';
  if v_membership is null then
    v_membership := internal.admit_club_member(v_club, p_user_id, 'SITE_ADMIN_ASSIGNMENT', btrim(p_reason), null, null);
  end if;

  v_assignment := internal.grant_role(v_membership, p_role_key, p_team_id, 'SITE_ADMIN_ASSIGNMENT',
                                      btrim(p_reason), '{}'::jsonb);

  perform internal.emit_security_event('site.team_role_assigned', p_user_id, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('role_key', p_role_key, 'assignment_id', v_assignment),
                                       v_club, p_team_id, null);
  return v_assignment;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- A player's place in a team: add, end, or move. Delegates to the canonical player-team functions,
-- which carry the pathway and age-grade rules -- the ones that stop a child being placed somewhere the
-- governing body says they cannot play.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_set_player_team_membership(
  p_player_id uuid, p_team_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_existing uuid;
begin
  perform internal.master_control_preamble('site.team_roles.manage', p_reason, null);
  if p_action not in ('add','end','move') then
    raise exception 'A placement is add, end or move.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.players pl where pl.id = p_player_id) then
    raise exception 'That player does not exist.' using errcode = 'P0002';
  end if;

  select ptm.id into v_existing from public.player_team_memberships ptm
   where ptm.player_id = p_player_id and ptm.status = 'active' limit 1;

  if p_action = 'end' then
    if v_existing is null then
      raise exception 'That player has no active team place to end.' using errcode = '23514';
    end if;
    perform public.archive_player_team_membership(v_existing);
  elsif p_action = 'move' then
    if v_existing is null then
      raise exception 'That player has no active team place to move.' using errcode = '23514';
    end if;
    perform public.move_player_team_membership(v_existing, p_team_id, btrim(p_reason));
  else
    select t.club_id into v_club from public.teams t where t.id = p_team_id and t.active;
    if v_club is null then
      raise exception 'That team does not exist, or is not active.' using errcode = 'P0002';
    end if;
    -- The pathway rule belongs to the domain, not to master control.
    perform internal.assert_player_team_pathway_compatible(p_player_id, p_team_id);
    insert into public.player_team_memberships (player_id, team_id, status) values (p_player_id, p_team_id, 'active');
  end if;

  perform internal.emit_security_event('site.player_team_changed', null, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('player_id', p_player_id, 'action', p_action),
                                       v_club, p_team_id, p_player_id);
end $$;

-- =====================================================================================================
-- FAMILY
-- =====================================================================================================
create or replace function public.site_link_guardian(
  p_guardian_user_id uuid, p_player_id uuid, p_relationship_type text, p_reason text,
  p_verification_state text default 'SITE_VERIFIED')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_player_user uuid;
begin
  perform internal.master_control_preamble('site.family.manage', p_reason, p_guardian_user_id);
  perform internal.master_control_target(p_guardian_user_id);

  select pl.user_id into v_player_user from public.players pl where pl.id = p_player_id;
  if not found then
    raise exception 'That player does not exist.' using errcode = 'P0002';
  end if;
  -- Q.3: guardian is not the player's own user. A person is not their own guardian, and the family
  -- isolation model would have no meaning if they could be.
  if v_player_user is not null and v_player_user = p_guardian_user_id then
    raise exception 'A person cannot be their own guardian.' using errcode = '42501';
  end if;
  -- The vocabulary records WHO verified, not merely that somebody did. A Site Admin may attest their
  -- own check (SITE_VERIFIED) or record that no check has happened (UNVERIFIED); they may not assert
  -- that a club verified something the club never saw.
  if coalesce(p_verification_state,'SITE_VERIFIED') not in ('SITE_VERIFIED','UNVERIFIED') then
    raise exception 'A Site Admin records SITE_VERIFIED or UNVERIFIED -- a club''s verification is the club''s to record.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.guardians g
              where g.player_id = p_player_id and g.guardian_user_id = p_guardian_user_id
                and g.state in ('ACTIVE','PENDING_APPROVAL')) then
    raise exception 'That guardian relationship already exists.' using errcode = '23505';
  end if;

  insert into public.guardians (player_id, guardian_user_id, relationship_type, status, state,
                                source, created_by, verification_state, reason)
  values (p_player_id, p_guardian_user_id, coalesce(p_relationship_type,'parent'), 'active', 'ACTIVE',
          'SITE_ADMIN_ASSIGNMENT', auth.uid(), coalesce(p_verification_state,'SITE_VERIFIED'), btrim(p_reason))
  returning id into v_id;

  perform internal.emit_security_event('site.guardian_linked', p_guardian_user_id, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('relationship_id', v_id),
                                       null, null, p_player_id);
  return v_id;
end $$;

create or replace function public.site_end_guardian_relationship(p_relationship_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g public.guardians;
begin
  select * into v_g from public.guardians where id = p_relationship_id;
  if v_g.id is null then
    raise exception 'That guardian relationship does not exist.' using errcode = 'P0002';
  end if;
  perform internal.master_control_preamble('site.family.manage', p_reason, v_g.guardian_user_id);

  if v_g.state = 'REVOKED' then
    raise exception 'That relationship has already ended.' using errcode = '23514';
  end if;

  update public.guardians
     set state = 'REVOKED', status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revocation_reason = btrim(p_reason), updated_at = now(), updated_by = auth.uid()
   where id = p_relationship_id;

  perform internal.emit_security_event('site.guardian_unlinked', v_g.guardian_user_id, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('relationship_id', p_relationship_id),
                                       null, null, v_g.player_id);
end $$;

-- =====================================================================================================
-- IDENTITY AND PLATFORM ACCESS
-- =====================================================================================================
create or replace function public.site_set_account_state(p_user_id uuid, p_state text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- DISABLED is its own capability (Q.3): switching somebody off permanently is a bigger act than
  -- suspending them, and the profiles that may do each are deliberately different.
  perform internal.master_control_preamble(
    case when p_state = 'DISABLED' then 'site.users.disable' else 'site.users.security.manage' end,
    p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);

  if p_state not in ('ACTIVE','SUSPENDED','DISABLED') then
    raise exception 'An account is ACTIVE, SUSPENDED or DISABLED.' using errcode = '22023';
  end if;

  -- No emit_security_event here, deliberately.
  --
  -- public.profiles already carries the trigger internal.emit_profile_state_events, which fires on any
  -- account_state change and writes account.suspended / account.disabled / account.restored with
  -- new.state_reason as the reason. Emitting again from this RPC produced TWO audit lines for one act,
  -- and under a second name -- I had invented 'account.reinstated' for a transition the platform
  -- already calls 'account.restored'. Two names for one event is how an audit search quietly misses
  -- half of what it is looking for.
  --
  -- So the RPC's job is to supply what the trigger needs and let the one writer write: the reason it
  -- insisted on, and who is answerable for it.
  update public.profiles
     set account_state = p_state,
         state_reason = btrim(p_reason),
         state_changed_by = auth.uid(),
         state_changed_at = now()
   where id = p_user_id;
  if not found then
    raise exception 'That account does not exist.' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Ending somebody's sessions. Q.3 has the server call internal.revoke_all_sessions through the service
-- role after the RPC authorises; the RPC can do both itself, so there is no elevated client in the
-- request path at all (the same conclusion Slice 6 reached for recovery).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_revoke_sessions(p_user_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform internal.master_control_preamble('site.users.security.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);
  v_n := internal.revoke_all_sessions(p_user_id, null);
  perform internal.emit_security_event('session.revoked_by_admin', p_user_id, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('sessions_ended', v_n), null, null, null);
  return v_n;
end $$;

create or replace function public.site_force_password_reset(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform internal.master_control_preamble('site.users.security.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);

  -- L2: no Site Admin path ever sets, sees or chooses a password. This marks the account as needing a
  -- reset and ends its sessions; the person resets it themselves through the recovery flow.
  insert into public.account_security_state (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.account_security_state set must_reset_password = true, updated_at = now()
   where user_id = p_user_id;
  perform internal.revoke_all_sessions(p_user_id, null);

  perform internal.emit_security_event('account.password_reset_forced', p_user_id, 'SUCCESS', btrim(p_reason),
                                       '{}'::jsonb, null, null, null);
end $$;

create or replace function public.site_revoke_invitation(p_invitation_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform internal.master_control_preamble('site.invitations.manage', p_reason, null);
  -- Slice 5's canonical revocation, which re-decides authority itself.
  perform public.revoke_invitation(p_invitation_id, btrim(p_reason));
end $$;

revoke all on function public.site_assign_team_role(uuid,uuid,text,text) from public, anon;
revoke all on function public.site_set_player_team_membership(uuid,uuid,text,text) from public, anon;
revoke all on function public.site_link_guardian(uuid,uuid,text,text,text) from public, anon;
revoke all on function public.site_end_guardian_relationship(uuid,text) from public, anon;
revoke all on function public.site_set_account_state(uuid,text,text) from public, anon;
revoke all on function public.site_revoke_sessions(uuid,text) from public, anon;
revoke all on function public.site_force_password_reset(uuid,text) from public, anon;
revoke all on function public.site_revoke_invitation(uuid,text) from public, anon;
grant execute on function public.site_assign_team_role(uuid,uuid,text,text) to authenticated;
grant execute on function public.site_set_player_team_membership(uuid,uuid,text,text) to authenticated;
grant execute on function public.site_link_guardian(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.site_end_guardian_relationship(uuid,text) to authenticated;
grant execute on function public.site_set_account_state(uuid,text,text) to authenticated;
grant execute on function public.site_revoke_sessions(uuid,text) to authenticated;
grant execute on function public.site_force_password_reset(uuid,text) to authenticated;
grant execute on function public.site_revoke_invitation(uuid,text) to authenticated;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('site.team_role_assigned','SITE_ADMIN','CRITICAL',true,true,true),
       ('site.player_team_changed','SITE_ADMIN','WARNING',true,true,true),
       ('site.guardian_linked','SITE_ADMIN','CRITICAL',false,true,true),
       ('site.guardian_unlinked','SITE_ADMIN','CRITICAL',false,true,true),
       -- account.suspended / account.disabled / account.restored are NOT registered here: they
       -- already exist, and internal.emit_profile_state_events is the one writer of them.
       ('account.password_reset_forced','SITE_ADMIN','WARNING',false,true,true),
       ('session.revoked_by_admin','SITE_ADMIN','WARNING',false,true,true)
on conflict (event_type) do nothing;

do $$
declare v_missing text;
begin
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'site\_%'
     and p.proname in ('site_assign_team_role','site_set_player_team_membership','site_link_guardian',
                       'site_end_guardian_relationship','site_set_account_state','site_revoke_sessions',
                       'site_force_password_reset','site_revoke_invitation')
     and p.prosrc !~ 'master_control_preamble';
  if v_missing is not null then
    raise exception 'Slice 7: these master-control RPCs skip the preamble: %', v_missing;
  end if;
  raise notice 'Slice 7: team, family and platform master control';
end $$;
