-- The three entries that slipped through unsourced, and a guard so it cannot
-- happen silently again.
--
-- The content migration asserted an editorial rule -- every heritage entry
-- carries at least one source -- and then broke it three times, because the
-- rule lived only in a comment. Three general-background entries (folk
-- football, the 1877 move to fifteen a side, the 1922 renaming) went in with
-- no citation at all and nothing objected.
--
-- That is exactly the failure mode the whole Rugby Hub is built to avoid: an
-- unsourced claim is indistinguishable from a sourced one once it is rendered
-- on a page. So this migration backfills the three and then makes the rule
-- checkable, rather than trusting the next author to remember it.

insert into public.heritage_entry_sources (entry_id, source_title, source_url, publisher, source_tier, supports, retrieved_on)
select e.id, v.source_title, v.source_url, v.publisher, v.source_tier, v.supports, date '2026-09-07'
from (values
('FOLK-FOOTBALL', 'History of rugby union', 'https://en.wikipedia.org/wiki/History_of_rugby_union', 'Wikipedia', 'ENCYCLOPEDIA',
 'The folk football traditions preceding codification, and that handling the ball was common in several of them. Background context rather than a specific claim, which is why this entry is WELL_DOCUMENTED rather than ESTABLISHED.'),
('FIFTEEN-A-SIDE-1877', 'History of rugby union', 'https://en.wikipedia.org/wiki/History_of_rugby_union', 'Wikipedia', 'ENCYCLOPEDIA',
 'The reduction from twenty a side to fifteen in 1877.'),
('NAME-RUGBY-LEAGUE-1922', 'Rugby league in the British Isles', 'https://en.wikipedia.org/wiki/Rugby_league_in_the_British_Isles', 'Wikipedia', 'ENCYCLOPEDIA',
 'The Northern Union adopting the name Rugby Football League in 1922, following usage already established in Australia and New Zealand.'),
('NAME-RUGBY-LEAGUE-1922', 'The Great Schism - Northern Union', 'https://www.rugbyfootballhistory.com/Schism.html', 'Rugby Football History', 'POPULAR_HISTORY',
 'The Northern Union''s development from breakaway body to the Rugby Football League.')
) as v(entry_key, source_title, source_url, publisher, source_tier, supports)
join public.heritage_entries e on e.entry_key = v.entry_key
where not exists (
  select 1 from public.heritage_entry_sources s
  where s.entry_id = e.id and s.source_url is not distinct from v.source_url
);

-- ============================================================
-- The guard.
--
-- A plain CHECK cannot express "at least one row in another table", and a
-- NOT VALID FK would be the wrong shape (the dependency runs the other way).
-- A trigger would have to fire on the wrong table and would block the normal
-- insert-entry-then-insert-sources order that migrations use.
--
-- So this is a callable assertion instead: cheap, explicit, and something a
-- migration or a test can run at the END of a content change, when the
-- invariant is actually supposed to hold.
-- ============================================================

create or replace function public.heritage_content_integrity()
returns table (check_name text, violations bigint, detail text)
language sql
stable
as $$
  select 'entries_without_sources',
         count(*),
         coalesce(string_agg(entry_key, ', ' order by entry_key), 'none')
  from public.heritage_entries e
  where not exists (select 1 from public.heritage_entry_sources s where s.entry_id = e.id)
  union all
  select 'uncertain_entries_without_note',
         count(*),
         coalesce(string_agg(entry_key, ', ' order by entry_key), 'none')
  from public.heritage_entries
  where certainty not in ('ESTABLISHED', 'WELL_DOCUMENTED') and certainty_note is null
  union all
  select 'entries_without_era',
         count(*),
         coalesce(string_agg(entry_key, ', ' order by entry_key), 'none')
  from public.heritage_entries
  where era_id is null
  union all
  select 'sources_without_url',
         count(*),
         coalesce(string_agg(distinct e.entry_key, ', '), 'none')
  from public.heritage_entry_sources s
  join public.heritage_entries e on e.id = s.entry_id
  where s.source_url is null;
$$;

comment on function public.heritage_content_integrity() is
  'Editorial invariants for heritage content that no single-row constraint can express. Every check must return 0. Run it after any heritage content change -- the constraints on heritage_entries catch a bad ROW, this catches a bad SET.';

grant execute on function public.heritage_content_integrity() to authenticated;

-- Fail this migration now if the backfill above did not actually clear it.
do $$
declare
  v_bad record;
begin
  for v_bad in select * from public.heritage_content_integrity() where violations > 0 loop
    raise exception 'Heritage content integrity check "%" failed with % violation(s): %',
      v_bad.check_name, v_bad.violations, v_bad.detail;
  end loop;
end $$;
