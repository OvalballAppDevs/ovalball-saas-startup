-- Structural protection against publishing a season-mixed content set.
--
-- THE SPECIFIC FAILURE THIS PREVENTS
--
-- RFU Regulation 15 is currently split across two seasons in our own records:
--
--   RFU-REG15-MASTER-2026-27   effective_from 2026-08-01   (2026/27)
--   RFU-REG15-APP1-2025-001    effective_from 2025-08-01   (2025/26)
--
-- A content set that drew its Half Game Rule from the master and its ball size
-- from the appendix would render as one coherent page of "the 2026/27 rules"
-- with nothing to tell a parent that half of it is a season out of date.
--
-- Note why an overlap test would NOT catch this. The 2025/26 appendix has
-- effective_to = NULL, so on any "does the source's validity window overlap the
-- content set's window?" test it passes: 2025-08-01 <= 2026-08-01 and no end
-- date. An open-ended effective_from silently means "still current". The guard
-- therefore compares SEASONS, derived from effective_from, rather than testing
-- interval overlap.
--
-- WHY A SEASON AND NOT A YEAR
--
-- The rugby regulatory year starts on 1 August -- Regulation 15 is titled
-- "Effective from 1 August 2026" and 15.10 runs the 2026-27 season to 3 May
-- 2027. A calendar-year comparison would put August 2026 and January 2027 in
-- different buckets when they are the same season.

-- ============================================================
-- 1. Season derivation.
-- ============================================================

create or replace function internal.regulatory_season_of(p_date date)
returns text
language sql
immutable
as $$
  select case
    when p_date is null then null
    when extract(month from p_date) >= 8
      then extract(year from p_date)::int || '/' || right((extract(year from p_date)::int + 1)::text, 2)
    else (extract(year from p_date)::int - 1) || '/' || right(extract(year from p_date)::int::text, 2)
  end;
$$;

comment on function internal.regulatory_season_of(date) is
  'The rugby regulatory season a date falls in, as "2026/27". The year turns on 1 August, matching RFU Regulation 15''s own "Effective from 1 August" framing -- a calendar-year comparison would wrongly separate August 2026 from January 2027.';

-- ============================================================
-- 2. An explicit, deliberate escape hatch.
--
--    Some documents genuinely are not reissued every season and remain in
--    force. That must be an ASSERTION someone makes with a reason attached,
--    not an inference drawn from a missing end date -- which is precisely the
--    inference that made the 2025/26 appendix look current.
-- ============================================================

alter table public.regulatory_sources
  add column if not exists carries_forward boolean not null default false,
  add column if not exists carries_forward_note text;

alter table public.regulatory_sources
  drop constraint if exists regulatory_sources_carries_forward_explained;
alter table public.regulatory_sources
  add constraint regulatory_sources_carries_forward_explained
  check (not carries_forward or carries_forward_note is not null);

comment on column public.regulatory_sources.carries_forward is
  'True only where it has been VERIFIED that this document remains in force in later seasons without reissue. It exempts the source from the season-compatibility guard, so it must never be set to work around a publication failure -- the note is required precisely so the reason is on the record.';

