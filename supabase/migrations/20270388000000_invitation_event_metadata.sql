-- =====================================================================================================
-- SLICE 5 (7/n) -- D-S5-AUTO-1: invitation events carry no secret-shaped metadata key
--
-- The platform's own audit guard refused `code_hint` in an invitation event's metadata, because it
-- rejects any key matching password/token/secret/code/otp. The guard is right and is not weakened
-- here: the hint is two characters for administrator display, but a blanket rule about key NAMES is
-- exactly the kind of rule that should not acquire exceptions -- the next key called `code_something`
-- would sail through on the precedent.
--
-- Alternatives rejected: widening the guard's pattern (weakens a working control for a cosmetic
-- gain); renaming the key to something that evades the pattern (defeats the control by wordplay).
--
-- The event already carries invitation_id, and access_invitations.code_hint is one join away, so
-- nothing is lost. Consequence: none for authority; the audit trail keeps the same information
-- reachable and stops restating a fragment of a secret.
-- =====================================================================================================
do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='issue_invitation';
  v := replace(v,
    E'jsonb_build_object(''invitation_id'', v_id, ''kind'', p_kind, ''code_hint'', right(replace(v_code,''-'',''''),2))',
    E'jsonb_build_object(''invitation_id'', v_id, ''kind'', p_kind)');
  execute format('create or replace function public.issue_invitation(p_kind text, p_club_id uuid default null, p_team_id uuid default null, p_player_id uuid default null, p_club_directory_id uuid default null, p_target_user_id uuid default null, p_email text default null, p_intended_outcome jsonb default ''{}''::jsonb, p_max_uses integer default null) returns table (invitation_id uuid, token text, code text, expires_at timestamptz, already_existed boolean) language plpgsql security definer set search_path to %L as %s', 'public', quote_literal(v));
end $$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='issue_invitation') ~ 'code_hint'':' then
    raise exception 'Slice 5: an invitation event still carries a secret-shaped metadata key.';
  end if;
end $$;
