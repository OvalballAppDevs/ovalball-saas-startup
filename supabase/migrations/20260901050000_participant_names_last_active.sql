-- The fixture-conversation participants panel needs last_active_at for
-- its presence labels (last seen X ago), same profiles_select_self_or_
-- admin gap as sender names -- extend the existing RPC rather than adding
-- a second one for the same authorization boundary. Postgres requires
-- dropping first since the OUT column list is changing.

drop function public.get_conversation_participant_names(uuid[], uuid[]);

create function public.get_conversation_participant_names(p_user_ids uuid[], p_club_ids uuid[])
returns table (user_id uuid, first_name text, surname text, last_active_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.first_name, p.surname, p.last_active_at
  from public.profiles p
  where p.id = any(p_user_ids)
    and (
      internal.is_site_admin()
      or exists (
        select 1 from public.club_memberships cm
        where cm.user_id = auth.uid() and cm.club_id = any(p_club_ids) and cm.status = 'active'
          and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      )
      or exists (
        select 1
        from public.team_permissions tp
        join public.club_memberships cm on cm.id = tp.membership_id
        join public.teams t on t.id = tp.team_id
        where cm.user_id = auth.uid() and cm.status = 'active'
          and tp.permission in ('team_admin', 'coach', 'manager')
          and t.club_id = any(p_club_ids)
      )
    );
$$;

comment on function public.get_conversation_participant_names(uuid[], uuid[]) is
  'Resolves display names and last_active_at (never email/DOB/address) for participants in a fixture conversation, gated on the CALLER themselves being a legitimate club-wide or team-level official at one of the given clubs (or Site Admin). Fixes the same profiles_select_self_or_admin gap for the participants panel that the original version fixed for message sender names.';

revoke all on function public.get_conversation_participant_names(uuid[], uuid[]) from public;
grant execute on function public.get_conversation_participant_names(uuid[], uuid[]) to authenticated;
