-- The season guard was applying a union calendar to league documents.
--
-- WHAT WAS WRONG
--
-- internal.regulatory_season_of(date) assumed every rugby season turns on
-- 1 August and produced a "2026/27" style label. That is correct for union --
-- RFU Regulation 15 is titled "Effective from 1 August 2026" and 15.10 runs
-- 2026-27 from September to May -- and wrong for league, which plays a SUMMER
-- season. Super League runs across a single calendar year.
--
-- The visible symptom: RFL-FIRSTAID-2026-001, effective 2026-02-03, was being
-- labelled season "2025/26". It is a 2026-season document. Nothing was broken
-- by it yet, because the compatibility report currently returns no violations
-- either way, but a guard whose entire purpose is to catch season mismatches
-- must not itself mis-derive the season -- it would eventually either wave
-- through a genuine league mismatch or block a correct league publication.
--
-- THE FIX
--
-- Season derivation takes the rugby code. Union keeps the August boundary and
-- the "2026/27" label; league uses the calendar year and a plain "2026". The
-- old single-argument form is kept, delegating to union, because that is the
-- only behaviour it ever correctly had -- and it is marked deprecated so it
-- is not reached for again.

create or replace function internal.regulatory_season_of(p_date date, p_rugby_code text)
returns text
language sql
immutable
as $$
  select case
    when p_date is null then null
    -- League: a summer game. The season is the calendar year it is played in.
    when p_rugby_code = 'league' then extract(year from p_date)::int::text
    -- Union: a winter game whose regulatory year turns on 1 August.
    when extract(month from p_date) >= 8
      then extract(year from p_date)::int || '/' || right((extract(year from p_date)::int + 1)::text, 2)
    else (extract(year from p_date)::int - 1) || '/' || right(extract(year from p_date)::int::text, 2)
  end;
$$;

comment on function internal.regulatory_season_of(date, text) is
  'The regulatory season a date falls in, for a given code. Union turns on 1 August and reads "2026/27", matching RFU Regulation 15''s own framing. League is a summer game played across one calendar year and reads "2026". Using the union calendar for league mislabels every league document published between January and July.';

comment on function internal.regulatory_season_of(date) is
  'DEPRECATED -- assumes the union (1 August) calendar. Use the two-argument form with an explicit rugby code; this one is retained only so nothing that already calls it changes behaviour for union.';

-- The report now derives each season with the owning code. Content sets and
-- sources both carry rugby_code, so there is no guessing.
create or replace function public.regulatory_season_compatibility_report()
returns table (
  content_set_key text,
  violation text,
  set_season text,
  offending_sources text,
  detail text
)
language sql
stable
as $$
  select
    cs.content_set_key,
    'SOURCE_SEASON_DIFFERS_FROM_SET'::text,
    internal.regulatory_season_of(cs.effective_from, cs.rugby_code),
    string_agg(distinct rs.source_key || ' (' || coalesce(internal.regulatory_season_of(rs.effective_from, rs.rugby_code), 'undated') || ')', ', '),
    'The content set declares one season but cites a source in force in another. Either the source is out of date for this set, or the set''s effective_from is wrong.'
  from public.regulatory_content_sets cs
  join public.regulatory_content_sections sec on sec.content_set_id = cs.id
  join public.regulatory_fact_citations fc on fc.fact_id = sec.fact_id
  join public.regulatory_sources rs on rs.id = fc.source_id
  where cs.effective_from is not null
    and rs.effective_from is not null
    and not rs.carries_forward
    and internal.regulatory_season_of(rs.effective_from, rs.rugby_code)
        is distinct from internal.regulatory_season_of(cs.effective_from, cs.rugby_code)
  group by cs.content_set_key, cs.effective_from, cs.rugby_code

  union all

  select
    cs.content_set_key,
    'SET_MIXES_SOURCE_SEASONS'::text,
    coalesce(internal.regulatory_season_of(cs.effective_from, cs.rugby_code), 'undated'),
    string_agg(distinct rs.source_key || ' (' || internal.regulatory_season_of(rs.effective_from, rs.rugby_code) || ')', ', '),
    'A single content set draws on sources from more than one season. Readers cannot tell which parts are current; split the set or update the older source.'
  from public.regulatory_content_sets cs
  join public.regulatory_content_sections sec on sec.content_set_id = cs.id
  join public.regulatory_fact_citations fc on fc.fact_id = sec.fact_id
  join public.regulatory_sources rs on rs.id = fc.source_id
  where rs.effective_from is not null
    and not rs.carries_forward
  group by cs.content_set_key, cs.effective_from, cs.rugby_code
  having count(distinct internal.regulatory_season_of(rs.effective_from, rs.rugby_code)) > 1;
$$;

comment on function public.regulatory_season_compatibility_report() is
  'Every content set whose cited sources are season-incompatible. Must return zero rows. Seasons are derived per rugby code (union turns on 1 August, league on 1 January). Two violations with different remedies: SOURCE_SEASON_DIFFERS_FROM_SET, and SET_MIXES_SOURCE_SEASONS which is caught even when the set declares no season of its own.';

do $$
declare v_bad record;
begin
  for v_bad in select * from public.regulatory_season_compatibility_report() loop
    raise exception 'Existing content set "%" is season-incompatible (%): %', v_bad.content_set_key, v_bad.violation, v_bad.offending_sources;
  end loop;
end $$;
