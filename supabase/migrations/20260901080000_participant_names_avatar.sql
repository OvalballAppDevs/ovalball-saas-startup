-- Personal avatars are shown next to a sender's name in an authorized
-- fixture conversation (never in the global inbox, where the club crest
-- stays primary) -- same authorization boundary as names/last_active_at,
-- so extend the one RPC again rather than adding a parallel lookup.

drop function public.get_conversation_participant_names(uuid[], uuid[]);

create function public.get_conversation_participant_names(p_user_ids uuid[], p_club_ids uuid[])
returns table (user_id uuid, first_name text, surname text, last_active_at timestamptz, avatar_storage_path text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.first_name, p.surname, p.last_active_at, p.avatar_storage_path
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
  'Resolves display names, last_active_at, and avatar_storage_path (never email/DOB/address/phone) for participants in a fixture conversation, gated on the CALLER themselves being a legitimate club-wide or team-level official at one of the given clubs (or Site Admin).';

revoke all on function public.get_conversation_participant_names(uuid[], uuid[]) from public;
grant execute on function public.get_conversation_participant_names(uuid[], uuid[]) to authenticated;
