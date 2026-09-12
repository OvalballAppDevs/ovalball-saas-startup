-- Rugby Hub Game Knowledge -- "how rugby actually works", the missing
-- educational layer between Positions/Skills and Rules/Regulation.
--
-- CANONICAL MODEL: extends the existing general-knowledge content graph
-- rather than inventing a parallel one. hub_content_items already had a
-- CONCEPT_RELATED relationship type sitting unused in
-- hub_content_relationships (20270231000000) -- this migration is what
-- that was for. Reused as-is:
--   hub_content_items            -- the concept row itself (new content_type)
--   hub_content_relationships    -- concept <-> concept (CONCEPT_RELATED)
--   hub_skill_content_links      -- concept <-> skill (already generic)
--   hub_regulatory_fact_references -- concept <-> real regulatory fact
--   hub_content_applicability    -- recommendation-ranking scope
--   search_hub_content / get_hub_recommended_content -- already union in
--     hub_content_items with no content_type filter, so a GAME_CONCEPT row
--     participates in both the instant it exists, with zero RPC changes.
-- The one genuinely new piece is a concept <-> position link -- no
-- existing junction connects a position directly to a content item (only
-- to a skill), so hub_content_item_positions is added, mirroring
-- hub_skill_content_links's exact shape.
--
-- UNION vs LEAGUE: hub_content_items gains a nullable rugby_code, mirroring
-- hub_skills.rugby_code exactly (added in the Set-Piece Split slice, same
-- reasoning: NULL is the common, genuinely code-universal case). Where a
-- concept is genuinely code-specific (breakdown/ruck vs play-the-ball;
-- scrum/lineout vs tackle-count-and-restarts), it is modelled as TWO
-- separate rows, never one row with "if union / if league" branching in
-- React. Applicability for a code-specific concept is NOT is_universal=true
-- (that would contradict its own rugby_code, exactly the correction made
-- in the Set-Piece Split slice) -- it is one row per real
-- regulatory_identity of the matching code.
--
-- PROVENANCE: hub_content_items already carries a permanent CHECK
-- constraint (hub_content_items_no_regulatory_escape_hatch) refusing any
-- row whose title/summary/body reads like an unsourced legal claim -- this
-- migration's prose is written to genuinely satisfy that, not merely to
-- pass it. Real regulatory claims (restart distances) link through
-- hub_regulatory_fact_references to real VERIFIED RFU-REG15 facts, exactly
-- like the Set-Piece Split skill content did. Where no verified fact
-- exists for a code (League restart distances), nothing is invented.

-- =====================================================================
-- Schema: extend hub_content_items and hub_content_item_positions
-- =====================================================================

alter table public.hub_content_items drop constraint hub_content_items_content_type_check;
alter table public.hub_content_items add constraint hub_content_items_content_type_check
  check (content_type = any (array['COACHING_GUIDANCE', 'PRACTICAL_GUIDE', 'FUN_FACT', 'QUIZ_ITEM', 'VISUAL_DEFINITION', 'GAME_CONCEPT']));

alter table public.hub_content_items add column if not exists rugby_code text;
alter table public.hub_content_items add column if not exists concept_family text;
alter table public.hub_content_items add column if not exists journey_order integer;
alter table public.hub_content_items add column if not exists why_it_matters text;
alter table public.hub_content_items add column if not exists what_happens text;
alter table public.hub_content_items add column if not exists what_to_watch_for text;
alter table public.hub_content_items add column if not exists what_happens_next text;
alter table public.hub_content_items add column if not exists union_league_difference text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hub_content_items_rugby_code_check') then
    alter table public.hub_content_items add constraint hub_content_items_rugby_code_check check (rugby_code is null or rugby_code = any (array['union', 'league']));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hub_content_items_concept_family_check') then
    alter table public.hub_content_items add constraint hub_content_items_concept_family_check check (
      concept_family is null or concept_family = any (array['FUNDAMENTALS', 'POSSESSION_AND_CONTINUITY', 'ATTACK_AND_DEFENCE', 'RESTARTS_AND_SET_PIECES', 'LAWS_IN_PLAY', 'GAME_FLOW'])
    );
  end if;
end $$;

