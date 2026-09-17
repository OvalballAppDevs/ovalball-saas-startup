-- =====================================================================================================
-- SLICE 7 -- AUTHORISE BEFORE YOU LOOK ANYTHING UP
--
-- Found by supabase/tests/site_admin_profile_matrix.sql, which is the point of writing that suite
-- generically rather than as a list. It calls every master-control RPC with NULL arguments as a Read
-- Only Site Admin, a Message Moderator, a Club Admin and an ordinary member, and expects 42501 from
-- all of them -- because Q.3 fixes the preamble as the FIRST thing each RPC does, so an unauthorised
-- caller should be refused before any argument is looked at.
--
-- Five of the twenty returned P0002 instead:
--
--   site_transition_club_membership, site_revoke_role_assignment, site_end_guardian_relationship,
--   site_approve_site_admin_grant, site_reject_site_admin_grant
--
-- Each one loaded the record it was asked about and raised "that does not exist" BEFORE checking
-- whether the caller was allowed to ask. With a NULL id that is harmless. With a guessed id it is an
-- existence oracle: an ordinary club member calling site_transition_club_membership in a loop learns
-- which membership ids are real, and gets a different answer for ids that are not -- without ever
-- holding a single site capability.
--
-- I wrote three of the five that way myself, and for a reason that felt necessary at the time: the
-- preamble wants the TARGET USER, and the target user is on the record. The answer is that the
-- preamble does three things that need no record at all -- the capability, the recent authenticator
-- code and the reason -- and exactly one that does. So it is split: everything that can be decided
-- about the caller is decided first, the record is loaded second, and the self-target rule is applied
-- third, once there is something to compare against.
--
-- site_revoke_role_assignment is the awkward one, because WHICH capability it needs is itself derived
-- from the record: a team role wants site.team_roles.manage and a club role wants
-- site.club_roles.manage. It now refuses anybody holding NEITHER before the lookup, and then applies
-- the specific one afterwards. A caller who holds one of the two learns that the assignment exists,
-- which they were always entitled to know.
-- =====================================================================================================

