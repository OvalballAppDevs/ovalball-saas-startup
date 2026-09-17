-- =====================================================================================================
-- SLICE 6 (7/n) -- one answer to "how good is this session?" (Phase 2 AA)
--
-- lib/auth/require-session.ts needs the same facts the database decides on. It could re-derive them in
-- TypeScript; then there would be two answers to one question, and the day they disagreed the browser
-- would be the one people believed.
--
-- So it asks. This returns POSTURE, never a credential: whether the account is usable, whether the
-- session is live, what assurance it reached, whether this person's group is being enforced, and
-- whether a code was verified recently. Nothing here is a secret -- it is all about the caller's own
-- session, and the caller already knows whether they are signed in.
-- =====================================================================================================

create or replace function public.my_session_assurance()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'account_usable',       internal.is_account_active((select auth.uid())),
    'session_live',         internal.session_live_only(),
    'aal',                  internal.current_session_aal(),
    'enforcement_required', not internal.session_aal_ok(),
    'recent_aal2',          internal.recent_aal2(10),
    'enforcement_group',    coalesce(
                              (select s.enforcement_group from public.account_security_state s
                                where s.user_id = (select auth.uid())),
                              'NONE')
  );
$$;

comment on function public.my_session_assurance() is
  'Phase 2 AA. The caller''s own session posture, so the server layer and the database cannot disagree '
  'about whether a session is good enough. Returns no credential and nothing about anybody else.';

revoke all on function public.my_session_assurance() from public, anon;
grant execute on function public.my_session_assurance() to authenticated;

do $$
begin
  if to_regprocedure('public.my_session_assurance()') is null then
    raise exception 'Slice 6: the server layer has no way to ask about session assurance.';
  end if;
  raise notice 'Slice 6: one answer to how good a session is, shared by the server and the database';
end $$;