comment on column public.hub_content_items.rugby_code is 'NULL = genuinely code-universal content (the default). ''union''/''league'' only when the content genuinely does not apply the same way in the other code -- e.g. the-breakdown-and-ruck vs the-play-the-ball. Mirrors hub_skills.rugby_code; never inferred from content_key in React.';
comment on column public.hub_content_items.concept_family is 'Taxonomy for GAME_CONCEPT rows only -- mirrors hub_skills.skill_family. Null for every other content_type.';
comment on column public.hub_content_items.journey_order is 'Position in the Game Knowledge beginner journey for GAME_CONCEPT rows. A code-specific pair (e.g. breakdown/play-the-ball) shares the same order -- they are the same step in the journey, told once per code, never merged into one page.';

create table if not exists public.hub_content_item_positions (
  content_item_id uuid not null references public.hub_content_items(id) on delete cascade,
  position_id uuid not null references public.hub_positions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (content_item_id, position_id)
);
create index if not exists hub_content_item_positions_position_idx on public.hub_content_item_positions(position_id);

comment on table public.hub_content_item_positions is 'Connects a general-knowledge content item (initially: Game Knowledge concepts) directly to the positions it genuinely involves -- mirrors hub_skill_content_links exactly, the one link this codebase did not already have. Never a substitute for hub_position_skills; a concept explains WHAT/WHY, Position Explorer explains the position itself.';

alter table public.hub_content_item_positions enable row level security;

create policy hub_content_item_positions_admin_all on public.hub_content_item_positions
  for all using (internal.has_capability('site.hub_content.view', 'site'))
  with check (internal.has_capability('site.hub_content.manage', 'site'));

create policy hub_content_item_positions_public_read on public.hub_content_item_positions
  for select using (
    exists (select 1 from public.hub_content_items c where c.id = content_item_id and c.status = 'PUBLISHED')
    and exists (select 1 from public.hub_positions p where p.id = position_id and p.status = 'PUBLISHED')
  );

-- =====================================================================
-- Content: twelve concepts, mapped from the beginner journey without
-- padding -- two genuine code-specific pairs (post-tackle; set-piece/
-- restart-structure) share a journey step, everything else is honestly
-- code-universal. "How possession ends" and "what to watch for next" from
-- the brief are woven into these concepts and the journey UI itself
-- rather than manufactured into their own thin rows.
-- =====================================================================

do $$
declare
  v_actor uuid;
  v_objective uuid; v_pitch uuid; v_scoring uuid; v_possession uuid; v_moveball uuid;
  v_breakdown uuid; v_playtheball uuid; v_attackdefence uuid; v_restarts uuid;
  v_scrumlineout uuid; v_tacklecount uuid; v_penalties uuid; v_flow uuid;
  v_content_restarts uuid;
  v_fact uuid;
  v_p uuid; v_s uuid;
  v_ri uuid;
