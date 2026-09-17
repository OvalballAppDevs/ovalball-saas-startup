-- =====================================================================================================
-- SLICE 7 (1/n) -- master control, and the four lines every one of them starts with (Phase 2 Q.1, Q.3)
--
-- Q.1 is the whole argument in one sentence: Site Admin authority is a set of explicit `site.*`
-- capabilities evaluated at SITE scope, and master-control operations are dedicated SECURITY DEFINER
-- RPCs that deliberately write lower-scope canonical records. THEY ARE NOT A POLICY BYPASS.
--
-- The difference matters. A Site Admin does not get to read a club's data because they are a Site
-- Admin; they get to perform a NAMED operation, for a NAMED reason, against a NAMED target, recorded.
-- That is why these are functions rather than a branch inside every policy -- and it is why Slice 7
-- can then take `is_site_admin()` out of the policies entirely (7d) without anybody losing the
-- authority they legitimately had.
--
-- Q.3 fixes the preamble, and it is written once here rather than copied twenty times:
--
--     require_site_capability  -- session_ok + the site capability + not impersonating
--     require_recent_aal2      -- a TOTP code within ten minutes (R)
--     require_reason           -- trimmed length >= 10
--     refuse_self_target       -- where applicable
--
-- and every one ends with a security event. An operation that cannot say WHO, WHAT, WHICH SUBJECT and
-- WHY is not master control; it is a bypass with better manners.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- The one missing piece of the preamble. Slice 6 built the predicate; this is the raising wrapper.
--
-- It refuses when the session has not verified a code recently -- NOT when the person has no
-- authenticator. Those are different: at T0 nobody has enrolled, so demanding R unconditionally would
-- make every master-control operation impossible on the day it shipped. internal.recent_aal2 returns
-- true for a session with no session_id (the service role and the test harness), and for a real
-- browser session it returns true only on a recent totp entry -- which is exactly the behaviour that
-- starts biting the moment somebody enrols, and not before.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.require_recent_aal2(p_within interval default interval '10 minutes')
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.recent_aal2(greatest(1, (extract(epoch from p_within) / 60)::int)) then
    raise exception 'Enter a code from your authenticator to continue.' using errcode = '42501';
  end if;
end $$;

comment on function internal.require_recent_aal2(interval) is
  'Phase 2 Q.3 preamble. Refuses unless this session verified a TOTP code within the window (R). '
  'Holding AAL2 is not the same as having just proved it, and master control wants the second thing.';

