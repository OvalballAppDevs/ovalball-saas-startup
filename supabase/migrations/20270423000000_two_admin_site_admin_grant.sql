-- =====================================================================================================
-- SLICE 7c -- A SITE ADMIN GRANT TAKES TWO PEOPLE
--
-- public.site_admin_grant_requests already existed, with exactly the right constraints: the decider
-- cannot be the requester, the decider cannot be the target, nobody may request themselves, and a
-- request expires after 72 hours. It had no RPCs and nothing consulted it. It was a table waiting for
-- a rule.
--
-- Meanwhile there were THREE ways one person could make somebody a Site Admin single-handed:
--
--   1. insert into public.site_admins -- the RLS policy allowed it for site.admins.manage;
--   2. insert into public.site_admin_invitations, then the invitee calls accept_site_admin_invitation,
--      which inserts the row for them;
--   3. a Slice 5 invitation of kind SITE_ADMIN, redeemed through public.redeem_invitation.
--
-- A two-admin rule enforced in one of three doors is not a rule. So the gate is put where all three
-- converge -- the site_admins row itself -- rather than on the doors:
--
--   internal.apply_site_admin_grant() is the ONLY thing that makes somebody an active Site Admin, and
--   it refuses unless it can find and consume an APPROVED grant request naming that person and that
--   profile.
--
-- Direct writes to public.site_admins are then closed to every browser role, because a rule that a
-- SECURITY DEFINER function enforces is worth nothing while the caller can write the table instead.
--
-- AN-3, UNRESOLVED AND DELIBERATELY SO
--
-- Production has one Full Site Admin. The decider-is-not-the-requester constraint therefore means no
-- new Site Admin can be granted in production until a second Full Site Admin exists by some other
-- route. That is the correct behaviour and it is not weakened here: the alternative is a bypass for
-- the exact situation the rule exists to cover. It is recorded, not worked around.
--
-- Revocation deliberately needs only ONE administrator. Removing authority is the safe direction, and
-- requiring two people to stop somebody is how an incident gets worse while a form is filled in. The
-- last-Full-Site-Admin lockout trigger still applies underneath.
-- =====================================================================================================