begin
  select id into v_actor from auth.users where email = 'rugby-hub-content-import@system.ovalball.internal';
  if v_actor is null then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'rugby-hub-content-import@system.ovalball.internal', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    ) returning id into v_actor;
  end if;

  -- 1. The objective of the game
  select id into v_objective from public.hub_content_items where content_key = 'the-objective-of-the-game';
  if v_objective is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'the-objective-of-the-game', 'GAME_CONCEPT', 'The Objective of the Game',
      'Two teams try to score more points than the other by carrying, passing or kicking an oval ball, mainly by grounding it in the opposition''s end zone.',
      'FUNDAMENTALS', 1,
      'Everything else in rugby — every tackle, kick and set piece — only makes sense once you know what teams are actually trying to achieve.',
      'A team in possession tries to advance the ball towards the opposition''s try line, while the other team tries to stop them and take the ball back.',
      'Which team currently has the ball, and which direction they''re trying to move it — that single thread explains almost everything happening on the pitch.',
      'Once you can track "who has it, and which way are they going", the rest of the game starts to read as a sequence rather than chaos.'
    ) returning id into v_objective;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_objective, true);
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_objective;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_objective;
  end if;

  -- 2. The pitch and direction of play
  select id into v_pitch from public.hub_content_items where content_key = 'the-pitch-and-direction-of-play';
  if v_pitch is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'the-pitch-and-direction-of-play', 'GAME_CONCEPT', 'The Pitch and Direction of Play',
      'Rugby is played on a rectangular pitch with a try line and dead-ball line at each end, and both teams defend one end while attacking the other.',
      'FUNDAMENTALS', 2,
      'Knowing which try line each team is defending is what turns a wall of players into a picture of who is winning the territorial battle.',
      'Teams swap ends at half-time, so the direction each team attacks reverses — the pitch itself never moves, only who is attacking which way.',
      'The touchlines (sidelines) and the 22-metre lines, which shape a lot of kicking and restart decisions later in the journey.',
      'With the pitch and direction settled, scoring — what actually counts as success at either end — is the natural next step.'
    ) returning id into v_pitch;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_pitch, true);
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_pitch;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_pitch;
  end if;

  -- 3. How scoring works
  select id into v_scoring from public.hub_content_items where content_key = 'how-scoring-works';
  if v_scoring is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next, union_league_difference)
    values (
      'how-scoring-works', 'GAME_CONCEPT', 'How Scoring Works',
      'Teams score by grounding the ball in the opposition''s end zone (a try), then get a follow-up kick at goal, plus separate kicks for penalties and drop goals.',
      'FUNDAMENTALS', 3,
      'The scoreboard is the entire point of the objective from step one — understanding how points are actually won explains why teams take the risks they do.',
      'A try is grounding the ball over the line; a conversion is a follow-up kick at goal; a penalty kick and a drop goal are separate ways to add points without a try.',
      'Whether a team chooses to kick for goal or keep the ball in hand near the line — that choice is a running theme once you understand the point values.',
      'Scoring only happens once a team actually has and keeps the ball, which is why possession is the next concept in the journey.',
      'The point values genuinely differ: a try is worth 5 points in Union and 4 in League, a conversion 2 in both, a penalty 3 in Union and 2 in League, and a drop goal 3 in Union but only 1 in League.'
    ) returning id into v_scoring;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_scoring, true);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_scoring, id from public.hub_skills where skill_key = 'kicking-for-territory-and-tactics';
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_scoring;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_scoring;
  end if;

  -- 4. Possession and territory
  select id into v_possession from public.hub_content_items where content_key = 'possession-and-territory';
  if v_possession is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'possession-and-territory', 'GAME_CONCEPT', 'Possession and Territory',
      'Having the ball (possession) and being in a good attacking part of the pitch (territory) are the two resources every team is constantly managing.',
      'POSSESSION_AND_CONTINUITY', 4,
      'Teams regularly kick a ball they could keep, because trading possession for territory is often the smarter move — this trade-off underpins most tactical decisions.',
      'A team weighs whether to run the ball to keep possession, or kick it away to gain territory and pin the opposition deep in their own half.',
      'A team kicking the ball on their own terms, well inside their own half, is usually trading possession for territory on purpose — not giving up.',
      'Once a team has both possession and good territory, how they actually move the ball forward becomes the next question.'
    ) returning id into v_possession;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_possession, true);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_possession, id from public.hub_skills where skill_key = 'kicking-for-territory-and-tactics';
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_possession;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_possession;
  end if;

  -- 5. How teams move the ball
  select id into v_moveball from public.hub_content_items where content_key = 'how-teams-move-the-ball';
  if v_moveball is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'how-teams-move-the-ball', 'GAME_CONCEPT', 'How Teams Move the Ball',
      'A team in possession moves the ball forward by running with it, passing it sideways or backwards, or kicking it — passing forward by hand is not allowed.',
      'POSSESSION_AND_CONTINUITY', 5,
      'This one rule — the ball can only travel forward by running or kicking, never by a forward pass — shapes almost every attacking shape you''ll see.',
      'Players carry the ball forward individually, or pass it backwards or sideways to a team-mate in better space, building an attack phase by phase.',
      'A player running straight at a gap versus passing to a team-mate in space — the choice between the two is the heart of attacking play.',
      'Every carry ends somewhere — usually in contact with a defender — which is exactly where the next concept, what happens after a tackle, picks up.'
    ) returning id into v_moveball;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_moveball, true);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_moveball, id from public.hub_skills where skill_key in ('passing-under-pressure', 'running-and-evasion');
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_moveball;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_moveball;
  end if;

  -- 6a. The breakdown and ruck (Union)
  select id into v_breakdown from public.hub_content_items where content_key = 'the-breakdown-and-ruck';
  if v_breakdown is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'the-breakdown-and-ruck', 'GAME_CONCEPT', 'The Breakdown and Ruck',
      'When a Union ball-carrier is tackled, both teams can compete for the ball on the ground at the breakdown, and a ruck forms once players bind over it.',
      'union', 'POSSESSION_AND_CONTINUITY', 6,
      'This is the single biggest structural difference from League: in Union, the tackle does not guarantee the tackled team keeps the ball.',
      'The ball-carrier goes to ground, support players arrive and bind to compete for or protect the ball, and a ruck forms until the ball emerges.',
      'How quickly a team''s support players arrive at the breakdown — a slow arrival is often where possession is lost.',
      'If the attacking team wins clean, fast ball, the attack continues into a new phase; if the contest is lost, possession turns over on the spot.'
    ) returning id into v_breakdown;
    insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
      select v_breakdown, id from public.regulatory_identities where rugby_code = 'union'
      and not exists (select 1 from public.hub_content_applicability a where a.content_item_id = v_breakdown and a.regulatory_identity_id = regulatory_identities.id);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_breakdown, id from public.hub_skills where skill_key = 'contact-and-breakdown-work';
    insert into public.hub_content_item_positions (content_item_id, position_id) select v_breakdown, id from public.hub_positions where position_key in ('union-openside-flanker', 'union-number-eight', 'union-hooker');
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_breakdown;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_breakdown;
  end if;

  -- 6b. The play-the-ball (League)
  select id into v_playtheball from public.hub_content_items where content_key = 'the-play-the-ball';
  if v_playtheball is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'the-play-the-ball', 'GAME_CONCEPT', 'The Play-the-Ball',
      'When a League ball-carrier is tackled, there is no contest for the ball — the tackled player''s team keeps it and restarts play with a play-the-ball.',
      'league', 'POSSESSION_AND_CONTINUITY', 6,
      'This is the single biggest structural difference from Union: in League, a tackle does not risk losing the ball on the spot, but it does cost one of a limited number of attempts.',
      'The tackled player gets up, faces their own attacking direction, and plays the ball backwards with their foot to the dummy-half, who restarts the attack.',
      'How many tackles a team has used — the play-the-ball is also the moment that tackle count ticks forward towards the end of the set.',
      'The dummy-half either runs, passes, or the set continues into its next tackle, phase by phase, until the tackle count runs out.'
    ) returning id into v_playtheball;
    insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
      select v_playtheball, id from public.regulatory_identities where rugby_code = 'league'
      and not exists (select 1 from public.hub_content_applicability a where a.content_item_id = v_playtheball and a.regulatory_identity_id = regulatory_identities.id);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_playtheball, id from public.hub_skills where skill_key = 'play-the-ball-and-restart';
    insert into public.hub_content_item_positions (content_item_id, position_id) select v_playtheball, id from public.hub_positions where position_key = 'league-hooker';
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_playtheball;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_playtheball;
  end if;

  -- Cross-link the two post-tackle concepts to each other (genuine, not filler -- they are the direct code-specific counterpart of one journey step).
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values (v_breakdown, v_playtheball, 'CONCEPT_RELATED') on conflict do nothing;
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values (v_playtheball, v_breakdown, 'CONCEPT_RELATED') on conflict do nothing;

  -- 7. Attack and defence
  select id into v_attackdefence from public.hub_content_items where content_key = 'attack-and-defence';
  if v_attackdefence is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'attack-and-defence', 'GAME_CONCEPT', 'Attack and Defence',
      'Attacking teams try to create space and outnumber defenders; defending teams try to close space down and match attackers one-on-one.',
      'ATTACK_AND_DEFENCE', 7,
      'Almost every individual moment in rugby — a pass, a tackle, a support run — is really a small battle for space, and this is the concept that explains why.',
      'Attackers spread width to stretch a defensive line, look for a numbers advantage, and use support runners; defenders press up quickly (line speed) to deny time and space.',
      'Whether the defending line is moving forward together (good line speed) or getting stretched thin — that tells you who is winning the space battle.',
      'A broken defensive line usually leads to a line break and a real attacking opportunity, or a turnover if the defence recovers and forces an error.'
    ) returning id into v_attackdefence;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_attackdefence, true);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_attackdefence, id from public.hub_skills where skill_key in ('running-and-evasion', 'decision-making-under-pressure', 'on-field-communication');
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_attackdefence;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_attackdefence;
  end if;

  -- 8. How play restarts
  select id into v_restarts from public.hub_content_items where content_key = 'how-play-restarts';
  if v_restarts is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next, union_league_difference)
    values (
      'how-play-restarts', 'GAME_CONCEPT', 'How Play Restarts',
      'Play restarts with a kick after every score and at the start of each half — how that kick works, and who gets the ball, changes by age grade and code.',
      'RESTARTS_AND_SET_PIECES', 8,
      'A restart is a genuine chance to win the ball straight back or to territorially reset — it is not just a formality between periods of "real" play.',
      'One team kicks the ball from the halfway line; the receiving team either catches and counter-attacks, or contests it in the air depending on the kick.',
      'How far back the chasing/receiving team has to stand — this distance genuinely changes as players get older, which is exactly the kind of detail worth checking for your own age grade rather than assuming.',
      'Whoever ends up with the ball after the restart begins a fresh attacking sequence, right back at the start of the journey — possession, then territory, then contact.',
      'Union''s age-grade restart distances step up from 3 metres at the very youngest ages to 10 metres by the mid-teens, changing what a fair contest looks like — see the sourced facts below for your own age group rather than assuming the adult distance.'
    ) returning id into v_restarts;
    v_content_restarts := v_restarts;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_restarts, true);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_restarts, id from public.hub_skills where skill_key in ('kicking-for-territory-and-tactics', 'play-the-ball-and-restart');

    for v_fact in
      select id from public.regulatory_facts
      where fact_key in ('RFU-REG15-APP-U7-U10-RESTART', 'RFU-REG15-APP-U11-RESTART', 'RFU-REG15-APP-U12-RESTART', 'RFU-REG15-APP-U13-RESTART', 'RFU-REG15-APP-U14-RESTART')
    loop
      insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type) values (v_fact, v_restarts, 'RULE_EXPLANATION');
    end loop;

    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_restarts;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_restarts;
  end if;

  -- 9a. The scrum and lineout (Union) -- explains where it sits in game flow; the technique itself is taught by the existing scrum-and-lineout-technique skill, not repeated here.
  select id into v_scrumlineout from public.hub_content_items where content_key = 'the-scrum-and-lineout-in-play';
  if v_scrumlineout is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'the-scrum-and-lineout-in-play', 'GAME_CONCEPT', 'The Scrum and Lineout in Play',
      'Scrums and lineouts are Union''s structured restarts after specific stoppages — a scrum for a minor infringement, a lineout after the ball goes into touch.',
      'union', 'RESTARTS_AND_SET_PIECES', 9,
      'These are the moments the game deliberately pauses and resets with real structure, so understanding them explains a big chunk of a Union team''s pack strategy.',
      'A scrum brings the forwards together to restart with a contested feed; a lineout throws the ball in from touch, contested by jumpers lifted by their team-mates.',
      'Which team gets the throw-in or the feed — possession from a set piece is often a bigger prize than the set piece itself, since it starts a fresh attacking sequence.',
      'Winning clean set-piece ball hands the backs a platform to attack from; losing it turns possession over immediately, before the attack even starts.'
    ) returning id into v_scrumlineout;
    insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
      select v_scrumlineout, id from public.regulatory_identities where rugby_code = 'union'
      and not exists (select 1 from public.hub_content_applicability a where a.content_item_id = v_scrumlineout and a.regulatory_identity_id = regulatory_identities.id);
    insert into public.hub_content_item_positions (content_item_id, position_id) select v_scrumlineout, id from public.hub_positions where position_key in ('union-loosehead-prop', 'union-hooker', 'union-tighthead-prop', 'union-lock-four', 'union-lock-five');
    -- Deep-link to the skill that teaches the technique itself, and to that skill's own regulatory sourcing -- never repeated here.
    insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type)
      select v_scrumlineout, l.content_item_id, 'RELATED_KNOWLEDGE'
      from public.hub_skill_content_links l join public.hub_skills s on s.id = l.skill_id
      where s.skill_key = 'scrum-and-lineout-technique'
      on conflict do nothing;
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_scrumlineout;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_scrumlineout;
  end if;

  -- 9b. Tackle count and set restarts (League)
  select id into v_tacklecount from public.hub_content_items where content_key = 'tackle-count-and-set-restarts';
  if v_tacklecount is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, rugby_code, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'tackle-count-and-set-restarts', 'GAME_CONCEPT', 'Tackle Count and Set Restarts',
      'League gives the attacking team a fixed number of tackles (a set) to make ground before possession passes to the other team, with no contest at the tackle itself.',
      'league', 'RESTARTS_AND_SET_PIECES', 9,
      'This "use it or lose it" structure is what gives League its distinctive rhythm of building phases towards a set limit, rather than an open-ended contest for the ball.',
      'The attacking team plays through the tackle count via repeated play-the-balls, trying to gain as much ground as possible before the set ends.',
      'How many tackles have been used, and how much ground the team has actually made — a team deep in its own half late in the set usually kicks rather than risking a turnover in place.',
      'On the last tackle the team usually kicks strategically for territory, since running out of tackles simply hands the ball over where the play stopped.'
    ) returning id into v_tacklecount;
    insert into public.hub_content_applicability (content_item_id, regulatory_identity_id)
      select v_tacklecount, id from public.regulatory_identities where rugby_code = 'league'
      and not exists (select 1 from public.hub_content_applicability a where a.content_item_id = v_tacklecount and a.regulatory_identity_id = regulatory_identities.id);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_tacklecount, id from public.hub_skills where skill_key = 'play-the-ball-and-restart';
    insert into public.hub_content_item_positions (content_item_id, position_id) select v_tacklecount, id from public.hub_positions where position_key = 'league-hooker';
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_tacklecount;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_tacklecount;
  end if;

  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values (v_scrumlineout, v_tacklecount, 'CONCEPT_RELATED') on conflict do nothing;
  insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type) values (v_tacklecount, v_scrumlineout, 'CONCEPT_RELATED') on conflict do nothing;

  -- 10. Penalties and advantage
  select id into v_penalties from public.hub_content_items where content_key = 'penalties-and-advantage';
  if v_penalties is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next)
    values (
      'penalties-and-advantage', 'GAME_CONCEPT', 'Penalties and Advantage',
      'When the referee sees an infringement, the non-offending team is usually offered advantage first — a chance to benefit from playing on before a penalty is confirmed.',
      'LAWS_IN_PLAY', 10,
      'This is why play often continues for several seconds after an obvious infringement — the referee is deliberately waiting to see if playing on is better for the team that was wronged.',
      'Play continues while the referee assesses whether the non-offending team gains a real advantage; if it doesn''t materialise, play comes back for the original penalty.',
      'A referee with an arm outstretched, tracking play — that is the visible sign advantage is being played, before either a penalty is awarded or "advantage over" is called.',
      'A penalty typically restarts the game with a kick — for territory, at goal, or (in Union) a scrum — handing the non-offending team a fresh attacking platform.'
    ) returning id into v_penalties;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_penalties, true);
    insert into public.hub_skill_content_links (content_item_id, skill_id) select v_penalties, id from public.hub_skills where skill_key = 'decision-making-under-pressure';
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_penalties;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_penalties;
  end if;

  -- 11. How a game flows -- the flagship concept, tying the whole journey together.
  select id into v_flow from public.hub_content_items where content_key = 'how-a-game-flows';
  if v_flow is null then
    insert into public.hub_content_items (content_key, content_type, title, summary, concept_family, journey_order, why_it_matters, what_happens, what_to_watch_for, what_happens_next, union_league_difference)
    values (
      'how-a-game-flows', 'GAME_CONCEPT', 'How a Game Flows',
      'A rugby match is one repeating cycle: a restart, an attack, a moment of contact, then either continuity, a score, a turnover or a penalty — and the cycle begins again.',
      'GAME_FLOW', 11,
      'Every concept in this journey is really one piece of this single repeating cycle — seeing the whole loop is what makes a match click into place as a connected system rather than isolated moments.',
      'Possession starts from a restart or set piece, the team in possession attacks until contact, the two codes handle that contact differently, and the outcome either continues the attack, ends in a score, or hands the ball over.',
      'Which stage of the cycle is happening right now — restart, attack, contact, or resolution — and which way the ball is about to go next.',
      'Whatever the outcome, the cycle restarts immediately: a score leads to a restart, a turnover flips who is attacking, and a penalty resets with a fresh platform.',
      'The cycle is identical in shape for both codes right up to the contact moment — where Union resolves it through a contestable breakdown and League resolves it through an uncontested play-the-ball and tackle count — the one point where the two games genuinely diverge.'
    ) returning id into v_flow;
    insert into public.hub_content_applicability (content_item_id, is_universal) values (v_flow, true);
    -- The flagship links to every concept that is literally a stage of the cycle -- genuine, not filler.
    insert into public.hub_content_relationships (content_item_id, related_content_item_id, relationship_type)
      select v_flow, x, 'RELATED_KNOWLEDGE' from unnest(array[v_possession, v_breakdown, v_playtheball, v_attackdefence, v_restarts, v_penalties]) as x
      on conflict do nothing;
    update public.hub_content_items set status='REVIEWED', reviewed_by=v_actor, reviewed_at=now() where id = v_flow;
    update public.hub_content_items set status='PUBLISHED', published_by=v_actor, published_at=now() where id = v_flow;
  end if;

end $$;
