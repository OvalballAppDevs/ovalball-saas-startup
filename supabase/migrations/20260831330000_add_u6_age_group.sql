-- Adds U6 as a legitimate canonical teams.age_group value. The
-- U6/U7/U8 tag-rugby fixture-eligibility band (20260831320000) already
-- named U6 in its logic, but no team could actually carry that age_group
-- until now -- this closes that gap rather than working around it with
-- display text, per the explicit "do not relabel it U7" requirement.
-- Nothing else changes: the check constraint is the only place the
-- U7-U18 floor was enforced at the data layer.

alter table public.teams drop constraint teams_age_group_check;
alter table public.teams add constraint teams_age_group_check
  check (age_group = any (array['U6', 'U7', 'U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U15', 'U16', 'U17', 'U18']));