create or replace function internal.master_control_caller_gate(p_capabilities text[], p_reason text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_key text; v_ok boolean := false;
begin
  -- Everything that can be decided about the CALLER, before the request names anything.
  foreach v_key in array p_capabilities loop
    if internal.has_site_capability(v_key) then v_ok := true; exit; end if;
  end loop;
  if not v_ok then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  perform internal.require_recent_aal2(interval '10 minutes');
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a fuller reason -- at least ten characters, so the record makes sense later.'
      using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The five, re-created with the lookup moved after the gate.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.site_transition_club_membership(
  p_membership_id uuid, p_to_state text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_m public.club_memberships;
begin
  perform internal.master_control_caller_gate(array['site.memberships.manage'], p_reason);

  if p_to_state not in ('ACTIVE','SUSPENDED','REVOKED') then
    raise exception 'A membership moves to ACTIVE, SUSPENDED or REVOKED.' using errcode = '22023';
  end if;

  select * into v_m from public.club_memberships where id = p_membership_id;
  if v_m.id is null then
    raise exception 'That membership does not exist.' using errcode = 'P0002';
  end if;

  perform internal.master_control_preamble('site.memberships.manage', p_reason, v_m.user_id);
  -- Winding something down is allowed even for an inactive club; adding to one is not.
  perform internal.master_control_club(v_m.club_id, p_to_state in ('SUSPENDED','REVOKED'));

  -- Delegates to the CANONICAL transition rather than writing the row. That function derives the
  -- authority level itself from internal.club_people_authority, so a suspension made here is marked
  -- SITE and a club-level actor cannot lift it afterwards.
  perform internal.lock_club_people(v_m.club_id);
  perform public.transition_club_membership(p_membership_id, p_to_state, btrim(p_reason), false);

  perform internal.emit_security_event('site.membership_transitioned', v_m.user_id, 'SUCCESS', btrim(p_reason),
                                       jsonb_build_object('membership_id', p_membership_id, 'to_state', p_to_state),
                                       v_m.club_id, null, null);
end $$;

create or replace function public.site_revoke_role_assignment(
  p_assignment_id uuid, p_reason text, p_allow_no_club_admin boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ra public.role_assignments; v_user uuid; v_key text;
begin
  -- Which capability this needs depends on the assignment, so the gate asks for EITHER first.
  -- Somebody holding neither is refused without learning whether the assignment is real.
  perform internal.master_control_caller_gate(
    array['site.club_roles.manage','site.team_roles.manage'], p_reason);

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

create or replace function public.site_end_guardian_relationship(p_relationship_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g public.guardians;
begin
  perform internal.master_control_caller_gate(array['site.family.manage'], p_reason);

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

create or replace function public.site_approve_site_admin_grant(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.site_admin_grant_requests;
begin
  perform internal.master_control_caller_gate(array['site.admins.manage'], p_reason);

  select * into v_req from public.site_admin_grant_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'That grant request does not exist.' using errcode = 'P0002';
  end if;

  perform internal.master_control_preamble('site.admins.manage', p_reason, v_req.target_user_id);

  if v_req.requested_by = auth.uid() then
    raise exception 'A Site Admin grant has to be approved by somebody other than the person who asked for it.'
      using errcode = '42501';
  end if;
  if v_req.target_user_id = auth.uid() then
    raise exception 'You cannot approve your own Site Admin access.' using errcode = '42501';
  end if;
  if v_req.state <> 'PENDING' then
    raise exception 'That request has already been decided.' using errcode = '23514';
  end if;
  if v_req.expires_at <= now() then
    update public.site_admin_grant_requests set state = 'EXPIRED' where id = p_request_id;
    raise exception 'That request has expired. Raise a fresh one if it is still wanted.' using errcode = '23514';
  end if;

  update public.site_admin_grant_requests
     set state = 'APPROVED', decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
   where id = p_request_id;

  perform internal.apply_site_admin_grant(v_req.target_user_id, v_req.profile_key);

  perform internal.emit_security_event('site_admin.grant_approved', v_req.target_user_id, 'SUCCESS', btrim(p_reason),
    jsonb_build_object('request_id', p_request_id, 'profile_key', v_req.profile_key,
                       'requested_by', v_req.requested_by), null, null, null);
end $$;

create or replace function public.site_reject_site_admin_grant(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.site_admin_grant_requests;
begin
  perform internal.master_control_caller_gate(array['site.admins.manage'], p_reason);

  select * into v_req from public.site_admin_grant_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'That grant request does not exist.' using errcode = 'P0002';
  end if;
  perform internal.master_control_preamble('site.admins.manage', p_reason, null);
  if v_req.state <> 'PENDING' then
    raise exception 'That request has already been decided.' using errcode = '23514';
  end if;

  update public.site_admin_grant_requests
     set state = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
   where id = p_request_id;

  perform internal.emit_security_event('site_admin.grant_rejected', v_req.target_user_id, 'SUCCESS', btrim(p_reason),
    jsonb_build_object('request_id', p_request_id), null, null, null);
end $$;

revoke all on function internal.master_control_caller_gate(text[], text) from public, anon, authenticated;

do $$
declare v_bad text;
begin
  -- Every master-control RPC must gate the caller before it loads anything. Checked structurally,
  -- because the behavioural version of this assertion lives in site_admin_profile_matrix.sql and a
  -- migration cannot easily impersonate five personas.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'site\_%'
     and p.prosrc ~ 'master_control_preamble'
     -- The first authority call in the body has to be a gate or the preamble itself, not a select.
     and substring(p.prosrc from 'master_control_caller_gate|master_control_preamble|select\s') = 'select ';
  if v_bad is not null then
    raise exception 'Slice 7: these look a record up before authorising the caller: %', v_bad;
  end if;
  raise notice 'Slice 7: master control authorises the caller before it looks anything up';
end $$;
