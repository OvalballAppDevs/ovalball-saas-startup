-- =====================================================================================================
-- A GROUND'S CHANGING ROOMS ARE NOT WORLD-READABLE.
--
-- `venue_changing_rooms` (20270591) was created with a SELECT grant to `anon` and a row policy of
-- `using (true)`. Those two together mean every club's changing-room names, descriptions and cover
-- paths could be read by anybody at all, with no session.
--
-- ITS OWN SIBLINGS ALREADY SETTLED THIS, in the opposite direction:
--
--   venues        Slice 4E REMOVED anon's grant outright; anonymous readers use the `public_venues`
--                 projection, so the public competition schedule still says where a match is played
--                 without the venue table itself being readable.
--   club_pitches  no anon grant either, and the same `using (true)` row rule -- openness among
--                 SIGNED-IN people, nothing for the anonymous web.
--
-- So the row policy is left exactly as it is: among signed-in people a ground's facilities are
-- ordinary club information, which is the decision both siblings already encode. What is withdrawn is
-- the ANONYMOUS grant, which is the part that was never decided -- it came with the table and nothing
-- reads the table anonymously. `packages/contracts/src/club/venues.ts` is the reader, and it is a club
-- administration surface.
--
-- FOUND BY THE PERIMETER MANIFEST, which compares the database's real grants against the recorded
-- perimeter. The table had never been declared, so the comparison had never been made.
-- =====================================================================================================

revoke select on public.venue_changing_rooms from anon;

do $$
begin
  if has_table_privilege('anon', 'public.venue_changing_rooms', 'SELECT') then
    raise exception 'anon can still read every club''s changing rooms.';
  end if;
end $$;
