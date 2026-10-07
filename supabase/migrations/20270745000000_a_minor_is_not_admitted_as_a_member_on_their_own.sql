-- =====================================================================================================
-- A MINOR IS NOT ADMITTED AS A CLUB MEMBER ON THEIR OWN (2026-10-06)
--
-- The people and admission audit of 5-6 October 2026 (finding H1, F1-03) proved that the server would admit
-- a minor as a club Member with no guardian involved. A team code used with no subject -- or "Just Me, as a
-- Member" -- and request_club_membership both opened a club join request with no age check, and
-- decide_club_join_request admitted whoever had asked. Only the screens kept a minor away: the join flow
-- never offers a minor the member choice ("Ask your parent or guardian to use this code for you").
--
-- The rule the screens already follow is now the server's, at the one place every member request is
-- written: a join request from a minor is refused, whichever door it came through, with the sentence the
-- person reads. A request already waiting from before cannot be approved into a membership (it can be
-- declined). A minor still joins a TEAM the way the product intends: their own place request, which their
-- parent or guardian confirms, or a parent asking for them.
--
-- "Minor" is the capability engine's one answer, internal.person_is_minor: a recorded date of birth (profile
-- or linked player) under 18. An unknown date of birth is not treated as a minor, exactly as everywhere else.
--
-- Tests: supabase/tests/admission_journeys.sql (JC6-JC8).
-- =====================================================================================================

create or replace function internal.club_join_request_refuses_a_minor()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if internal.person_is_minor(new.requesting_user_id) then
    raise exception 'Under-18s don''t join a club as a member on their own. Ask your parent or guardian to use the club''s code for you.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function internal.club_join_request_refuses_a_minor() from public, anon, authenticated;

drop trigger if exists club_join_requests_refuse_minor_member on public.club_join_requests;
create trigger club_join_requests_refuse_minor_member
  before insert on public.club_join_requests
  for each row execute function internal.club_join_request_refuses_a_minor();

CREATE OR REPLACE FUNCTION public.decide_club_join_request(p_request_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid;
  v_request public.club_join_requests;
  v_level text;
  v_reason text;
  v_membership_id uuid;
  v_pending public.club_memberships;
  v_prev text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_decision not in ('APPROVE', 'DECLINE') then
    raise exception 'A join request is approved or declined.' using errcode = '22023';
  end if;
  select club_id into v_club from public.club_join_requests where id = p_request_id;
  if v_club is null then
    raise exception 'Join request not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_request from public.club_join_requests where id = p_request_id for update;

  v_level := internal.club_people_authority(v_club);
  if v_level is null then
    raise exception 'Only that club''s admin or a Site Admin may decide a join request.' using errcode = '42501';
  end if;
  if v_request.requesting_user_id = auth.uid() then
    raise exception 'You cannot decide your own join request.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This join request has already been decided.' using errcode = '23514';
  end if;
  v_reason := internal.require_reason(p_reason, p_decision = 'DECLINE' or v_level = 'SITE');

  if p_decision = 'APPROVE' then
    -- A MINOR IS NOT ADMITTED AS A MEMBER ON THEIR OWN (20270745000000). A request a minor made before the
    -- table refused them can still be declined, but never approved into a club membership.
    if internal.person_is_minor(v_request.requesting_user_id) then
      raise exception 'This person is under 18, so they can''t be admitted as a member on their own. Decline the request: their parent or guardian can ask for a place on a team for them.'
        using errcode = '23514';
    end if;
    v_membership_id := internal.admit_club_member(v_club, v_request.requesting_user_id, 'JOIN_REQUEST', v_reason, null, p_request_id);
    update public.club_join_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), review_notes = v_reason
    where id = p_request_id;
    insert into public.notifications (user_id, type, title, body, data)
    values (v_request.requesting_user_id, 'club_claim_approved', 'Club access approved',
            'Your request to join has been approved.',
            jsonb_build_object('club_id', v_club, 'join_request_id', p_request_id));
    return v_membership_id;
  end if;

  select * into v_pending from public.club_memberships
  where club_id = v_club and user_id = v_request.requesting_user_id and state = 'PENDING'
  for update;
  if v_pending.id is not null then
    v_prev := internal.membership_sync_on();
    update public.club_memberships
    set state = 'DECLINED', reason = v_reason, updated_by = auth.uid()
    where id = v_pending.id;
    perform internal.membership_sync_restore(v_prev);
  end if;
  update public.club_join_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), review_notes = v_reason
  where id = p_request_id;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_request.requesting_user_id, 'club_claim_rejected', 'Club access request update',
          'Your request to join was not approved this time.',
          jsonb_build_object('join_request_id', p_request_id));
  perform internal.emit_security_event('membership.declined', v_request.requesting_user_id, 'SUCCESS', v_reason,
    jsonb_build_object('membership_id', v_pending.id, 'join_request_id', p_request_id, 'authority_level', v_level),
    v_club, null, null);
  return null;
end;
$function$;
