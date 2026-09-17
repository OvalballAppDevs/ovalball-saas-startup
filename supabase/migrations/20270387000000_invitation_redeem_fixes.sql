-- =====================================================================================================
-- SLICE 5 (6/n) -- corrections found by wiring redemption to the real schema
--
--  * club_join_requests names the person requesting_user_id, and has no provenance column. A join
--    request created by a team code must record WHICH code produced it, or the club cannot tell an
--    invited request from a cold one when deciding it.
--  * invitation.identity_mismatch was emitted but never registered, and security_events refuses an
--    unregistered type. An event that cannot be written is not an audit trail.
-- =====================================================================================================

alter table public.club_join_requests
  add column if not exists source_invitation_id uuid references public.access_invitations(id);

comment on column public.club_join_requests.source_invitation_id is
  'Slice 5: the team join code this request came from, when it came from one. Provenance for the '
  'person deciding it -- a code-borne request is not the same as somebody arriving unannounced.';

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('invitation.identity_mismatch', 'INVITATION', 'WARNING', true, false, false)
on conflict (event_type) do nothing;

-- Point redemption at the real column names.
do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='redeem_invitation';
  v := replace(v,
    'insert into public.club_join_requests (club_id, user_id, requested_role, status, source_invitation_id)
    values (v.club_id, v_actor, ''BASIC_USER'', ''pending'', v.id)
    on conflict do nothing;',
    'insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status, source_invitation_id)
    values (v.club_id, v_actor, ''BASIC_USER'', ''pending'', v.id)
    on conflict do nothing;');
  execute format('create or replace function public.redeem_invitation(p_token text default null, p_code text default null) returns jsonb language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='redeem_invitation') ~ 'club_join_requests \(club_id, user_id' then
    raise exception 'Slice 5: redemption still names a column club_join_requests does not have.';
  end if;
end $$;
