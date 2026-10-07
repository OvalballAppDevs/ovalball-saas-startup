-- =====================================================================================================
-- A CLUB IN THE DIRECTORY IS NOT "EXTERNAL" JUST BECAUSE IT HAS NOT CLAIMED ITS ACCOUNT.
--
-- NO SCHEMA CHANGE. `tournament_participants` already represents everything this needs, proven against
-- the live schema before anything was written:
--
--   club_directory_id  not null, FK to club_directory   -- the real club identity, always kept
--   team_id            nullable                         -- null when the club has no team at the grade
--   squad_label        nullable, <= 40 chars, non-blank  -- what the organiser called the side
--   age_group          not null                          -- which competition it is in
--   tournament_participants_side_is_one_thing            -- a side is a real team OR a label, never both
--   tournament_participants_one_side_idx                 -- unique per (tournament, club, grade, team|label)
--
-- So Wigan with no U12 team is `club_directory_id = Wigan, team_id = null, squad_label = 'U12 A'`, and
-- a second side is the same row with 'U12 B'. Both were inserted and the duplicate refused before this
-- migration was written. There is no missing fact in the schema, and therefore no table to add.
--
-- WHAT WAS WRONG WAS THE STATUS RULE, which is a function, not a shape.
--
-- Both write paths decided a participant's status by asking "does this directory row have a `clubs`
-- row?" -- i.e. has the club claimed its Ovalball account. That made Wigan `external_recorded`, which
-- says the club is outside Ovalball. Wigan is not outside Ovalball: it is IN the canonical directory,
-- with a real identity, a crest and a location. It simply has not signed up, and whether a club has
-- signed up is not the same question as whether Ovalball knows who it is.
--
-- THE REAL DISTINCTION IS WHERE THE CLUB IDENTITY CAME FROM:
--
--   the organiser chose a club that exists in the canonical directory   -> added
--   the organiser typed a club Ovalball has never heard of              -> external_recorded
--
-- and the database already records that durably. The manual fallback stamps the directory row it
-- creates with `source = 'tournament_manual_entry'`; every other row came from a governing body, a
-- league table, a club page or Site Admin. So the rule reads a fact about the CLUB rather than a flag
-- passed by whichever client happened to make the call -- which also means the answer stays right if
-- the same club is later added again from a different screen.
--
-- A MANUALLY TYPED NAME THAT MATCHES A REAL DIRECTORY CLUB IS THAT CLUB. Both paths look the name up
-- before creating anything, so typing "Preston Grasshoppers" reuses Preston's canonical row and the
-- side is `added` -- correctly, because it is Preston. Nothing creates a second Preston.
-- =====================================================================================================

create or replace function internal.tournament_participant_status(p_club_directory_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- The one source that means "this row exists only because somebody typed a name into a tournament
    -- screen". Everything else in club_directory is a club Ovalball genuinely knows about, claimed or
    -- not: governing-body imports, league tables, club pages, Site Admin.
    when exists (
      select 1 from public.club_directory d
      where d.id = p_club_directory_id and d.source = 'tournament_manual_entry'
    ) then 'external_recorded'
    else 'added'
  end;
$$;

comment on function internal.tournament_participant_status(uuid) is
  'Whether a side the organiser added is "added" (the club is in Ovalball''s canonical directory) or '
  '"external_recorded" (the club exists only because somebody typed its name). Deliberately NOT based '
  'on whether the club has claimed an account: an unclaimed directory club is still a club Ovalball '
  'knows, and calling it external would lose that. Neither value means anybody was asked anything -- '
  'an organiser-added side is never pending and nothing is sent.';

revoke execute on function internal.tournament_participant_status(uuid) from public, anon;
grant execute on function internal.tournament_participant_status(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- Both write paths adopt it, so the creation wizard and the management tab cannot disagree about what
-- a side's status means.
-- -----------------------------------------------------------------------------------------------------

do $$
declare v_def text;
begin
  -- add_tournament_participant_team: the management tab's path.
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'add_tournament_participant_team';
  if v_def is null then
    raise exception 'add_tournament_participant_team is missing -- this migration has nothing to update.';
  end if;
  if position('case when v_participant_club is null then ''external_recorded'' else ''added'' end' in v_def) = 0 then
    raise exception 'add_tournament_participant_team no longer contains the claim-based status rule this migration replaces. Re-read it before changing it.';
  end if;
  v_def := replace(
    v_def,
    'case when v_participant_club is null then ''external_recorded'' else ''added'' end',
    'internal.tournament_participant_status(p_club_directory_id)'
  );
  execute v_def;

  -- create_tournament_with_teams: the creation wizard's one transactional path.
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'create_tournament_with_teams';
  if v_def is null then
    raise exception 'create_tournament_with_teams is missing -- this migration has nothing to update.';
  end if;
  if position('case when v_participant_club is null then ''external_recorded'' else ''added'' end' in v_def) = 0 then
    raise exception 'create_tournament_with_teams no longer contains the claim-based status rule this migration replaces. Re-read it before changing it.';
  end if;
  v_def := replace(
    v_def,
    'case when v_participant_club is null then ''external_recorded'' else ''added'' end',
    'internal.tournament_participant_status(v_dir)'
  );
  execute v_def;
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Existing rows.
--
-- Sides already recorded against a REAL directory club were stamped `external_recorded` by the old
-- rule purely because that club had not claimed an account. That is the wrong word for them, and it is
-- the hole this migration closes, so the rows are corrected to match the rule that now applies.
--
-- DELIBERATELY NARROW: only `external_recorded`, only where the directory row is genuinely canonical.
-- A side that was actually typed in keeps its status, and no `pending`, `accepted` or `declined` row is
-- touched -- those record something a club answered, which this migration has no business rewriting.
-- -----------------------------------------------------------------------------------------------------

update public.tournament_participants p
set status = 'added'
from public.club_directory d
where d.id = p.club_directory_id
  and p.status = 'external_recorded'
  and d.source is distinct from 'tournament_manual_entry';
