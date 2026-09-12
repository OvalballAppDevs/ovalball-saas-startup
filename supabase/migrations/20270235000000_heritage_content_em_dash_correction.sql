-- Corrects a typography defect in the existing heritage content: several
-- entries were written with a literal double hyphen (" -- ") standing in
-- for a spaced em dash, and it was rendering verbatim in the UI instead of
-- as proper punctuation.
--
-- This is a mechanical, whitespace-anchored replacement of one exact
-- substring (" -- ", single space either side) with the real em dash
-- (" — "). It touches no other content: not dates, not certainty, not
-- sources, not the historical claims themselves. Confirmed beforehand that
-- every occurrence of "--" in these columns matches this exact spaced form
-- -- none are hyphenated identifiers, en-dash-style ranges, or any other
-- non-prose use -- so a literal, non-regex substring replace is the
-- safest possible fix: it cannot touch anything that isn't this exact
-- punctuation pattern.
begin;

update public.heritage_eras
set summary = replace(summary, ' -- ', ' — ')
where summary like '% -- %';

update public.heritage_entries
set
  summary = replace(summary, ' -- ', ' — '),
  detail = case when detail is not null then replace(detail, ' -- ', ' — ') else detail end,
  certainty_note = case when certainty_note is not null then replace(certainty_note, ' -- ', ' — ') else certainty_note end
where summary like '% -- %'
   or detail like '% -- %'
   or certainty_note like '% -- %';

update public.heritage_entry_sources
set supports = case when supports is not null then replace(supports, ' -- ', ' — ') else supports end
where supports like '% -- %';

-- Self-check: this migration's entire job is to make the literal pattern
-- disappear from every heritage text column. Fail loudly rather than leave
-- a silent partial fix if any instance survives.
do $$
declare
  v_remaining int;
begin
  select
    (select count(*) from public.heritage_eras where summary like '% -- %')
    + (select count(*) from public.heritage_eras where title like '% -- %')
    + (select count(*) from public.heritage_entries where summary like '% -- %')
    + (select count(*) from public.heritage_entries where detail like '% -- %')
    + (select count(*) from public.heritage_entries where certainty_note like '% -- %')
    + (select count(*) from public.heritage_entries where title like '% -- %')
    + (select count(*) from public.heritage_entry_sources where supports like '% -- %')
    + (select count(*) from public.heritage_entry_sources where publisher like '% -- %')
  into v_remaining;

  if v_remaining > 0 then
    raise exception 'heritage_content_em_dash_correction: % literal " -- " occurrence(s) remain after correction', v_remaining;
  end if;
end $$;

commit;
