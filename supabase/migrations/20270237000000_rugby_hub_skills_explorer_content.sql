-- Skills Explorer: teaching-structured columns on the existing hub_skills
-- table (no second skill store), plus real content for the 10 skill
-- identities Position Explorer already created and linked to.
--
-- SCHEMA EXTENSION, NOT A NEW MODEL: hub_skills previously carried only
-- identity + a one-line summary -- enough to exist as a linkable concept,
-- not enough to teach anything. hub_positions already established the
-- pattern this migration extends to skills: dedicated typed columns per
-- teaching section, populated only where genuinely supported, rendered
-- only where non-null. technique_steps is a single jsonb column (an array
-- of {label, text}) rather than separate Setup/Execution/Finish and
-- See/Decide/Act columns, because it is the SAME shape either way -- the
-- label vocabulary is data, chosen per skill by what actually teaches it,
-- never a template forced in React (section 7). A skill with no step
-- model (on-field-communication, game-management -- genuinely ongoing
-- awareness, not a single repeatable action) simply has technique_steps
-- = null, and the UI renders no "How to do it" steps section for it.
--
-- CONTENT AUDIT (required before adding anything, section 19): the 10
-- existing skill identities (from Position Explorer) were reviewed. Nine
-- get full teaching content below. The tenth, set-piece-technique,
-- deliberately does NOT: its own summary already conflates two mechanically
-- unrelated techniques (Union scrummaging, League's play-the-ball) under
-- one skill row, and writing genuine step-by-step technique for "set piece"
-- as if it were one skill would misrepresent both. Rather than invent a
-- false-universal technique, this migration leaves it as a real identity
-- with its existing summary only (no technique_steps, no fabricated
-- content) and this is disclosed in the final report as needing an actual
-- schema decision (split into code-specific skills) in a future slice --
-- not fixed here, per the standing instruction not to mass-generate filler
-- or invent structure merely to fill a section.
--
-- SAFETY (section 10): tackling-technique intersects real, already-sourced
-- regulatory truth -- RFU-REG15-2026-CONTACT-NOT-PERMITTED-U7-U8 and
-- RFU-REG15-2026-CONTACT-PERMITTED-U9-PLUS (existing regulatory_facts,
-- already applicability-scoped to real identities). This migration does
-- NOT restate that rule as prose: it creates one hub_content_items row
-- that exists specifically to carry the two RULE_EXPLANATION references
-- (hub_regulatory_fact_references, the existing sanctioned mechanism) and
-- links it to the skill via hub_skill_content_links (SKILL_TRAINING),
-- exactly the join the schema already provides for "content that develops
-- this skill." The application layer renders the linked regulatory facts
-- directly when it detects the viewer's own regulatory identity falls
-- under the NOT-PERMITTED fact -- never a second, invented age threshold.
-- No equivalent League contact-introduction fact exists yet in
-- regulatory_facts; this migration does not invent one, and the gap is
-- disclosed in the report rather than silently assumed either way.

alter table public.hub_skills
  add column if not exists why_it_matters text,
  add column if not exists when_you_use_it text,
  add column if not exists key_cues text,
  add column if not exists common_mistakes text,
  add column if not exists how_to_improve text,
  add column if not exists game_examples text,
  add column if not exists technique_steps jsonb;

comment on column public.hub_skills.technique_steps is 'Nullable ordered array of {label, text} teaching steps — e.g. Setup/Execution/Finish for a physical technique, or See/Decide/Act for a decision skill. The label vocabulary is data chosen per skill, never a template hardcoded in the UI (section 7 of the Skills Explorer brief). Null means this skill has no single repeatable step sequence (an ongoing-awareness skill like game management) — the UI renders no steps section for it, never an empty one.';
comment on column public.hub_skills.why_it_matters is 'Why this skill matters in a match, in plain language — not a restated law.';
comment on column public.hub_skills.when_you_use_it is 'The real in-game moments this skill applies to.';
comment on column public.hub_skills.key_cues is 'Short, memorable cue phrase(s) a coach would actually say — what to look/feel for, not a restatement of the steps.';
comment on column public.hub_skills.common_mistakes is 'The most common, genuinely observable technical error(s) for this skill.';
comment on column public.hub_skills.how_to_improve is 'A concrete, practice-oriented development note — never a training-session prescription (that is Training Centre''s domain, not Rugby Hub''s).';
comment on column public.hub_skills.game_examples is 'Concrete, recognisable match scenarios where this skill shows up, to connect the teaching to the real game.';

do $$
declare
  v_actor uuid;
  v_passing uuid; v_catching uuid; v_tackling uuid; v_kicking uuid; v_comms uuid;
  v_decisions uuid; v_gamemanagement uuid; v_breakdown uuid; v_evasion uuid; v_setpiece uuid;
  v_content_tackle_age uuid;
  v_fact_not_permitted uuid;
  v_fact_permitted uuid;
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

  select id into v_passing from public.hub_skills where skill_key = 'passing-under-pressure';
  select id into v_catching from public.hub_skills where skill_key = 'catching-under-pressure';
  select id into v_tackling from public.hub_skills where skill_key = 'tackling-technique';
  select id into v_kicking from public.hub_skills where skill_key = 'kicking-for-territory-and-tactics';
  select id into v_comms from public.hub_skills where skill_key = 'on-field-communication';
  select id into v_decisions from public.hub_skills where skill_key = 'decision-making-under-pressure';
  select id into v_gamemanagement from public.hub_skills where skill_key = 'game-management';
  select id into v_breakdown from public.hub_skills where skill_key = 'contact-and-breakdown-work';
  select id into v_evasion from public.hub_skills where skill_key = 'running-and-evasion';
  select id into v_setpiece from public.hub_skills where skill_key = 'set-piece-technique';

  -- ============ PASSING ============
  update public.hub_skills set
    why_it_matters = 'Passing moves the ball faster than any defender can run, creating and using space that carrying alone can''t reach.',
    when_you_use_it = 'Whenever you have the ball and a team-mate is in better space than you — from first-phase ball off a set piece to the tenth phase of a long attacking sequence.',
    key_cues = 'Eyes up, hands soft, follow through at the target.',
    common_mistakes = 'Passing off the back foot with no weight transfer, which shortens the pass and telegraphs it to the defence.',
    how_to_improve = 'Practise passing off both hands at increasing distance and under real time pressure, not just standing still and unopposed.',
    game_examples = 'A scrum-half''s pass from the base of a ruck, or a centre''s pass that puts a winger away in space on the outside.',
    technique_steps = '[
      {"label":"Setup","text":"Get side-on to your target with the ball held away from the defender, in two hands, fingers spread across the panel."},
      {"label":"Execution","text":"Step towards your target as you release, transferring your weight from back foot to front foot and following through with your hands."},
      {"label":"Finish","text":"Keep your hands pointing at the target after release, so the receiver can read the pass early and it arrives at a height they can catch in stride."}
    ]'::jsonb
  where id = v_passing;

  -- ============ CATCHING ============
  update public.hub_skills set
    why_it_matters = 'Catching cleanly is what makes every other skill possible — a dropped ball ends the attack before passing, evasion or decision-making even come into it.',
    when_you_use_it = 'Receiving a pass, taking a high ball, or fielding a kick.',
    key_cues = 'Eyes on the ball, hands as a target, bring it in.',
    common_mistakes = 'Watching the defender instead of the ball, which is what causes a catch to be dropped or fumbled.',
    how_to_improve = 'Catch progressively harder passes — different heights, speeds, and with a defender closing in — rather than only easy, stationary catches.',
    game_examples = 'Taking a high ball under pressure from a chasing winger, or catching a pass at full pace in midfield.',
    technique_steps = '[
      {"label":"Setup","text":"Move towards the ball early and call for it, so the passer knows you are ready to receive."},
      {"label":"Execution","text":"Watch the ball all the way into your hands, fingers spread and hands presented as a clear target for the passer."},
      {"label":"Finish","text":"Bring the ball into your body as you secure it, ready to pass, carry or evade immediately."}
    ]'::jsonb
  where id = v_catching;

  -- ============ TACKLING (safety-linked) ============
  update public.hub_skills set
    why_it_matters = 'A safe, well-executed tackle stops the opposition''s momentum and gives your team a real chance to win the ball back.',
    when_you_use_it = 'Whenever an opponent with the ball is running at or past you.',
    key_cues = 'Head up and to the side, eyes on the hips, wrap and squeeze.',
    common_mistakes = 'Leading with the head or tackling too high — both unsafe for the tackler and the ball-carrier, and against the laws of the game.',
    how_to_improve = 'Build tackle technique progressively with a qualified coach, starting with controlled, low-pressure practice before adding pace and opposition.',
    game_examples = 'A last-ditch cover tackle to stop a try, or a low chop tackle that slows the ball down for team-mates to compete at the breakdown.',
    technique_steps = '[
      {"label":"Setup","text":"Get into a strong, balanced position with a low centre of gravity, eyes on the ball-carrier''s hips rather than their feet or shoulders."},
      {"label":"Execution","text":"Drive in with your shoulder making contact below the ball-carrier''s chest, head to the side and never leading with the head, wrapping both arms around the legs or body."},
      {"label":"Finish","text":"Drive your legs through the contact, complete the tackle under control, then release and get back to your feet quickly."}
    ]'::jsonb
  where id = v_tackling;

  -- ============ KICKING (See/Decide/Act) ============
  update public.hub_skills set
    why_it_matters = 'The right kick at the right moment can win territory or field position that running the ball couldn''t.',
    when_you_use_it = 'When running or passing options are covered, and putting the ball into space — or out of danger — is the better choice.',
    key_cues = 'Look up before you kick, chase your own kick.',
    common_mistakes = 'Kicking without a plan for what happens next, giving the ball straight back to the opposition with no pressure applied.',
    how_to_improve = 'Practise different kick types for different purposes, and review afterwards whether the kick actually achieved what the game situation needed.',
    game_examples = 'A box kick from the base of a ruck to contest possession, or a touch-finder to relieve pressure near your own line.',
    technique_steps = '[
      {"label":"See","text":"Read the defensive line and the space in behind it, along with your own team''s chasing options."},
      {"label":"Decide","text":"Choose the kick that fits the moment — territory, contestable, or a tactical grubber — based on what the defence is showing."},
      {"label":"Act","text":"Execute the chosen kick with a clean strike and, where relevant, get your chasers moving before the ball lands."}
    ]'::jsonb
  where id = v_kicking;

  -- ============ COMMUNICATION (no forced steps) ============
  update public.hub_skills set
    why_it_matters = 'The team that talks well defends space no individual could cover alone, and attacks with everyone moving to a shared plan.',
    when_you_use_it = 'Constantly — organising a defensive line, calling for the ball, or communicating around a breakdown or set piece.',
    key_cues = 'Loud, early, and specific — a call that arrives late is no better than no call at all.',
    common_mistakes = 'Calling too late for a team-mate to react, or calls that are too vague to act on (''go!'' instead of naming who and where).',
    how_to_improve = 'Practise calling out loud in training, not just in matches, so it becomes automatic under real pressure.',
    game_examples = 'A fullback organising the back three under a high ball, or a forward calling the defensive line''s shift after a breakdown.'
  where id = v_comms;

  -- ============ DECISION MAKING (See/Decide/Act) ============
  update public.hub_skills set
    why_it_matters = 'The best technique is wasted on the wrong choice — rugby rewards players who read the game accurately, not just those who execute well.',
    when_you_use_it = 'Every time you have the ball, and every time you''re defending and have to choose who or what to react to.',
    key_cues = 'Scan early, decide once, commit fully.',
    common_mistakes = 'Freezing between two options and executing neither well, or deciding before actually looking at what the defence is doing.',
    how_to_improve = 'Practise decision-making in game-realistic scenarios against real defenders, not just unopposed drills.',
    game_examples = 'A fly-half choosing between running, passing or kicking based on the defensive line in front of them.',
    technique_steps = '[
      {"label":"See","text":"Scan the space and the defenders around you before you receive the ball, not after."},
      {"label":"Decide","text":"Choose the option the defence is actually giving you, not the one you practised most."},
      {"label":"Act","text":"Commit to the decision and execute it with conviction — a good decision executed hesitantly often fails anyway."}
    ]'::jsonb
  where id = v_decisions;

  -- ============ GAME MANAGEMENT (no forced steps -- ongoing, not one moment) ============
  update public.hub_skills set
    why_it_matters = 'Individual skill wins moments; game management wins matches, by controlling when and how those moments happen.',
    when_you_use_it = 'Throughout a match, particularly around the scoreboard, the clock, territory, and phase count.',
    key_cues = 'Know the score, know the clock, know what the team needs right now.',
    common_mistakes = 'Playing the same way regardless of the scoreboard or time remaining, rather than adapting to what the situation calls for.',
    how_to_improve = 'Review match situations afterwards and ask whether the team''s choices actually matched what the scoreboard and clock needed.',
    game_examples = 'Taking the points on offer late in a close match rather than chasing a try, or slowing the game down when protecting a lead.'
  where id = v_gamemanagement;

  -- ============ CONTACT & BREAKDOWN ============
  update public.hub_skills set
    why_it_matters = 'Winning quick ball at the breakdown is what lets a team play with tempo; losing it lets the defence reset.',
    when_you_use_it = 'Immediately after every tackle, both as the ball-carrier''s support and as a defender contesting.',
    key_cues = 'Stay on your feet, arrive with control, work the ball.',
    common_mistakes = 'Diving over the ball off your feet, which is both illegal and gives away easy penalties.',
    how_to_improve = 'Practise breakdown technique with a coach who can check body position and legality, not just intensity.',
    game_examples = 'A jackal contest that turns over opposition ball, or forwards clearing out quickly to keep an attack moving fast.',
    technique_steps = '[
      {"label":"Setup","text":"Arrive with real intent and control, reading whether the ball is realistically winnable before you commit."},
      {"label":"Execution","text":"Stay on your feet, get your body low and over the ball, and drive through rather than diving in."},
      {"label":"Finish","text":"Secure or present the ball clearly for the next player, then get back onto your feet to rejoin play."}
    ]'::jsonb
  where id = v_breakdown;

  -- ============ RUNNING & EVASION ============
  update public.hub_skills set
    why_it_matters = 'Beating a defender one-on-one can turn a stopped attack into a line break, without needing a numbers advantage.',
    when_you_use_it = 'Whenever you have the ball in space with a defender to beat, rather than support around you.',
    key_cues = 'Attack the space, not the defender; accelerate out of the step.',
    common_mistakes = 'Stepping too early or too far from the defender, giving them time to readjust.',
    how_to_improve = 'Practise footwork and change of pace against a real defender — a step timed against nobody doesn''t transfer to a game.',
    game_examples = 'A winger beating the last defender in a one-on-one out wide, or a centre stepping inside a rushing defensive line.',
    technique_steps = '[
      {"label":"Setup","text":"Approach the defender at a controlled pace with the ball held securely, reading their body position."},
      {"label":"Execution","text":"Use a change of pace or a footwork step to attack the space the defender''s weight has committed away from."},
      {"label":"Finish","text":"Accelerate away through the gap you''ve created, rather than slowing down to admire the step."}
    ]'::jsonb
  where id = v_evasion;

  -- set-piece-technique deliberately untouched beyond its existing summary -- see header.

  -- =====================================================================
  -- Tackling age-safety: link the real regulatory facts through the
  -- sanctioned mechanism (hub_regulatory_fact_references), never restated
  -- as prose.
  -- =====================================================================

  select id into v_fact_not_permitted from public.regulatory_facts where fact_key = 'RFU-REG15-2026-CONTACT-NOT-PERMITTED-U7-U8';
  select id into v_fact_permitted from public.regulatory_facts where fact_key = 'RFU-REG15-2026-CONTACT-PERMITTED-U9-PLUS';

  if v_fact_not_permitted is not null and v_tackling is not null then
    select id into v_content_tackle_age from public.hub_content_items where content_key = 'when-contact-tackling-is-introduced';
    if v_content_tackle_age is null then
      insert into public.hub_content_items (content_key, content_type, title, summary)
      values (
        'when-contact-tackling-is-introduced', 'COACHING_GUIDANCE', 'When contact tackling is introduced',
        'Tackling is taught progressively, and contact rugby is not introduced at every age grade at once — this links directly to the governing body''s own rule on when it starts.'
      ) returning id into v_content_tackle_age;

      insert into public.hub_content_applicability (content_item_id, is_universal) values (v_content_tackle_age, true);

      insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type)
      values (v_fact_not_permitted, v_content_tackle_age, 'RULE_EXPLANATION');
      if v_fact_permitted is not null then
        insert into public.hub_regulatory_fact_references (regulatory_fact_id, content_item_id, reference_type)
        values (v_fact_permitted, v_content_tackle_age, 'RULE_EXPLANATION');
      end if;

      update public.hub_content_items set status = 'REVIEWED', reviewed_by = v_actor, reviewed_at = now() where id = v_content_tackle_age;
      update public.hub_content_items set status = 'PUBLISHED', published_by = v_actor, published_at = now() where id = v_content_tackle_age;

      insert into public.hub_skill_content_links (skill_id, content_item_id) values (v_tackling, v_content_tackle_age)
      on conflict do nothing;
    end if;
  end if;

  -- =====================================================================
  -- SKILL RELATIONSHIPS -- real, considered pairs only, never derived from
  -- matching words or tags.
  -- =====================================================================

  insert into public.hub_skill_relationships (skill_id, related_skill_id, relationship_type)
  select v.skill_id, v.related_skill_id, v.relationship_type
  from (values
    (v_passing, v_catching, 'PREREQUISITE'),       -- catching comes before passing under pressure
    (v_passing, v_catching, 'RELATED'),
    (v_catching, v_passing, 'RELATED'),
    (v_decisions, v_kicking, 'RELATED'),
    (v_kicking, v_decisions, 'RELATED'),
    (v_decisions, v_evasion, 'RELATED'),
    (v_evasion, v_decisions, 'PREREQUISITE'),      -- deciding to run comes before the footwork itself
    (v_decisions, v_comms, 'RELATED'),
    (v_comms, v_decisions, 'RELATED'),
    (v_tackling, v_breakdown, 'RELATED'),
    (v_breakdown, v_tackling, 'RELATED'),
    (v_gamemanagement, v_decisions, 'RELATED'),
    (v_decisions, v_gamemanagement, 'RELATED')
  ) as v(skill_id, related_skill_id, relationship_type)
  where v.skill_id is not null and v.related_skill_id is not null
  on conflict do nothing;

end $$;