alter table public.site_admin_grant_requests drop constraint if exists site_admin_grant_requests_state_check;
alter table public.site_admin_grant_requests add constraint site_admin_grant_requests_state_check
  check (state in ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED','CONSUMED'));

comment on column public.site_admin_grant_requests.state is
  'PENDING -> APPROVED -> CONSUMED is the successful path. CONSUMED means the grant has been applied to '
  'public.site_admins; an APPROVED request that has not been consumed still authorises exactly one grant, '
  'and a CONSUMED one authorises none, so an approval cannot be replayed.';

-- =====================================================================================================
-- THE GATE
-- =====================================================================================================
create or replace function internal.apply_site_admin_grant(p_user_id uuid, p_profile_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.site_admin_grant_requests;
begin
  -- for update: two approvals racing for the same request must not both apply it. AH.
  select * into v_req
    from public.site_admin_grant_requests
   where target_user_id = p_user_id and profile_key = p_profile_key
     and state = 'APPROVED' and expires_at > now()
   order by decided_at desc
   for update skip locked
   limit 1;

  if v_req.id is null then
    raise exception 'Making somebody a Site Admin needs a second Full Site Admin to approve it first. Raise a grant request and have a colleague approve it.'
      using errcode = '42501';
  end if;

  update public.site_admin_grant_requests set state = 'CONSUMED' where id = v_req.id;

  -- The insert is what the after-change trigger turns into site_admin.granted; this function does not
  -- emit its own event, because that trigger is already the one writer of it.
  insert into public.site_admins (user_id, profile_key, status, granted_by)
  values (p_user_id, p_profile_key, 'active', v_req.decided_by)
  on conflict (user_id) do update set
    profile_key = excluded.profile_key,
    status = 'active',
    granted_by = excluded.granted_by,
    granted_at = now(),
    revoked_by = null,
    revoked_at = null;
end $$;

-- =====================================================================================================
-- THE TWO HALVES
-- =====================================================================================================
create or replace function public.site_request_site_admin_grant(
  p_target_user_id uuid, p_profile_key text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform internal.master_control_preamble('site.admins.manage', p_reason, p_target_user_id);
  perform internal.master_control_target(p_target_user_id);

  if not exists (select 1 from public.capability_bundles b
                  where b.bundle_key = p_profile_key and b.bundle_key like 'SITE\_%') then
    raise exception 'That is not a Site Admin profile.' using errcode = '22023';
  end if;
  if exists (select 1 from public.site_admins sa
              where sa.user_id = p_target_user_id and sa.status = 'active'
                and sa.profile_key = p_profile_key) then
    raise exception 'They already hold that Site Admin profile.' using errcode = '23505';
  end if;
  if exists (select 1 from public.site_admin_grant_requests r
              where r.target_user_id = p_target_user_id and r.state in ('PENDING','APPROVED')
                and r.expires_at > now()) then
    raise exception 'There is already an open grant request for that person.' using errcode = '23505';
  end if;

  insert into public.site_admin_grant_requests (target_user_id, profile_key, requested_by, reason)
  values (p_target_user_id, p_profile_key, auth.uid(), btrim(p_reason))
  returning id into v_id;

  perform internal.emit_security_event('site_admin.grant_requested', p_target_user_id, 'SUCCESS', btrim(p_reason),
    jsonb_build_object('request_id', v_id, 'profile_key', p_profile_key), null, null, null);
  return v_id;
end $$;

create or replace function public.site_approve_site_admin_grant(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.site_admin_grant_requests;
begin
  select * into v_req from public.site_admin_grant_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'That grant request does not exist.' using errcode = 'P0002';
  end if;

  perform internal.master_control_preamble('site.admins.manage', p_reason, v_req.target_user_id);

  -- The two-person rule, stated here as well as in the table's CHECK constraints. The constraints are
  -- the guarantee; this is the sentence the administrator reads.
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

-- =====================================================================================================
-- REVOCATION AND PROFILE CHANGE
-- =====================================================================================================
create or replace function public.site_revoke_site_admin(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform internal.master_control_preamble('site.admins.manage', p_reason, p_user_id);

  if not exists (select 1 from public.site_admins where user_id = p_user_id and status = 'active') then
    raise exception 'They are not an active Site Admin.' using errcode = '23514';
  end if;

  -- prevent_last_full_admin_lockout fires underneath this and refuses to leave Ovalball with no
  -- recoverable administrator. It is not repeated here: one guard, at the row.
  update public.site_admins
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
   where user_id = p_user_id;

  -- Authority ends now, not at the end of their session. AI: a revoked administrator holding a live
  -- session is exactly the case a capability check alone does not cover.
  perform internal.revoke_all_sessions(p_user_id, null);

  perform internal.emit_security_event('site_admin.revoked_with_reason', p_user_id, 'SUCCESS', btrim(p_reason),
    '{}'::jsonb, null, null, null);
end $$;

create or replace function public.site_change_site_admin_profile(p_user_id uuid, p_profile_key text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_current text;
begin
  perform internal.master_control_preamble('site.admins.manage', p_reason, p_user_id);

  select profile_key into v_current from public.site_admins where user_id = p_user_id and status = 'active';
  if v_current is null then
    raise exception 'They are not an active Site Admin.' using errcode = '23514';
  end if;
  if v_current = p_profile_key then
    raise exception 'They already hold that profile.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.capability_bundles b
                  where b.bundle_key = p_profile_key and b.bundle_key like 'SITE\_%') then
    raise exception 'That is not a Site Admin profile.' using errcode = '22023';
  end if;

  -- Moving somebody UP TO Full is a grant of the authority this whole rule exists to protect, so it
  -- goes through the two-admin flow like any other. Moving them down, or sideways between narrower
  -- profiles, is a reduction or a lateral change and one administrator may do it -- the same asymmetry
  -- as revocation, and for the same reason.
  if p_profile_key = 'SITE_FULL' then
    perform internal.apply_site_admin_grant(p_user_id, 'SITE_FULL');
    return;
  end if;

  update public.site_admins set profile_key = p_profile_key where user_id = p_user_id;
end $$;

-- =====================================================================================================
-- CLOSING THE OTHER TWO DOORS
-- =====================================================================================================
do $$
declare v_def text;
begin
  -- accept_site_admin_invitation: keeps every check it had (token, status, expiry, matching email) and
  -- then asks the gate instead of inserting the row itself.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_site_admin_invitation';
  if v_def !~ 'apply_site_admin_grant' then
    v_def := regexp_replace(v_def,
      'insert into public\.site_admins \(user_id, admin_role, status, granted_by\)(.|\n)*?;(\s*\n)',
      'perform internal.apply_site_admin_grant(auth.uid(), internal.site_profile_for_admin_role(v_inv.admin_role));' || chr(10),
      '');
    execute v_def;
  end if;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_invitation';
  if v_def !~ 'apply_site_admin_grant' then
    v_def := replace(v_def,
      $x$    insert into public.site_admins (user_id, status, admin_role)
    values (v_actor, 'active', coalesce(v.intended_outcome->>'admin_role','read_only'))
    on conflict (user_id) do update set status = 'active';$x$,
      $x$    perform internal.apply_site_admin_grant(
      v_actor, internal.site_profile_for_admin_role(coalesce(v.intended_outcome->>'admin_role','read_only')));$x$);
    execute v_def;
  end if;
end $$;

-- =====================================================================================================
-- AND THE FRONT DOOR. No browser role writes public.site_admins directly any more.
-- =====================================================================================================
drop policy if exists site_admins_insert_full_admin on public.site_admins;
drop policy if exists site_admins_update_full_admin on public.site_admins;
drop policy if exists site_admins_delete_full_admin on public.site_admins;
revoke insert, update, delete on public.site_admins from authenticated, anon;

-- The invitation table goes the same way: issuing one was the second single-handed route.
drop policy if exists site_admin_invitations_insert_full_admin on public.site_admin_invitations;
revoke insert on public.site_admin_invitations from authenticated, anon;

revoke insert, update, delete on public.site_admin_grant_requests from authenticated, anon;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('site_admin.grant_requested','SITE_ADMIN','CRITICAL',false,true,true),
       ('site_admin.grant_approved','SITE_ADMIN','CRITICAL',false,true,true),
       ('site_admin.grant_rejected','SITE_ADMIN','WARNING',false,true,true),
       ('site_admin.revoked_with_reason','SITE_ADMIN','CRITICAL',false,true,true)
on conflict (event_type) do nothing;

revoke all on function public.site_request_site_admin_grant(uuid,text,text) from public, anon;
revoke all on function public.site_approve_site_admin_grant(uuid,text) from public, anon;
revoke all on function public.site_reject_site_admin_grant(uuid,text) from public, anon;
revoke all on function public.site_revoke_site_admin(uuid,text) from public, anon;
revoke all on function public.site_change_site_admin_profile(uuid,text,text) from public, anon;
revoke all on function internal.apply_site_admin_grant(uuid,text) from public, anon, authenticated;
grant execute on function public.site_request_site_admin_grant(uuid,text,text) to authenticated;
grant execute on function public.site_approve_site_admin_grant(uuid,text) to authenticated;
grant execute on function public.site_reject_site_admin_grant(uuid,text) to authenticated;
grant execute on function public.site_revoke_site_admin(uuid,text) to authenticated;
grant execute on function public.site_change_site_admin_profile(uuid,text,text) to authenticated;

do $$
declare v_bad text;
begin
  if exists (select 1 from pg_policies where tablename = 'site_admins' and cmd in ('INSERT','UPDATE','DELETE')) then
    raise exception 'Slice 7c: a browser role can still write public.site_admins directly';
  end if;
  if has_table_privilege('authenticated','public.site_admins','INSERT')
     or has_table_privilege('authenticated','public.site_admins','UPDATE')
     or has_table_privilege('authenticated','public.site_admins','DELETE') then
    raise exception 'Slice 7c: authenticated still holds a write grant on public.site_admins';
  end if;

  select string_agg(n.nspname||'.'||p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal')
     and p.prosrc ~ 'insert\s+into\s+public\.site_admins'
     and p.proname <> 'apply_site_admin_grant';
  if v_bad is not null then
    raise exception 'Slice 7c: these still insert into site_admins without the two-admin gate: %', v_bad;
  end if;

  raise notice 'Slice 7c: a Site Admin grant takes two people, by every route';
end $$;
