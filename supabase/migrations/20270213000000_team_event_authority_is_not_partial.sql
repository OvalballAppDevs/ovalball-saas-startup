-- =====================================================================
-- TEAM AUTHORITY OVER A SHARED EVENT IS NOT PARTIAL
--
-- Found in browser UAT, not in code review. The Under 11 Mixed team admin
-- opened "Junior Fun Day" -- an event involving Under 11 Mixed, Under 12 Boys
-- and Under 12 Girls -- and was offered Edit Event and Cancel Event on it.
--
-- internal.can_manage_club_event granted management when the caller held
-- calendar.manage on ANY ONE of the event's teams. That is the wrong
-- quantifier. It means one team's admin can move the date of an event two
-- other teams are also attending, and can cancel it outright for all three.
-- public.save_club_event already re-checks every team in the list being
-- WRITTEN, so they could not have kept the other teams attached through an
-- edit -- but cancel takes no team list, and the date was theirs to change.
--
-- THE RULE IS ALL, NOT ANY. Team-scoped management reaches an event only when
-- the event is confined to teams that person manages. The moment it involves a
-- team they do not, it is no longer theirs alone to change, and it needs club
-- scope -- which is the same shape as the club-wide rule already here.
--
-- This narrows authority. Nobody who could legitimately manage an event before
-- loses anything: a club-scoped administrator is unaffected, and a team admin
-- keeps full management of their own team's own events.
-- =====================================================================
create or replace function internal.can_manage_club_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_events e
    where e.id = p_event_id
      and (
        internal.is_site_admin()
        or internal.has_capability('calendar.manage', 'club', e.club_id, null)
        or (
          -- A club-wide event reaches every team, so it is never one team's
          -- to manage.
          not e.is_club_wide
          -- At least one team, and EVERY team, within this caller's authority.
          and exists (select 1 from public.club_event_teams cet where cet.event_id = e.id)
          and not exists (
            select 1 from public.club_event_teams cet
            where cet.event_id = e.id
              and not internal.has_capability('calendar.manage', 'team', e.club_id, cet.team_id)
          )
        )
      )
  );
$$;

comment on function internal.can_manage_club_event(uuid) is
  'May this caller manage this club event? Club scope manages any event at the club; team scope manages only an event confined ENTIRELY to teams they manage -- never a shared event, and never a club-wide one.';
