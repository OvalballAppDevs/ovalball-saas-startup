-- =====================================================================================================
-- A CLUB THAT HAS ACCEPTED IS NOT REMOVED FROM UNDER ITSELF.
--
-- `remove_tournament_participant` read the tournament to find the host club, checked the host's
-- authority, and then deleted the participant row. It never read the participant's STATUS and never
-- took a lock. `respond_tournament_invitation` beside it does both -- `select ... for update`, then
-- refuse anything that is not still pending.
--
-- RACED, THE PAIR PRODUCED AN INCOHERENT RESULT, and `competition_authority_races` R5 is the suite that
-- found it:
--
--   the invited club taps Accept   -> status becomes 'accepted', committed, the club is told it is in
--   the host taps Remove          -> the row is deleted anyway
--
-- A club told it is in the festival, and absent from it. R5's own comment names this as the danger and
-- names the rule that prevents it -- "the host may not remove a club which has already accepted" -- so
-- the rule is being restored here rather than invented; the function had simply stopped expressing it.
--
-- TWO CHANGES, AND BOTH ARE NEEDED.
--
--   1. `for update` on the participant row, so the two operations serialise instead of interleaving.
--      Without the lock, a status read is a guess about what the other session is doing.
--   2. the status is re-read UNDER that lock and an accepted participant is refused.
--
-- The lock alone would not have fixed it: whichever order they serialise in, a host deleting an
-- accepted row still deletes it. Coherence needs the refusal.
--
-- A PENDING OR DECLINED INVITATION, AND AN ORGANISER-ADDED SIDE, ARE UNAFFECTED. 'added' is what an
-- organiser's own addition is, and removing one is ordinary editing of the field -- which is the common
-- case and stays exactly as it was.
--
-- WHAT A HOST DOES INSTEAD, when a club that accepted can genuinely no longer come, is a withdrawal --
-- a thing the club does, or an explicit host action that says so rather than a silent delete. Ovalball
-- has no such path today; this migration deliberately does not invent one, because "remove the row and
-- say nothing" is precisely the behaviour that was wrong.
-- =====================================================================================================

create or replace function public.remove_tournament_participant(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
  v_status text;
begin
  -- THE ROW IS LOCKED BEFORE ANYTHING IS DECIDED ABOUT IT. `respond_tournament_invitation` takes the
  -- same lock on the same row, so the two meet here rather than in the gap between a read and a write.
  select t.host_club_id, p.status into v_club, v_status
  from public.tournament_participants p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = p_participant_id
  for update of p;

  if v_club is null then
    raise exception 'That team is not in this tournament.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', v_club, null, null) then
    raise exception 'You do not have permission to manage this tournament.' using errcode = '42501';
  end if;

  -- READ UNDER THE LOCK, so this is the status as it stands now rather than as it stood when the
  -- organiser last looked at the screen.
  if v_status = 'accepted' then
    raise exception 'This club has accepted its invitation, so it cannot be removed from the tournament.'
      using errcode = '22023';
  end if;

  delete from public.tournament_participants where id = p_participant_id;
end;
$function$;

comment on function public.remove_tournament_participant(uuid) is
  'Removes a side from a tournament. Locks the participant row and refuses one whose invitation has '
  'already been ACCEPTED: a club told it is in the festival must not then be deleted out of it. An '
  'organiser-added side and a still-pending or declined invitation are removed as before.';

revoke all on function public.remove_tournament_participant(uuid) from public, anon;
grant execute on function public.remove_tournament_participant(uuid) to authenticated;
grant execute on function public.remove_tournament_participant(uuid) to service_role;