-- ============================================================
-- 3. The report. Two distinct violations, because they have different fixes.
-- ============================================================

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
  -- (a) A source from a different season to the content set's own.
  select
    cs.content_set_key,
    'SOURCE_SEASON_DIFFERS_FROM_SET'::text,
    internal.regulatory_season_of(cs.effective_from),
    string_agg(distinct rs.source_key || ' (' || coalesce(internal.regulatory_season_of(rs.effective_from), 'undated') || ')', ', '),
    'The content set declares one season but cites a source in force in another. Either the source is out of date for this set, or the set''s effective_from is wrong.'
  from public.regulatory_content_sets cs
  join public.regulatory_content_sections sec on sec.content_set_id = cs.id
  join public.regulatory_fact_citations fc on fc.fact_id = sec.fact_id
  join public.regulatory_sources rs on rs.id = fc.source_id
  where cs.effective_from is not null
    and rs.effective_from is not null
    and not rs.carries_forward
    and internal.regulatory_season_of(rs.effective_from) is distinct from internal.regulatory_season_of(cs.effective_from)
  group by cs.content_set_key, cs.effective_from

  union all

  -- (b) One set citing sources from two different seasons. Caught even when
  --     the set itself is undated, which is the shape most likely to slip
  --     through: nothing declares a season, so nothing looks wrong.
  select
    cs.content_set_key,
    'SET_MIXES_SOURCE_SEASONS'::text,
    coalesce(internal.regulatory_season_of(cs.effective_from), 'undated'),
    string_agg(distinct rs.source_key || ' (' || internal.regulatory_season_of(rs.effective_from) || ')', ', '),
    'A single content set draws on sources from more than one season. Readers cannot tell which parts are current; split the set or update the older source.'
  from public.regulatory_content_sets cs
  join public.regulatory_content_sections sec on sec.content_set_id = cs.id
  join public.regulatory_fact_citations fc on fc.fact_id = sec.fact_id
  join public.regulatory_sources rs on rs.id = fc.source_id
  where rs.effective_from is not null
    and not rs.carries_forward
  group by cs.content_set_key, cs.effective_from
  having count(distinct internal.regulatory_season_of(rs.effective_from)) > 1;
$$;

comment on function public.regulatory_season_compatibility_report() is
  'Every content set whose cited sources are season-incompatible. Must return zero rows. Two violations with different remedies: SOURCE_SEASON_DIFFERS_FROM_SET (the set declares a season its source does not belong to) and SET_MIXES_SOURCE_SEASONS (one set drawing on two seasons at once, which is caught even when the set declares no season of its own).';

grant execute on function public.regulatory_season_compatibility_report() to authenticated;

-- ============================================================
-- 4. The gate. A reviewer cannot forget this, because publishing performs it.
-- ============================================================

create or replace function public.publish_regulatory_content_set(p_content_set_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
  v_bad record;
begin
  if not internal.has_capability('site.regulatory.manage', 'site') then
    raise exception 'You are not authorized to publish regulatory content.' using errcode = '42501';
  end if;

  select content_set_key into v_key from public.regulatory_content_sets where id = p_content_set_id;
  if v_key is null then
    raise exception 'Content set not found.';
  end if;

  -- Season compatibility, checked BEFORE the state change. A season-mixed set
  -- must never reach PUBLISHED, whatever a reviewer believes about it.
  for v_bad in
    select * from public.regulatory_season_compatibility_report() r where r.content_set_key = v_key
  loop
    raise exception
      'Refusing to publish "%": % Season declared: %. Offending source(s): %. %',
      v_bad.content_set_key, v_bad.violation, v_bad.set_season, v_bad.offending_sources, v_bad.detail
      using errcode = '23514';
  end loop;

  update public.regulatory_content_sets
  set publication_state = 'PUBLISHED', published_by = auth.uid(), published_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_content_set_id and publication_state = 'VERIFIED';
  if not found then
    raise exception 'Content set not found, or not in VERIFIED state (a content set must be VERIFIED before it can be PUBLISHED).';
  end if;
end;
$function$;

comment on function public.publish_regulatory_content_set(uuid) is
  'Publishes a VERIFIED content set. Refuses any set whose cited sources are season-incompatible -- see regulatory_season_compatibility_report(). The check runs before the state change and cannot be waived from the call site; the only way past it is to fix the source, split the set, or assert carries_forward on the source with a written reason.';

-- ============================================================
-- 5. Nothing already published may be in violation.
-- ============================================================

do $$
declare
  v_bad record;
begin
  for v_bad in select * from public.regulatory_season_compatibility_report() loop
    raise exception 'Existing content set "%" is season-incompatible (%): % -- %',
      v_bad.content_set_key, v_bad.violation, v_bad.offending_sources, v_bad.detail;
  end loop;
end $$;
