-- Pre-existing gap found this pass (not introduced by the messages popover,
-- but first actually exercised by it): profiles_select_self_or_admin
-- restricts direct SELECT on public.profiles to "your own row, or a Site
-- Admin" -- so an ORDINARY club user (never a Site Admin) viewing a fixture
-- conversation could never actually resolve any OTHER sender's real name
-- via a plain `.select()`, silently falling back to a generic placeholder
-- ("Ovalball user" / "Someone") for every message that wasn't their own.
-- This mirrors exactly the "Unknown everywhere on /people" bug
-- get_club_member_directory() (20260831170000) already fixed for the
-- People page -- same privacy-conscious shape (SECURITY DEFINER, name
-- columns only, never DOB/address/email-to-strangers), generalized to
-- resolve names across the TWO clubs a fixture conversation can span
-- (get_club_member_directory is scoped to one club at a time, which
-- doesn't fit a cross-club fixture thread).
--
-- Authorization: the CALLER must themselves be a legitimate club-wide or
-- team-level official at one of the given clubs (or Site Admin) -- the
-- same boundary internal.can_access_fixture_conversation already uses for
-- the messages themselves, just expressed directly over club_ids since
-- this is called for a conversation the caller has already proven access
-- to by successfully fetching its fixture/request row.

create function public.get_conversation_participant_names(p_user_ids uuid[], p_club_ids uuid[])
returns table (user_id uuid, first_name text, surname text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.first_name, p.surname
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
  'Resolves display names (first_name/surname only -- never email/DOB/address) for message senders in a fixture conversation, gated on the CALLER themselves being a legitimate club-wide or team-level official at one of the given clubs (or Site Admin). Fixes a latent gap where a caller who is neither the row owner nor a Site Admin could never resolve any other sender''s real name through a plain profiles SELECT (profiles_select_self_or_admin), silently degrading every conversation to placeholder names for ordinary club users.';

revoke all on function public.get_conversation_participant_names(uuid[], uuid[]) from public;
grant execute on function public.get_conversation_participant_names(uuid[], uuid[]) to authenticated;
