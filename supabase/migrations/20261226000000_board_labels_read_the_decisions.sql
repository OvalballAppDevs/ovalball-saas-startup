-- The board must name a destination the way the club decided it, not the way a
-- projection guesses it.
--
-- WHAT THE BOARD SHOWED
--
-- A Mixed U11 confirmed to continue as Boys U12. In the Players section, the
-- boy in that cohort read:
--
--   Harry Mixed   U11   Normal next: U11   Selected: U11
--
-- The placement was right -- his own team, carrying him forward. The LABEL was
-- wrong: it said U11, which is what that side is called today and will not be
-- called by the time he plays for it.
--
-- The page resolves those labels through the canonical season-aware
-- projection, which is correct everywhere else in Ovalball. It cannot be
-- correct here, for the same reason placement could not be: under the staged
-- model no season identity is recorded until Apply, so the projection falls
-- back to date arithmetic and knows nothing about a decision a human has
-- already made -- least of all that a Mixed side was decided to become Boys.
--
-- This exposes the decided labels for the board, from the same resolver
-- collision detection, placement and Apply all use. Outside a handover the
-- projection remains the right answer and is untouched.

create or replace function public.handover_team_labels(p_rollover_id uuid)
returns table(team_id uuid, label text, continues boolean)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare r public.age_grade_rollovers;
begin
  select * into r from public.age_grade_rollovers where id = p_rollover_id;
  if not found then return; end if;
  if not (internal.can_manage_club_fixtures(r.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to view this handover.' using errcode = '42501';
  end if;

  return query
  select t.id, coalesce(i.label, t.display_name), coalesce(i.continues, false)
  from public.teams t
  cross join lateral internal.rollover_team_target_identity(p_rollover_id, t.id) i
  where t.club_id = r.club_id and t.rugby_code = r.rugby_code;
end;
$function$;

comment on function public.handover_team_labels(uuid) is
  'What each of the club''s teams will be CALLED next season according to the decisions on this handover. The board uses this rather than the date projection, which cannot know about a decision.';

grant execute on function public.handover_team_labels(uuid) to authenticated;
