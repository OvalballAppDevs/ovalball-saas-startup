-- 20260925050000 added a p_season_id default parameter to these two
-- helpers via CREATE OR REPLACE, but a different parameter LIST
-- creates a second overload rather than replacing the original --
-- Postgres then sees two equally-valid candidates for a 2-argument
-- call (the original, and the 3-argument version using its default)
-- and raises "function ... is not unique". Drop the original
-- 2-argument overloads so exactly one (3-argument, with a default)
-- signature exists for each, exactly as intended.
drop function if exists internal.validate_mini_rugby_team_set(uuid, uuid[]);
drop function if exists internal.mini_rugby_display_tag(uuid[]);
