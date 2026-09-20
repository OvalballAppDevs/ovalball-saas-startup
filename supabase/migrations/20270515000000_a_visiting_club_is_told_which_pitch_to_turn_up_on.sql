-- =====================================================================
-- THE AWAY GROUND SUGGESTION HAD NOTHING TO READ
--
-- `lib/fixtures/venue-defaults.ts` says, and has always said, that an away
-- fixture suggests the opposition's default ground and -- when that ground has
-- exactly one pitch -- that pitch. The rule is right. The branch was dead.
--
-- `lib/fixtures/club-catalogue.ts` resolved both by reading `public.venues`
-- through the caller's own client. `venues_select` answers
-- `internal.can_view_venue`, which is `venue.venue.view` AT THAT CLUB, so a
-- fixture secretary arranging a match at Preston cannot read Preston's venue
-- rows -- correctly; they are not Preston's staff. The read therefore returned
-- nothing, `defaultGround` and `onlyPitch` stayed empty, and the code fell
-- through to the Club Directory's free-text `home_ground`. The ground still
-- appeared, so nothing looked broken; the pitch silently never did.
--
-- This is the failure mode this programme keeps meeting: a feature that
-- depends on a read it is not authorised for does not raise, it returns no
-- rows, and the absence reads as "there is nothing to suggest".
--
-- WHAT IS ACTUALLY PRIVATE HERE. Nothing. A club tells visiting teams where to
-- come and which pitch to go to; that is the entire purpose of the
-- information, and `public_venues` already publishes venue names to `anon` for
-- exactly that reason. What was missing from that projection was the two facts
-- an arrangement needs: which ground is the club's main one, and -- where
-- there is only one pitch on it -- what it is called.
--
-- DELIBERATELY NOT A PITCH LIST. `only_pitch_name` is null when a ground has
-- no pitches or more than one. A club's pitch layout is operational detail
-- that belongs to the club, and the product rule is already "with several, the
-- person chooses" -- so publishing them all would expose more than the
-- suggestion can even use. The exposure is exactly the size of the rule.
--
-- The projection stays owner-rights (`security_invoker = false`), which is
-- what makes it a public projection at all, and gains no column that is not
-- already visible to a member of the public standing at the gate.
-- =====================================================================

create or replace view public.public_venues
with (security_invoker = false) as
  select
    v.id,
    v.name,
    v.club_id,
    -- Which of a club's grounds is its main one. A visiting club needs this to
    -- know where "at their place" means.
    v.is_default_home,
    -- The pitch, only when there is exactly one and so no choice to make.
    -- Null for a ground with none recorded, and null for a ground with
    -- several -- where the product already asks a person to choose.
    -- min() over an exactly-one set IS that one value; the case guard is what
    -- makes "exactly one" the condition rather than "the alphabetically first
    -- of several", which would name a pitch a visiting club has no reason to
    -- believe is theirs.
    (
      select case when count(*) = 1 then min(p.display_name) end
      from public.club_pitches p
      where p.venue_id = v.id and p.active
    ) as only_pitch_name
  from public.venues v
  where v.active;

comment on view public.public_venues is
  'Public projection of active venues: the name, the club, whether it is the club default ground, and the name of its only pitch where it has exactly one. Owner-rights by design -- a visiting club is told where to turn up. Never a pitch list, and never a venue address: the address projection is venues.address through the club''s own surfaces.';

grant select on public.public_venues to anon, authenticated;

-- ---------------------------------------------------------------------
-- The projection may only ever widen by a deliberate act.
--
-- This view is owner-rights, so its column list IS its access-control
-- boundary. Asserting the exact set here means a future ALTER that adds, say,
-- a postcode or a note column fails the migration rather than quietly
-- publishing it.
-- ---------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(column_name, ',' order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_venues';

  if v_cols is distinct from 'club_id,id,is_default_home,name,only_pitch_name' then
    raise exception 'public_venues publishes an unexpected column set: %', v_cols;
  end if;

  if (select c.reloptions::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'public_venues') not like '%security_invoker=false%' then
    raise exception 'public_venues must stay an owner-rights projection';
  end if;
end;
$$;