revoke all on function internal.require_recent_aal2(interval) from public, anon;
grant execute on function internal.require_recent_aal2(interval) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The preamble itself, so twenty RPCs cannot drift from each other.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.master_control_preamble(
  p_capability text, p_reason text, p_target_user_id uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  -- session_ok (live session, usable account, AAL where enforced), the site capability at SITE scope,
  -- and a refusal while impersonating. All three live in require_site_capability already.
  perform internal.require_site_capability(p_capability);
  perform internal.require_recent_aal2(interval '10 minutes');
  perform internal.require_reason(p_reason, true);
  -- Q.3 asks for a trimmed length of at least ten. internal.require_reason enforces "not empty" and a
  -- 500-character ceiling, which is right for the rest of the product; the MINIMUM is a master-control
  -- rule and belongs here rather than being imposed on every other caller of that helper.
  --
  -- Ten characters is not arbitrary. "revoked", "cleanup" and "asked to" are not explanations, and the
  -- audit line is read later by somebody who was not in the room.
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a fuller reason -- at least ten characters, so the record makes sense later.'
      using errcode = '22023';
  end if;
  if p_target_user_id is not null then
    -- No self-target for grants, links, suspensions and Site Admin changes (Q.3). An administrator
    -- acting on their own authority is the thing the two-person rule exists to prevent.
    perform internal.refuse_self_target(p_target_user_id);
  end if;
end $$;

revoke all on function internal.master_control_preamble(text, text, uuid) from public, anon;
grant execute on function internal.master_control_preamble(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Shared validation (Q.3 "Validation shared by all").
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.master_control_target(p_user_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'That person does not have an Ovalball identity.' using errcode = 'P0002';
  end if;
end $$;
revoke all on function internal.master_control_target(uuid) from public, anon;
grant execute on function internal.master_control_target(uuid) to authenticated;

-- A club has to exist. An INACTIVE club is allowed only for the operations that wind something down.
create or replace function internal.master_control_club(p_club_id uuid, p_allow_inactive boolean default false)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_status text;
begin
  select c.status into v_status from public.clubs c where c.id = p_club_id;
  if v_status is null then
    raise exception 'That club does not exist.' using errcode = 'P0002';
  end if;
  if v_status <> 'active' and not p_allow_inactive then
    raise exception 'That club is not active.' using errcode = '42501';
  end if;
end $$;
revoke all on function internal.master_control_club(uuid, boolean) from public, anon;
grant execute on function internal.master_control_club(uuid, boolean) to authenticated;

-- =====================================================================================================
-- CLUB master control
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- Put somebody into a club. No invitation, no pre-existing relationship: that is the POINT of master
-- control, and it is why it is audited rather than convenient.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_add_club_membership(p_user_id uuid, p_club_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_membership uuid;
begin
  perform internal.master_control_preamble('site.memberships.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);
  perform internal.master_control_club(p_club_id, false);

  perform internal.lock_club_people(p_club_id);
  -- The CANONICAL admission path, not an insert. Everything it enforces -- terminal states staying
  -- terminal, the partial unique index, the MEMBER role -- applies to a Site Admin exactly as it
  -- applies to a club.
  v_membership := internal.admit_club_member(p_club_id, p_user_id, 'SITE_ADMIN_ASSIGNMENT',
                                             btrim(p_reason), null, null);

  perform internal.emit_security_event('site.membership_added', p_user_id, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('membership_id', v_membership),
                                       p_club_id, null, null);
  return v_membership;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Move a membership between states, through the canonical machine (M.1), marking it a SITE-level
-- action so a club cannot later undo something Ovalball did.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_transition_club_membership(
  p_membership_id uuid, p_to_state text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_m public.club_memberships;
begin
  select * into v_m from public.club_memberships where id = p_membership_id;
  if v_m.id is null then
    raise exception 'That membership does not exist.' using errcode = 'P0002';
  end if;

  perform internal.master_control_preamble('site.memberships.manage', p_reason, v_m.user_id);
  -- Winding something down is allowed even for an inactive club; adding to one is not.
  perform internal.master_control_club(v_m.club_id, p_to_state in ('SUSPENDED','REVOKED'));

  if p_to_state not in ('ACTIVE','SUSPENDED','REVOKED') then
    raise exception 'A membership moves to ACTIVE, SUSPENDED or REVOKED.' using errcode = '22023';
  end if;

  -- Delegates to the CANONICAL transition rather than writing the row. That function derives the
  -- authority level itself from internal.club_people_authority -- which already returns SITE from the
  -- canonical site capability, not from is_site_admin -- so a suspension made here is marked SITE and
  -- a club-level actor cannot lift it afterwards. Re-implementing any of that here would be a second
  -- state machine with the same name.
  perform internal.lock_club_people(v_m.club_id);
  perform public.transition_club_membership(p_membership_id, p_to_state, btrim(p_reason), false);

  perform internal.emit_security_event('site.membership_transitioned', v_m.user_id, 'SUCCESS',
                                       btrim(p_reason),
                                       jsonb_build_object('membership_id', p_membership_id, 'to_state', p_to_state),
                                       v_m.club_id, null, null);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Give somebody a club role, creating the membership if they have none.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_assign_club_role(
  p_user_id uuid, p_club_id uuid, p_role_key text, p_reason text, p_attributes jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_membership uuid;
  v_assignment uuid;
  v_scope text;
begin
  perform internal.master_control_preamble('site.club_roles.manage', p_reason, p_user_id);
  perform internal.master_control_target(p_user_id);
  perform internal.master_control_club(p_club_id, false);

  select rd.scope into v_scope from public.role_definitions rd where rd.role_key = p_role_key;
  if v_scope is null then
    raise exception 'That is not a role.' using errcode = '22023';
  end if;
  if v_scope = 'TEAM' then
    raise exception 'That role is held at a team. Use the team assignment instead.' using errcode = '22023';
  end if;

  perform internal.lock_club_people(p_club_id);
  select m.id into v_membership from public.club_memberships m
   where m.club_id = p_club_id and m.user_id = p_user_id and m.state = 'ACTIVE';
  if v_membership is null then
    v_membership := internal.admit_club_member(p_club_id, p_user_id, 'SITE_ADMIN_ASSIGNMENT',
                                               btrim(p_reason), null, null);
  end if;

  -- grant_role carries the minor prohibition, the D-S5-1 age gate, the SAFEGUARDING_OFFICER
  -- PENDING_CONFIRMATION rule and the scope checks. A Site Admin does not get past any of them.
  v_assignment := internal.grant_role(v_membership, p_role_key, null, 'SITE_ADMIN_ASSIGNMENT',
                                      btrim(p_reason), coalesce(p_attributes, '{}'::jsonb));

  perform internal.emit_security_event('site.club_role_assigned', p_user_id, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('role_key', p_role_key, 'assignment_id', v_assignment),
                                       p_club_id, null, null);
  return v_assignment;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Take a role away, through the canonical transition, which carries the last-Club-Admin guard.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_revoke_role_assignment(
  p_assignment_id uuid, p_reason text, p_allow_no_club_admin boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ra public.role_assignments; v_user uuid; v_key text;
begin
  select * into v_ra from public.role_assignments where id = p_assignment_id;
  if v_ra.id is null then
    raise exception 'That role assignment does not exist.' using errcode = 'P0002';
  end if;
  select m.user_id into v_user from public.club_memberships m where m.id = v_ra.membership_id;

  -- Team roles are a different capability from club roles, and the distinction is the point.
  select case when rd.scope = 'TEAM' then 'site.team_roles.manage' else 'site.club_roles.manage' end
    into v_key from public.role_definitions rd where rd.role_key = v_ra.role_key;

  perform internal.master_control_preamble(coalesce(v_key, 'site.club_roles.manage'), p_reason, v_user);
  perform internal.lock_club_people(v_ra.club_id);
  perform public.transition_role_assignment(p_assignment_id, 'REVOKED', btrim(p_reason),
                                            coalesce(p_allow_no_club_admin, false));

  perform internal.emit_security_event('site.role_revoked', v_user, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('assignment_id', p_assignment_id,
                                                          'role_key', v_ra.role_key,
                                                          'last_admin_override', coalesce(p_allow_no_club_admin,false)),
                                       v_ra.club_id, v_ra.team_id, null);
end $$;

revoke all on function public.site_add_club_membership(uuid,uuid,text) from public, anon;
revoke all on function public.site_transition_club_membership(uuid,text,text) from public, anon;
revoke all on function public.site_assign_club_role(uuid,uuid,text,text,jsonb) from public, anon;
revoke all on function public.site_revoke_role_assignment(uuid,text,boolean) from public, anon;
grant execute on function public.site_add_club_membership(uuid,uuid,text) to authenticated;
grant execute on function public.site_transition_club_membership(uuid,text,text) to authenticated;
grant execute on function public.site_assign_club_role(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.site_revoke_role_assignment(uuid,text,boolean) to authenticated;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('site.membership_added','SITE_ADMIN','WARNING',true,true,true),
       ('site.membership_transitioned','SITE_ADMIN','WARNING',true,true,true),
       ('site.club_role_assigned','SITE_ADMIN','CRITICAL',true,true,true),
       ('site.role_revoked','SITE_ADMIN','CRITICAL',true,true,true)
on conflict (event_type) do nothing;

do $$
declare v_missing text;
begin
  -- Every master-control RPC must carry the preamble. One that does not is a bypass.
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('site_add_club_membership','site_transition_club_membership',
                                                'site_assign_club_role','site_revoke_role_assignment')
     and p.prosrc !~ 'master_control_preamble';
  if v_missing is not null then
    raise exception 'Slice 7: these master-control RPCs skip the preamble: %', v_missing;
  end if;
  raise notice 'Slice 7: club master control, with one preamble and no policy bypass';
end $$;
