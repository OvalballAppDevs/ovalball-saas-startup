-- Section 41-47: some physical pitches (typically a full-size 3G/grass
-- pitch marked out for several simultaneous mini/youth games) can host
-- more than one fixture at the same time. lane_count is a structured
-- capacity number on the PHYSICAL pitch -- never a second "sub-pitch"
-- row duplicating club_pitches, and fixtures.pitch_id keeps pointing at
-- the one real physical pitch either way (which lane a fixture visually
-- sits in is computed at render time from kickoff/duration overlap, not
-- stored -- there is no canonical "lane" fact to get out of sync).
-- Default 1 preserves today's exactly-one-fixture-at-a-time behaviour for
-- every existing pitch with zero migration risk.
alter table public.club_pitches
  add column if not exists lane_count integer not null default 1;

alter table public.club_pitches
  drop constraint if exists club_pitches_lane_count_range,
  add constraint club_pitches_lane_count_range check (lane_count >= 1 and lane_count <= 4);

comment on column public.club_pitches.lane_count is 'Section 41-47: how many fixtures this physical pitch can genuinely host at the same time (e.g. a full pitch marked out for 2-3 simultaneous mini games). 1 = today''s normal single-booking pitch. Auto Allocate and conflict detection treat this as the real overlap capacity; the board renders lane_count > 1 as separate lanes under the one physical pitch.';
