-- =====================================================================================================
-- CONVERGENCE STEP 6 (3/n) -- repair the derived venue display line.
--
-- 20270509000000 made set_venue_address the only writer of a venue address, and it regenerates the
-- single-line `venues.address` from the structured parts. Rows written BEFORE that -- by the seeds, by
-- a historical import, by the old update_venue -- can hold the structured parts with no derived line,
-- or a derived line that no longer matches them.
--
-- Both are visible: the Club Settings venue list shows that line, so a venue with a full address
-- displayed as a bare postcode. That was found on this database, where both seeded venues carry
-- `address_line_1 = 'Belvedere Road'`, `town = 'Burnley'` and `address = NULL`.
--
-- THE BACKFILL IS THE DEFINITION, NOT A GUESS. It recomputes exactly what set_venue_address computes,
-- so it is deterministic, idempotent, and cannot invent an address: a row with no structured parts gets
-- NULL, which is what it already had. Nothing is inferred from a name, and no row without structured
-- data is touched at all.
--
-- It deliberately does NOT clear a derived line for a row that has one and no structured parts. Those
-- are pre-structured rows where the single line is the only address there is, and deleting it would be
-- losing the address to tidy up a column.
-- =====================================================================================================

do $$
declare
  v_before_missing int;
  v_before_stale   int;
  v_after_missing  int;
  v_after_stale    int;
  v_total          int;
begin
  select count(*) into v_total from public.venues;

  select count(*) into v_before_missing
  from public.venues
  where address is null
    and coalesce(address_line_1, address_line_2, town, county) is not null;

  select count(*) into v_before_stale
  from public.venues
  where coalesce(address_line_1, address_line_2, town, county) is not null
    and address is distinct from nullif(concat_ws(', ', address_line_1, address_line_2, town, county), '');

  raise notice 'Step 6 backfill: % venues; % missing a derived line; % where it disagrees with the structured parts',
    v_total, v_before_missing, v_before_stale;

  update public.venues
  set address = nullif(concat_ws(', ', address_line_1, address_line_2, town, county), '')
  where coalesce(address_line_1, address_line_2, town, county) is not null
    and address is distinct from nullif(concat_ws(', ', address_line_1, address_line_2, town, county), '');

  select count(*) into v_after_missing
  from public.venues
  where address is null
    and coalesce(address_line_1, address_line_2, town, county) is not null;

  select count(*) into v_after_stale
  from public.venues
  where coalesce(address_line_1, address_line_2, town, county) is not null
    and address is distinct from nullif(concat_ws(', ', address_line_1, address_line_2, town, county), '');

  if v_after_missing <> 0 or v_after_stale <> 0 then
    raise exception 'STEP 6 backfill: % still missing, % still stale', v_after_missing, v_after_stale;
  end if;

  -- The row count must not move: this rewrites a derived column and creates and deletes nothing.
  if (select count(*) from public.venues) <> v_total then
    raise exception 'STEP 6 backfill: the venue count changed from % -- a derived-column repair must not create or remove rows', v_total;
  end if;

  raise notice 'Step 6 backfill: derived line repaired on % venue(s); % unchanged', v_before_stale, v_total - v_before_stale;
end $$;
