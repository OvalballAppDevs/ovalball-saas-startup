-- Position Explorer: real (not proof-of-model) position content for both
-- codes, plus the applicability, age-stage, skill, and relationship facts
-- the Explorer needs to be a legitimate experience rather than a mostly-
-- empty pitch.
--
-- COVERAGE, STATED HONESTLY: the 15 Rugby Union starting positions and the
-- 13 Rugby League starting positions -- the roles every player, parent and
-- coach already knows exist. It does not cover replacements/bench roles,
-- 7s, or every regional numbering variation. Where League squads number
-- differently between competitions, the numbering used here is the
-- common modern 1-13 convention; this is disclosed in-product as
-- convention, not asserted as a fixed law.
--
-- PROVENANCE: this is Ovalball educational guidance -- general coaching
-- convention describing what each position does and how it develops --
-- not governing-body regulation. It carries no regulatory_facts citation
-- because it is not a regulatory claim (nothing here is gated by RFU/RFL
-- law; the hub_content_items_no_regulatory_escape_hatch guard on the
-- content-item table would in any case refuse language that tried to
-- assert one). It was written directly for this migration, in the same
-- spirit as 20261031000000_regulatory_content_import.sql's "automated
-- import, not independent human review" disclosure: this is Ovalball's own
-- first-pass educational content, not a governing-body-verified text, and
-- a real coaching/content review pass remains legitimate future work.
--
-- AGE-STAGE RESEARCH: NOT_APPLICABLE is used for the earliest mini/primary
-- age grades (RFU-U6/U7/U8, RFL-PRIMARY), where both unions' own published
-- player-development guidance is that young players rotate broadly through
-- roles rather than specialise. EMERGING is used for the following
-- transitional band (RFU-U9/U10, RFL-U12), where positional identity
-- starts to form but is not yet fixed. Every other identity is left
-- deliberately UNASSESSED here (no row) rather than an invented explicit
-- NORMAL claim for dozens of age grades this migration did not specifically
-- research; the Explorer's resolver treats "no special-case row" as
-- ordinary full exploration, never as a blocked or empty state -- see
-- lib/app-context/position-explorer-data.ts.

do $$
declare
  v_actor uuid;

  -- Union positions
  v_u_loosehead uuid; v_u_hooker uuid; v_u_tighthead uuid;
  v_u_lock1 uuid; v_u_lock2 uuid;
  v_u_blindside uuid; v_u_openside uuid; v_u_number8 uuid;
  v_u_scrumhalf uuid; v_u_flyhalf uuid;
  v_u_leftwing uuid; v_u_insidecentre uuid; v_u_outsidecentre uuid; v_u_rightwing uuid;
  v_u_fullback uuid;

  -- League positions
  v_l_fullback uuid; v_l_rightwing uuid; v_l_rightcentre uuid; v_l_leftcentre uuid; v_l_leftwing uuid;
  v_l_standoff uuid; v_l_halfback uuid;
  v_l_prop1 uuid; v_l_hooker uuid; v_l_prop2 uuid;
  v_l_secondrow1 uuid; v_l_secondrow2 uuid; v_l_looseforward uuid;

  -- Skills
  v_s_passing uuid; v_s_tackling uuid; v_s_catching uuid; v_s_kicking uuid;
  v_s_communication uuid; v_s_decisions uuid; v_s_breakdown uuid; v_s_evasion uuid;
  v_s_setpiece uuid; v_s_gamemanagement uuid;

  v_identity uuid;
begin
  -- A synthetic, clearly-labelled system actor for this migration's own
  -- authorship (see the header comment). No authenticated human session
  -- exists during a migration; regulatory_content_import.sql set this
  -- precedent and this migration follows it exactly, rather than inventing
  -- a second convention.
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

  -- =====================================================================
  -- SKILLS -- a focused, real set. Deliberately not exhaustive: only the
  -- skills this slice's positions actually reference (section 32: do not
  -- mass-populate Skills/Training).
  -- =====================================================================

  select id into v_s_passing from public.hub_skills where skill_key = 'passing-under-pressure';
  if v_s_passing is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('passing-under-pressure', 'Passing Under Pressure', 'HANDLING', 'Delivering an accurate, catchable pass — off either hand, at the right height and speed — while being closed down by a defender.')
    returning id into v_s_passing;
  end if;

  select id into v_s_tackling from public.hub_skills where skill_key = 'tackling-technique';
  if v_s_tackling is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('tackling-technique', 'Tackling Technique', 'CONTACT', 'A safe, effective tackle: getting the head and shoulder position right, driving through the contact, and finishing it under control.')
    returning id into v_s_tackling;
  end if;

  select id into v_s_catching from public.hub_skills where skill_key = 'catching-under-pressure';
  if v_s_catching is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('catching-under-pressure', 'Catching Under Pressure', 'HANDLING', 'Securing the ball cleanly in traffic, in the air, or with a defender closing in — the foundation every other skill on this list depends on.')
    returning id into v_s_catching;
  end if;

  select id into v_s_kicking from public.hub_skills where skill_key = 'kicking-for-territory-and-tactics';
  if v_s_kicking is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('kicking-for-territory-and-tactics', 'Kicking for Territory and Tactics', 'KICKING', 'Using the boot with a purpose — finding grass, pinning the opposition back, or setting up a chase — rather than just kicking the ball away.')
    returning id into v_s_kicking;
  end if;

  select id into v_s_communication from public.hub_skills where skill_key = 'on-field-communication';
  if v_s_communication is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('on-field-communication', 'On-Field Communication', 'COMMUNICATION', 'Clear, early calls that organise team-mates — who to mark, where the space is, what happens next — said loudly and in time to be useful.')
    returning id into v_s_communication;
  end if;

  select id into v_s_decisions from public.hub_skills where skill_key = 'decision-making-under-pressure';
  if v_s_decisions is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('decision-making-under-pressure', 'Decision Making Under Pressure', 'DECISION_MAKING', 'Reading what the game is actually offering in the moment — run, pass or kick — rather than defaulting to the same choice every time.')
    returning id into v_s_decisions;
  end if;

  select id into v_s_breakdown from public.hub_skills where skill_key = 'contact-and-breakdown-work';
  if v_s_breakdown is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('contact-and-breakdown-work', 'Contact and Breakdown Work', 'BREAKDOWN', 'Winning and securing the ball at the point of contact — staying on your feet, arriving with real intent, and keeping the ball available for your team.')
    returning id into v_s_breakdown;
  end if;

  select id into v_s_evasion from public.hub_skills where skill_key = 'running-and-evasion';
  if v_s_evasion is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('running-and-evasion', 'Running and Evasion', 'RUNNING_EVASION', 'Footwork and a change of pace that beats a defender one-on-one, rather than relying purely on straight-line speed.')
    returning id into v_s_evasion;
  end if;

  select id into v_s_setpiece from public.hub_skills where skill_key = 'set-piece-technique';
  if v_s_setpiece is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('set-piece-technique', 'Set-Piece Technique', 'SET_PIECE', 'The specific technical work of scrummaging, lineout lifting/jumping, or a clean, fast play-the-ball — skills practised on their own before they show up in a match.')
    returning id into v_s_setpiece;
  end if;

  select id into v_s_gamemanagement from public.hub_skills where skill_key = 'game-management';
  if v_s_gamemanagement is null then
    insert into public.hub_skills (skill_key, display_name, skill_family, summary)
    values ('game-management', 'Game Management', 'DECISION_MAKING', 'Controlling the pace and shape of a match — when to play fast, when to slow it down, when to take the points on offer — with the wider scoreboard and clock in mind.')
    returning id into v_s_gamemanagement;
  end if;

  -- Publish every skill (universal applicability -- a skill concept applies
  -- to everyone exploring it, regardless of which position brought them
  -- here).
  for v_identity in
    select id from public.hub_skills
    where skill_key in (
      'passing-under-pressure','tackling-technique','catching-under-pressure',
      'kicking-for-territory-and-tactics','on-field-communication','decision-making-under-pressure',
      'contact-and-breakdown-work','running-and-evasion','set-piece-technique','game-management'
    ) and status = 'DRAFT'
  loop
    insert into public.hub_content_applicability (skill_id, is_universal)
    select v_identity, true
    where not exists (select 1 from public.hub_content_applicability where skill_id = v_identity);
    update public.hub_skills set status = 'REVIEWED', reviewed_by = v_actor, reviewed_at = now() where id = v_identity;
    update public.hub_skills set status = 'PUBLISHED', published_by = v_actor, published_at = now() where id = v_identity;
  end loop;

  -- =====================================================================
  -- UNION POSITIONS (15)
  -- =====================================================================

  select id into v_u_loosehead from public.hub_positions where position_key = 'union-loosehead-prop';
  if v_u_loosehead is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-loosehead-prop', 'union', 'Loosehead Prop', array['1','Prop'], 1, 'FRONT_ROW',
      'Anchors the left side of the scrum and provides a physical, direct ball-carrying option close to the ruck.',
      'Short, powerful carries that get the team over the gain line; a reliable pair of hands at the tail of a lineout drive.',
      'Clears out at the breakdown to keep the ball moving; sets a strong body position in the defensive line.',
      'Takes the ball into contact to buy quick ball for the backs; supports the ball-carrier immediately after a break.',
      'Makes the first tackle in a defensive line without missing it; folds around the corner of a ruck quickly.',
      'Binds correctly and holds body height under pressure to keep the scrum stable and legal.',
      'Scrummaging technique, close-quarter ball-carrying, tackling.',
      'Reads whether to carry, clear out, or hold width in a defensive line.',
      'Talks to the hooker and tighthead to keep the scrum square and set.',
      'Building scrummaging technique and lower-body strength safely, and match-fitness for repeated close-quarter work.',
      'Standing up too early in the scrum; drifting out of position in defence chasing the ball.',
      'Wins the scrum battle on their side and is still making good decisions in the same close-quarter work in the 70th minute.',
      0.38, 0.08,
      'A specialist scrummaging role that becomes fixed once players are physically ready for contested scrums — at earlier age grades, forwards rotate through front-row roles rather than specialising.'
    ) returning id into v_u_loosehead;
  end if;

  select id into v_u_hooker from public.hub_positions where position_key = 'union-hooker';
  if v_u_hooker is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-hooker', 'union', 'Hooker', array['2'], 2, 'FRONT_ROW',
      'Throws the ball in at every lineout and strikes for the ball at the centre of the scrum — the position most directly responsible for winning set-piece possession.',
      'An accurate lineout throw to a called target; a direct carry off the back of a driving maul.',
      'Organises the lineout call and jumpers; the third point of contact in a scrum, driving straight.',
      'Carries strongly off nine when the forwards need to make ground close to the ruck.',
      'A physical, direct tackler who is often first to a breakdown after a set piece.',
      'Strikes cleanly for the ball in the scrum; delivers a consistently accurate lineout throw under pressure.',
      'Lineout throwing, scrummaging, breakdown work.',
      'Decides the lineout call and adjusts it based on what the defence is showing.',
      'The loudest organiser at every lineout — calls the target and the timing.',
      'Lineout throwing accuracy under fatigue and pressure, alongside the same scrummaging foundations as the props.',
      'A rushed or inaccurate lineout throw under pressure; striking early in the scrum before the ball is fed.',
      'Their throw is trusted by the jumpers because it arrives in the same place, at the same pace, every time.',
      0.5, 0.06,
      'A specialist role built on lineout throwing repetition — at earlier age grades, before contested lineouts and scrums are introduced, this role does not yet exist in its adult form.'
    ) returning id into v_u_hooker;
  end if;

  select id into v_u_tighthead from public.hub_positions where position_key = 'union-tighthead-prop';
  if v_u_tighthead is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-tighthead-prop', 'union', 'Tighthead Prop', array['3','Prop'], 3, 'FRONT_ROW',
      'Anchors the right side of the scrum, usually the technically hardest scrummaging role, and provides the same close-quarter physicality as the loosehead.',
      'Short, powerful carries close to the ruck; a strong presence in a driving maul.',
      'Clears out at the breakdown; sets a stable, hard-to-shift body position in defence.',
      'Takes the ball into contact to secure quick ball; supports immediately after a line break.',
      'A dependable first tackler in a defensive line; folds to the breakdown quickly.',
      'Holds body height and angle against the opposing loosehead to prevent the scrum being turned.',
      'Scrummaging technique (especially body angle under pressure), close-quarter ball-carrying, tackling.',
      'Reads when to hold the scrum steady versus when it is safe to drive forward.',
      'Talks to the hooker and loosehead to keep the scrum square and set.',
      'The specific technical demands of the tighthead side of the scrum, plus the same fitness and strength foundations as the loosehead.',
      'Losing body height under scrum pressure; over-committing to a carry and being isolated.',
      'Gives the scrum-half quick, stable ball from the scrum even against sustained pressure.',
      0.62, 0.08,
      'A specialist scrummaging role that becomes fixed once players are physically ready for contested scrums — at earlier age grades, forwards rotate through front-row roles rather than specialising.'
    ) returning id into v_u_tighthead;
  end if;

  select id into v_u_lock1 from public.hub_positions where position_key = 'union-lock-four';
  if v_u_lock1 is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-lock-four', 'union', 'Lock', array['4','Second Row'], 4, 'SECOND_ROW',
      'Provides the engine room of the scrum and the primary jumping and lifting option at the lineout.',
      'A strong, direct carry designed to get the pack moving forward; a reliable target in the air at a lineout.',
      'Pushes in the second row of the scrum; a genuine physical presence at every breakdown.',
      'Offers a consistent carrying option to keep forward momentum going phase after phase.',
      'Wins collisions in the middle of the pitch and competes hard at the breakdown.',
      'Locks bind and drive together to add power to the scrum; jumps or lifts at the lineout depending on the call.',
      'Lineout jumping or lifting, scrummaging power, ball-carrying under contact.',
      'Reads whether to carry into contact or offer support around a phase.',
      'Calls their own lineout jump clearly and in time for the throw.',
      'Building the aerial timing needed for lineout work alongside core scrummaging strength.',
      'Mistiming a lineout jump; getting isolated in the tackle without support arriving.',
      'Wins their lineout ball consistently and is still a physical presence at the breakdown deep into the match.',
      0.42, 0.2,
      'A role that assumes a full, contested scrum and lineout — at earlier age grades, before those are introduced, forwards experience a range of roles rather than fixing into this one.'
    ) returning id into v_u_lock1;
  end if;

  select id into v_u_lock2 from public.hub_positions where position_key = 'union-lock-five';
  if v_u_lock2 is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-lock-five', 'union', 'Lock', array['5','Second Row'], 5, 'SECOND_ROW',
      'Partners the other lock in the engine room of the scrum and shares the lineout jumping and lifting workload.',
      'A strong, direct carry designed to get the pack moving forward; a reliable target in the air at a lineout.',
      'Pushes in the second row of the scrum; a genuine physical presence at every breakdown.',
      'Offers a consistent carrying option to keep forward momentum going phase after phase.',
      'Wins collisions in the middle of the pitch and competes hard at the breakdown.',
      'Locks bind and drive together to add power to the scrum; jumps or lifts at the lineout depending on the call.',
      'Lineout jumping or lifting, scrummaging power, ball-carrying under contact.',
      'Reads whether to carry into contact or offer support around a phase.',
      'Calls their own lineout jump clearly and in time for the throw.',
      'Building the aerial timing needed for lineout work alongside core scrummaging strength.',
      'Mistiming a lineout jump; getting isolated in the tackle without support arriving.',
      'Wins their lineout ball consistently and is still a physical presence at the breakdown deep into the match.',
      0.58, 0.2,
      'A role that assumes a full, contested scrum and lineout — at earlier age grades, before those are introduced, forwards experience a range of roles rather than fixing into this one.'
    ) returning id into v_u_lock2;
  end if;

  select id into v_u_blindside from public.hub_positions where position_key = 'union-blindside-flanker';
  if v_u_blindside is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-blindside-flanker', 'union', 'Blindside Flanker', array['6','Flanker'], 6, 'BACK_ROW',
      'A physical, direct back-row forward, often used to carry hard close to a ruck and to defend the shorter side of the pitch.',
      'Direct, hard carries close to the breakdown; support running off a line break.',
      'Binds on the short side of the scrum; the first line of defence on the narrow side of a ruck.',
      'Provides go-forward ball close to the ruck, phase after phase.',
      'Reads and shuts down the narrow-side attacking option before it develops.',
      'Binds low and drives at the scrum edge; competes for the ball at every breakdown.',
      'Ball-carrying under contact, tackling, breakdown work.',
      'Reads whether the short side needs defending or whether to join the main defensive line.',
      'Organises the short-side defence, which is easy for team-mates to lose track of.',
      'Building the all-round contact skills — carrying and tackling in equal measure — this role demands.',
      'Ignoring the short side to chase the ball everywhere; carrying into heavy traffic instead of offloading.',
      'Still winning collisions at the breakdown, both carrying and defending, in the closing stages of a match.',
      0.28, 0.32,
      'A role built on contested breakdown and scrum play — at earlier age grades, before those are introduced, players experience a range of forward roles rather than fixing into this one.'
    ) returning id into v_u_blindside;
  end if;

  select id into v_u_openside from public.hub_positions where position_key = 'union-openside-flanker';
  if v_u_openside is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-openside-flanker', 'union', 'Openside Flanker', array['7','Flanker'], 7, 'BACK_ROW',
      'The forward most focused on winning the ball back at the breakdown, usually the first player to arrive at contact from open play.',
      'Quick support running to keep an attack moving; sharp handling in tight spaces.',
      'Arrives first at the breakdown to compete for the ball or protect it.',
      'Links quickly between forwards and backs to keep phase play flowing.',
      'Chases hard to be first to the tackle contest and slows or steals opposition ball.',
      'Binds on the open side of the scrum, ready to release and chase.',
      'Breakdown work, decision making at the tackle contest, work-rate.',
      'Reads, in a split second, whether to compete for the ball, protect it, or move on to the next contact.',
      'Calls out the state of a breakdown so the defensive line knows whether the ball is being contested.',
      'The judgement to know when a breakdown is winnable versus when competing risks conceding a penalty.',
      'Competing for the ball when it is already clearly lost, conceding a penalty for the team.',
      'Is still first to the majority of breakdowns and making good decisions there in the final quarter.',
      0.72, 0.32,
      'A role built on contested breakdown play — at earlier age grades, before this is introduced, players experience a range of forward roles rather than fixing into this one.'
    ) returning id into v_u_openside;
  end if;

  select id into v_u_number8 from public.hub_positions where position_key = 'union-number-eight';
  if v_u_number8 is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-number-eight', 'union', 'Number 8', array['8'], 8, 'BACK_ROW',
      'Controls the base of the scrum and links the forwards to the backs, often the pack''s most dangerous ball-carrier.',
      'Picks and drives from the back of the scrum; powerful carries that break the gain line.',
      'The last forward bound into the scrum, able to detach and cover immediately.',
      'Decides whether to launch an attack straight off the base of the scrum.',
      'Covers across the width of the pitch given a starting position at the back of the pack.',
      'Controls the ball at the base of the scrum, choosing when to release it.',
      'Ball-carrying, decision making at the base of the scrum, tackling.',
      'Reads the defence to decide: pick and go, feed the scrum-half, or move the ball wide immediately.',
      'The link between the forwards and the scrum-half, calling the base-of-scrum option.',
      'The ball-handling and decision-making needed to control possession at the base of a scrum.',
      'A predictable pick-and-drive every time, allowing the defence to read it early.',
      'Is still the pack''s most direct attacking outlet late into a physical match.',
      0.5, 0.34,
      'A role built on controlling the base of a contested scrum — at earlier age grades, before this is introduced, players experience a range of forward roles rather than fixing into this one.'
    ) returning id into v_u_number8;
  end if;

  select id into v_u_scrumhalf from public.hub_positions where position_key = 'union-scrum-half';
  if v_u_scrumhalf is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-scrum-half', 'union', 'Scrum-Half', array['9','Number Nine'], 9, 'HALF_BACKS',
      'Links the forwards and backs, delivering the ball quickly and accurately from every set-piece and breakdown.',
      'Fast, accurate passing off both hands; sniping runs close to the ruck when the defence is narrow.',
      'Organises forwards at the breakdown and reads the ruck to protect or quicken the ball.',
      'Sets the tempo of an attack by how quickly and where the ball is delivered.',
      'Often the first defender to react around the fringes of a ruck.',
      'Feeds the scrum and clears the ball from the base of a ruck or maul.',
      'Passing (especially off both hands), box-kicking, reading the breakdown.',
      'Reads each ruck to decide: quick ball, hold it, or box-kick for territory.',
      'The loudest organiser of the forwards around every breakdown.',
      'Passing speed and accuracy under real defensive pressure, from both sides of the body.',
      'A slow, telegraphed pass that lets the defence reset before the next phase.',
      'Their service stays quick and accurate even when the forwards are tiring late in the game.',
      0.5, 0.46,
      'At younger age grades this role is shared and rotated rather than fixed to one player, since the whole team is still building the handling and decision-making it depends on.'
    ) returning id into v_u_scrumhalf;
  end if;

  select id into v_u_flyhalf from public.hub_positions where position_key = 'union-fly-half';
  if v_u_flyhalf is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-fly-half', 'union', 'Fly-Half', array['10','Number Ten','Outside-Half'], 10, 'HALF_BACKS',
      'The team''s principal on-field decision maker, directing where and how an attack is played.',
      'Accurate passing to set the backline in motion; tactical and goal kicking; the ability to beat a defender one-on-one.',
      'Reads the defensive line to organise team-mates around them.',
      'Chooses the attacking shape — move it wide, kick for territory, or attack the line directly.',
      'Usually the first receiver a defence targets, so needs a reliable, low tackle technique.',
      'Often takes penalty and conversion kicks; receives directly from scrum-half at every set piece.',
      'Game management, passing, kicking (tactical and often goal-kicking), tackling.',
      'Constantly reads the defensive line and the scoreboard to choose the right option, not just the practised one.',
      'The loudest voice organising the backline''s shape before the ball even arrives.',
      'Composure and decision-making speed under direct defensive pressure.',
      'Forcing the same play regardless of what the defence is showing.',
      'Their decisions still fit what the game actually needs in a close match''s final minutes.',
      0.5, 0.58,
      'At younger age grades this role is shared and rotated rather than fixed to one player, since the whole team is still building the handling and decision-making it depends on.'
    ) returning id into v_u_flyhalf;
  end if;

  select id into v_u_leftwing from public.hub_positions where position_key = 'union-left-wing';
  if v_u_leftwing is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-left-wing', 'union', 'Left Wing', array['11','Winger'], 11, 'BACK_THREE',
      'The outside finisher on the left edge of the pitch, converting space created further infield into tries.',
      'Finishing pace and footwork in open space; a reliable pair of hands under a high ball.',
      'Covers the width and depth behind the main defensive line.',
      'Finds and finishes the space the rest of the backline creates.',
      'The last line of defence on their edge, and often covers behind the fullback.',
      'Rarely involved directly, but must be ready to receive from a wide set-piece move.',
      'Running and evasion, catching under pressure (especially the high ball), finishing.',
      'Reads when to come looking for work infield versus staying wide for the pass.',
      'Calls for the ball early when space appears, so the pass arrives in time to use it.',
      'Building the aerial and positional skills to defend a high ball as confidently as attacking one.',
      'Drifting too far infield and leaving the edge undefended.',
      'Still finishing chances cleanly and defending their edge reliably in a tired final quarter.',
      0.08, 0.62,
      null
    ) returning id into v_u_leftwing;
  end if;

  select id into v_u_insidecentre from public.hub_positions where position_key = 'union-inside-centre';
  if v_u_insidecentre is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-inside-centre', 'union', 'Inside Centre', array['12','Number Twelve'], 12, 'MIDFIELD',
      'A direct, physical presence in midfield who takes the ball into contact and creates go-forward ball close to the fly-half.',
      'Strong carries that break the first tackle; a short, quick pass in tight space.',
      'The first line of midfield defence, often facing the biggest opposition ball-carriers.',
      'Takes on defenders close to the fly-half to generate quick ball for the outside backs.',
      'A dependable, physical tackler who sets the tone of the midfield defensive line.',
      'Rarely directly involved, but supports the backline shape from every set piece.',
      'Tackling, ball-carrying under contact, short passing.',
      'Reads whether to carry through contact or release the ball to a support runner.',
      'Organises the midfield defensive line alongside the outside centre.',
      'The physical foundations for repeated heavy contact, alongside handling under pressure.',
      'Running into contact without a support option nearby.',
      'Still winning the collision and making the right pass out of it deep into the match.',
      0.36, 0.72,
      null
    ) returning id into v_u_insidecentre;
  end if;

  select id into v_u_outsidecentre from public.hub_positions where position_key = 'union-outside-centre';
  if v_u_outsidecentre is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-outside-centre', 'union', 'Outside Centre', array['13','Number Thirteen'], 13, 'MIDFIELD',
      'The link between midfield and the back three, usually the most dangerous attacking runner in open space.',
      'A powerful step or turn of pace to beat the last line of midfield defence; the vision to put a winger away.',
      'The furthest-out midfield defender, often the first to react to an opposition winger.',
      'Looks to beat their opposite number one-on-one and create space for the wing outside them.',
      'Defends the widest channel a midfield defence has to cover.',
      'Rarely directly involved, but supports the backline shape from every set piece.',
      'Running and evasion, decision making in broken play, tackling in the wide channel.',
      'Reads whether to beat a defender themselves or put a team-mate into the space instead.',
      'Talks constantly with the wing outside them to avoid leaving a gap between the two.',
      'Building both the attacking instincts and the reliable one-on-one tackling this role needs in equal measure.',
      'Committing to beat a defender when passing to a team-mate in more space was the better option.',
      'Is still making the right call between beating a defender and using a team-mate outside them late in the game.',
      0.64, 0.76,
      null
    ) returning id into v_u_outsidecentre;
  end if;

  select id into v_u_rightwing from public.hub_positions where position_key = 'union-right-wing';
  if v_u_rightwing is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-right-wing', 'union', 'Right Wing', array['14','Winger'], 14, 'BACK_THREE',
      'The outside finisher on the right edge of the pitch, converting space created further infield into tries.',
      'Finishing pace and footwork in open space; a reliable pair of hands under a high ball.',
      'Covers the width and depth behind the main defensive line.',
      'Finds and finishes the space the rest of the backline creates.',
      'The last line of defence on their edge, and often covers behind the fullback.',
      'Rarely involved directly, but must be ready to receive from a wide set-piece move.',
      'Running and evasion, catching under pressure (especially the high ball), finishing.',
      'Reads when to come looking for work infield versus staying wide for the pass.',
      'Calls for the ball early when space appears, so the pass arrives in time to use it.',
      'Building the aerial and positional skills to defend a high ball as confidently as attacking one.',
      'Drifting too far infield and leaving the edge undefended.',
      'Still finishing chances cleanly and defending their edge reliably in a tired final quarter.',
      0.92, 0.62,
      null
    ) returning id into v_u_rightwing;
  end if;

  select id into v_u_fullback from public.hub_positions where position_key = 'union-fullback';
  if v_u_fullback is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      set_piece_responsibilities, key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'union-fullback', 'union', 'Fullback', array['15'], 15, 'BACK_THREE',
      'The last line of defence and often the team''s counter-attacking spark, positioned deepest of all.',
      'Confident under the high ball; a strong runner who links play when counter-attacking from deep.',
      'Reads the kicking game to cover space in behind the main defensive line.',
      'Turns broken play and opposition mistakes into attacking opportunities from deep.',
      'The last line of defence — covers cross-kicks, breaks, and the space in behind the back three.',
      'Often the target of an opposition tactical kick, so positioning here matters every phase.',
      'Catching under pressure (especially the high ball), running from deep, tactical awareness.',
      'Reads the game constantly to judge their own depth and cover across the width of the pitch.',
      'Organises the back three''s positioning, since they can see the shape no one else can.',
      'Composure and technique under the high ball, alongside the reading of a game needed to position well.',
      'Standing too flat and getting exposed by a kick in behind.',
      'Is still reading the game and covering the right space even in a chaotic, tiring finish.',
      0.5, 0.9,
      null
    ) returning id into v_u_fullback;
  end if;

  -- =====================================================================
  -- LEAGUE POSITIONS (13)
  -- =====================================================================

  select id into v_l_fullback from public.hub_positions where position_key = 'league-fullback';
  if v_l_fullback is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-fullback', 'league', 'Fullback', array['1'], 1, 'BACK_THREE',
      'The last line of defence and the team''s deepest attacking outlet, often the free-est runner on the field.',
      'Confident under the high ball; a strong support runner who joins the attacking line from deep.',
      'Reads the kicking game to cover space in behind the defensive line.',
      'Turns broken field and kick returns into attacking opportunities.',
      'The last line of defence — covers kicks and breaks the wingers can''t reach.',
      'Catching under pressure (especially the high ball), running from deep, tactical awareness.',
      'Reads the game constantly to judge their own depth and cover across the width of the pitch.',
      'Organises the back three''s positioning, since they can see the shape no one else can.',
      'Composure and technique under the high ball, alongside the reading of a game needed to position well.',
      'Standing too flat and getting exposed by a kick in behind.',
      'Is still reading the game and covering the right space even in a tiring finish.',
      0.5, 0.9,
      null
    ) returning id into v_l_fullback;
  end if;

  select id into v_l_rightwing from public.hub_positions where position_key = 'league-right-wing';
  if v_l_rightwing is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-right-wing', 'league', 'Wing', array['2'], 2, 'BACK_THREE',
      'The outside finisher on the right edge of the pitch, converting space created infield into tries.',
      'Finishing pace and footwork in open space; a reliable pair of hands under a high ball.',
      'Covers the width and depth behind the main defensive line.',
      'Finds and finishes the space the rest of the attacking line creates.',
      'The last line of defence on their edge; a key tackler in a defensive line under sustained pressure.',
      'Running and evasion, catching under pressure (especially the high ball), finishing.',
      'Reads when to come looking for work infield versus staying wide for the pass.',
      'Calls for the ball early when space appears, so the pass arrives in time to use it.',
      'Building the aerial and positional skills to defend a high ball as confidently as attacking one.',
      'Drifting too far infield and leaving the edge undefended.',
      'Still finishing chances cleanly and defending their edge reliably deep into a physical match.',
      0.92, 0.62,
      null
    ) returning id into v_l_rightwing;
  end if;

  select id into v_l_rightcentre from public.hub_positions where position_key = 'league-right-centre';
  if v_l_rightcentre is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-right-centre', 'league', 'Centre', array['3'], 3, 'MIDFIELD',
      'A powerful attacking and defensive presence in midfield, usually the strongest ball-carrier in the backs.',
      'A powerful step or turn of pace to beat the defence; strong carries through contact.',
      'A key midfield defender, often facing the biggest opposition attacking threats.',
      'Looks to beat their opposite number one-on-one and create space for the wing outside them.',
      'Defends the wide midfield channel with a strong, reliable tackle technique.',
      'Running and evasion, tackling technique, decision making in broken play.',
      'Reads whether to beat a defender themselves or put a team-mate into space instead.',
      'Talks constantly with the wing outside them to avoid leaving a gap between the two.',
      'Building both the attacking instincts and the reliable tackling this role needs in equal measure.',
      'Committing to beat a defender when a team-mate in more space was the better option.',
      'Is still making the right call between beating a defender and using a team-mate outside them late in the game.',
      0.66, 0.72,
      null
    ) returning id into v_l_rightcentre;
  end if;

  select id into v_l_leftcentre from public.hub_positions where position_key = 'league-left-centre';
  if v_l_leftcentre is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-left-centre', 'league', 'Centre', array['4'], 4, 'MIDFIELD',
      'A powerful attacking and defensive presence in midfield, usually the strongest ball-carrier in the backs.',
      'A powerful step or turn of pace to beat the defence; strong carries through contact.',
      'A key midfield defender, often facing the biggest opposition attacking threats.',
      'Looks to beat their opposite number one-on-one and create space for the wing outside them.',
      'Defends the wide midfield channel with a strong, reliable tackle technique.',
      'Running and evasion, tackling technique, decision making in broken play.',
      'Reads whether to beat a defender themselves or put a team-mate into space instead.',
      'Talks constantly with the wing outside them to avoid leaving a gap between the two.',
      'Building both the attacking instincts and the reliable tackling this role needs in equal measure.',
      'Committing to beat a defender when a team-mate in more space was the better option.',
      'Is still making the right call between beating a defender and using a team-mate outside them late in the game.',
      0.34, 0.72,
      null
    ) returning id into v_l_leftcentre;
  end if;

  select id into v_l_leftwing from public.hub_positions where position_key = 'league-left-wing';
  if v_l_leftwing is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-left-wing', 'league', 'Wing', array['5'], 5, 'BACK_THREE',
      'The outside finisher on the left edge of the pitch, converting space created infield into tries.',
      'Finishing pace and footwork in open space; a reliable pair of hands under a high ball.',
      'Covers the width and depth behind the main defensive line.',
      'Finds and finishes the space the rest of the attacking line creates.',
      'The last line of defence on their edge; a key tackler in a defensive line under sustained pressure.',
      'Running and evasion, catching under pressure (especially the high ball), finishing.',
      'Reads when to come looking for work infield versus staying wide for the pass.',
      'Calls for the ball early when space appears, so the pass arrives in time to use it.',
      'Building the aerial and positional skills to defend a high ball as confidently as attacking one.',
      'Drifting too far infield and leaving the edge undefended.',
      'Still finishing chances cleanly and defending their edge reliably deep into a physical match.',
      0.08, 0.62,
      null
    ) returning id into v_l_leftwing;
  end if;

  select id into v_l_standoff from public.hub_positions where position_key = 'league-stand-off';
  if v_l_standoff is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-stand-off', 'league', 'Stand-Off', array['6','Five-Eighth'], 6, 'HALF_BACKS',
      'One of the team''s principal attacking directors, working closely with the halfback to shape each attacking set.',
      'Accurate passing to set the attacking line in motion; tactical kicking; the ability to beat a defender.',
      'Reads the defensive line to organise team-mates around them.',
      'Chooses the attacking shape for each play — move it wide, kick, or attack the line directly.',
      'Usually a first-choice defensive organiser in the middle of the defensive line.',
      'Game management, passing, kicking, tackling.',
      'Constantly reads the defensive line and the tackle count to choose the right option for that play.',
      'The loudest voice organising the attacking shape before each play.',
      'Composure and decision-making speed under direct defensive pressure.',
      'Forcing the same play regardless of what the defence is showing.',
      'Their decisions still fit what the game actually needs deep into a tight match.',
      0.5, 0.58,
      'At younger age grades this role is shared and rotated rather than fixed to one player, since the whole team is still building the handling and decision-making it depends on.'
    ) returning id into v_l_standoff;
  end if;

  select id into v_l_halfback from public.hub_positions where position_key = 'league-halfback';
  if v_l_halfback is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-halfback', 'league', 'Halfback', array['7','Scrum-Half'], 7, 'HALF_BACKS',
      'Controls the play-the-ball, deciding the team''s attacking option on almost every tackle of a set.',
      'Fast, accurate passing from dummy-half distance; a sharp running or kicking option, especially on the last tackle.',
      'Organises the forwards around the ruck area and reads each play-the-ball.',
      'Sets the tempo and shape of the attack by how and where the ball is delivered from dummy-half.',
      'Often the first defender to react around the play-the-ball area.',
      'Passing, tactical kicking (especially on last tackle), reading the play-the-ball.',
      'Reads the tackle count and the defensive line to choose the right option on every play.',
      'The loudest organiser of the forwards around every play-the-ball.',
      'Passing speed and accuracy under pressure, and the tactical kicking game that comes with later tackles in a set.',
      'A slow, telegraphed play that lets the defence reset before the next tackle.',
      'Their service and decisions stay sharp even as the forwards tire late in a set.',
      0.5, 0.46,
      'At younger age grades this role is shared and rotated rather than fixed to one player, since the whole team is still building the handling and decision-making it depends on.'
    ) returning id into v_l_halfback;
  end if;

  select id into v_l_prop1 from public.hub_positions where position_key = 'league-prop-eight';
  if v_l_prop1 is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-prop-eight', 'league', 'Prop', array['8'], 8, 'FRONT_ROW',
      'A physical, direct forward who takes the ball up hard from marker to build go-forward for the team.',
      'Hard, direct carries designed to make metres and quicken the play-the-ball.',
      'The first line of forward defence, absorbing the biggest opposition carries.',
      'Takes the ball into heavy contact repeatedly, wearing down the defensive line.',
      'A dependable, physical tackler who sets the tone up front.',
      'Ball-carrying under contact, tackling technique, work-rate.',
      'Reads whether to carry hard or offer a short offload to a support runner.',
      'Organises the forwards around them at the marker.',
      'The physical foundations for repeated heavy contact, both carrying and tackling.',
      'Losing leg drive on contact and going backwards instead of forwards.',
      'Is still making hard metres and dependable tackles deep into a physical match.',
      0.38, 0.1,
      null
    ) returning id into v_l_prop1;
  end if;

  select id into v_l_hooker from public.hub_positions where position_key = 'league-hooker';
  if v_l_hooker is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-hooker', 'league', 'Hooker', array['9'], 9, 'FRONT_ROW',
      'Often shares dummy-half duties close to the ruck and organises the forward pack around the play-the-ball.',
      'Sharp, quick passing from dummy-half distance in support of the halfback; direct carries close to the ruck.',
      'Organises the forwards immediately around every play-the-ball.',
      'Provides a second distribution option close to the ruck alongside the halfback.',
      'A physical, reliable tackler who is often first to react around the ruck.',
      'Passing under pressure, ball-carrying, reading the play-the-ball.',
      'Reads whether to pass, carry, or let the halfback take the play.',
      'The organiser of the forward pack''s shape around every play-the-ball.',
      'Sharp, accurate distribution close to the ruck under fatigue.',
      'A rushed pass from dummy-half that goes to ground.',
      'Their service and organisation around the ruck stay sharp even as the forwards tire.',
      0.5, 0.08,
      null
    ) returning id into v_l_hooker;
  end if;

  select id into v_l_prop2 from public.hub_positions where position_key = 'league-prop-ten';
  if v_l_prop2 is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-prop-ten', 'league', 'Prop', array['10'], 10, 'FRONT_ROW',
      'A physical, direct forward who takes the ball up hard from marker to build go-forward for the team.',
      'Hard, direct carries designed to make metres and quicken the play-the-ball.',
      'The first line of forward defence, absorbing the biggest opposition carries.',
      'Takes the ball into heavy contact repeatedly, wearing down the defensive line.',
      'A dependable, physical tackler who sets the tone up front.',
      'Ball-carrying under contact, tackling technique, work-rate.',
      'Reads whether to carry hard or offer a short offload to a support runner.',
      'Organises the forwards around them at the marker.',
      'The physical foundations for repeated heavy contact, both carrying and tackling.',
      'Losing leg drive on contact and going backwards instead of forwards.',
      'Is still making hard metres and dependable tackles deep into a physical match.',
      0.62, 0.1,
      null
    ) returning id into v_l_prop2;
  end if;

  select id into v_l_secondrow1 from public.hub_positions where position_key = 'league-second-row-eleven';
  if v_l_secondrow1 is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-second-row-eleven', 'league', 'Second-Row', array['11'], 11, 'SECOND_ROW',
      'A mobile, athletic forward who carries hard and covers more ground than the front row.',
      'Powerful, ball-in-two-hands carries that offer an offload option; support running close to the ruck.',
      'A physical, mobile defender who fills gaps across the defensive line.',
      'Offers a consistent go-forward option, often with the handling to keep the ball alive through contact.',
      'Covers a wide defensive workload thanks to their mobility across the pitch.',
      'Ball-carrying with an offload option, tackling technique, work-rate.',
      'Reads whether to carry hard, offload, or hold the ball up in contact.',
      'Calls support and defensive shifts across a wide area of the pitch.',
      'The all-round handling and fitness this more mobile forward role demands.',
      'Running into heavy contact when an offload to a support runner was on.',
      'Is still covering ground and offering an offload option deep into the match.',
      0.38, 0.24,
      null
    ) returning id into v_l_secondrow1;
  end if;

  select id into v_l_secondrow2 from public.hub_positions where position_key = 'league-second-row-twelve';
  if v_l_secondrow2 is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-second-row-twelve', 'league', 'Second-Row', array['12'], 12, 'SECOND_ROW',
      'A mobile, athletic forward who carries hard and covers more ground than the front row.',
      'Powerful, ball-in-two-hands carries that offer an offload option; support running close to the ruck.',
      'A physical, mobile defender who fills gaps across the defensive line.',
      'Offers a consistent go-forward option, often with the handling to keep the ball alive through contact.',
      'Covers a wide defensive workload thanks to their mobility across the pitch.',
      'Ball-carrying with an offload option, tackling technique, work-rate.',
      'Reads whether to carry hard, offload, or hold the ball up in contact.',
      'Calls support and defensive shifts across a wide area of the pitch.',
      'The all-round handling and fitness this more mobile forward role demands.',
      'Running into heavy contact when an offload to a support runner was on.',
      'Is still covering ground and offering an offload option deep into the match.',
      0.62, 0.24,
      null
    ) returning id into v_l_secondrow2;
  end if;

  select id into v_l_looseforward from public.hub_positions where position_key = 'league-loose-forward';
  if v_l_looseforward is null then
    insert into public.hub_positions (
      position_key, rugby_code, display_name, alternative_names, shirt_number, position_family,
      purpose, role_with_ball, role_without_ball, attack_responsibilities, defence_responsibilities,
      key_skills_summary, decision_making, communication,
      development_priorities, common_mistakes, strong_performance_looks_like,
      pitch_anchor_x, pitch_anchor_y, age_guidance_note
    ) values (
      'league-loose-forward', 'league', 'Loose Forward', array['13','Lock'], 13, 'BACK_ROW',
      'The most mobile of the forwards, expected to carry, tackle and cover across the whole width of the pitch.',
      'Powerful carries through the middle of the ruck; support running that links forwards and backs.',
      'A central defensive organiser, often making the highest tackle count of any forward.',
      'Provides constant go-forward through the middle of the pitch, phase after phase.',
      'Covers the widest defensive workload of any forward thanks to their mobility and work-rate.',
      'Tackling technique, ball-carrying, work-rate, decision making in broken play.',
      'Reads whether to carry through the middle or support a team-mate wider out.',
      'A central organiser for the forward pack''s defensive line.',
      'The all-round fitness and handling this most demanding of forward roles requires.',
      'Running out of gas from overcommitting to every carry and every tackle.',
      'Is still making the highest tackle count on the field in the closing minutes.',
      0.5, 0.34,
      null
    ) returning id into v_l_looseforward;
  end if;

  -- =====================================================================
  -- APPLICABILITY -- every position is universally browsable (see header:
  -- age-STAGE, not content visibility, is what gates "should I be picking
  -- this position yet").
  -- =====================================================================

  insert into public.hub_content_applicability (position_id, is_universal)
  select p.id, true
  from public.hub_positions p
  where (p.position_key like 'union-%' or p.position_key like 'league-%')
  and not exists (select 1 from public.hub_content_applicability a where a.position_id = p.id);

  -- =====================================================================
  -- PUBLISH every position added by this migration.
  -- =====================================================================

  update public.hub_positions
  set status = 'REVIEWED', reviewed_by = v_actor, reviewed_at = now()
  where status = 'DRAFT' and (position_key like 'union-%' or position_key like 'league-%');

  update public.hub_positions
  set status = 'PUBLISHED', published_by = v_actor, published_at = now()
  where status = 'REVIEWED' and (position_key like 'union-%' or position_key like 'league-%');

  -- =====================================================================
  -- POSITION <-> SKILL relationships.
  -- =====================================================================

  insert into public.hub_position_skills (position_id, skill_id)
  values
    (v_u_loosehead, v_s_setpiece), (v_u_loosehead, v_s_tackling), (v_u_loosehead, v_s_breakdown),
    (v_u_hooker, v_s_setpiece), (v_u_hooker, v_s_breakdown), (v_u_hooker, v_s_communication),
    (v_u_tighthead, v_s_setpiece), (v_u_tighthead, v_s_tackling), (v_u_tighthead, v_s_breakdown),
    (v_u_lock1, v_s_setpiece), (v_u_lock1, v_s_tackling), (v_u_lock1, v_s_breakdown),
    (v_u_lock2, v_s_setpiece), (v_u_lock2, v_s_tackling), (v_u_lock2, v_s_breakdown),
    (v_u_blindside, v_s_tackling), (v_u_blindside, v_s_breakdown), (v_u_blindside, v_s_communication),
    (v_u_openside, v_s_breakdown), (v_u_openside, v_s_decisions), (v_u_openside, v_s_tackling),
    (v_u_number8, v_s_breakdown), (v_u_number8, v_s_decisions), (v_u_number8, v_s_passing),
    (v_u_scrumhalf, v_s_passing), (v_u_scrumhalf, v_s_kicking), (v_u_scrumhalf, v_s_decisions), (v_u_scrumhalf, v_s_communication),
    (v_u_flyhalf, v_s_gamemanagement), (v_u_flyhalf, v_s_passing), (v_u_flyhalf, v_s_kicking), (v_u_flyhalf, v_s_decisions),
    (v_u_leftwing, v_s_evasion), (v_u_leftwing, v_s_catching),
    (v_u_insidecentre, v_s_tackling), (v_u_insidecentre, v_s_passing),
    (v_u_outsidecentre, v_s_evasion), (v_u_outsidecentre, v_s_decisions),
    (v_u_rightwing, v_s_evasion), (v_u_rightwing, v_s_catching),
    (v_u_fullback, v_s_catching), (v_u_fullback, v_s_decisions), (v_u_fullback, v_s_evasion),

    (v_l_fullback, v_s_catching), (v_l_fullback, v_s_decisions), (v_l_fullback, v_s_evasion),
    (v_l_rightwing, v_s_evasion), (v_l_rightwing, v_s_catching),
    (v_l_rightcentre, v_s_tackling), (v_l_rightcentre, v_s_evasion),
    (v_l_leftcentre, v_s_tackling), (v_l_leftcentre, v_s_evasion),
    (v_l_leftwing, v_s_evasion), (v_l_leftwing, v_s_catching),
    (v_l_standoff, v_s_gamemanagement), (v_l_standoff, v_s_passing), (v_l_standoff, v_s_kicking), (v_l_standoff, v_s_decisions),
    (v_l_halfback, v_s_passing), (v_l_halfback, v_s_kicking), (v_l_halfback, v_s_decisions), (v_l_halfback, v_s_communication),
    (v_l_prop1, v_s_tackling), (v_l_prop1, v_s_breakdown),
    (v_l_hooker, v_s_passing), (v_l_hooker, v_s_communication), (v_l_hooker, v_s_breakdown),
    (v_l_prop2, v_s_tackling), (v_l_prop2, v_s_breakdown),
    (v_l_secondrow1, v_s_tackling), (v_l_secondrow1, v_s_passing),
    (v_l_secondrow2, v_s_tackling), (v_l_secondrow2, v_s_passing),
    (v_l_looseforward, v_s_tackling), (v_l_looseforward, v_s_decisions), (v_l_looseforward, v_s_communication)
  on conflict do nothing;

  -- =====================================================================
  -- POSITION <-> POSITION relationships (adjacent/related, per code).
  -- =====================================================================

  insert into public.hub_position_relationships (position_id, related_position_id)
  values
    (v_u_loosehead, v_u_hooker), (v_u_hooker, v_u_loosehead),
    (v_u_loosehead, v_u_tighthead), (v_u_tighthead, v_u_loosehead),
    (v_u_hooker, v_u_tighthead), (v_u_tighthead, v_u_hooker),
    (v_u_lock1, v_u_lock2), (v_u_lock2, v_u_lock1),
    (v_u_blindside, v_u_openside), (v_u_openside, v_u_blindside),
    (v_u_openside, v_u_number8), (v_u_number8, v_u_openside),
    (v_u_blindside, v_u_number8), (v_u_number8, v_u_blindside),
    (v_u_scrumhalf, v_u_flyhalf), (v_u_flyhalf, v_u_scrumhalf),
    (v_u_flyhalf, v_u_insidecentre), (v_u_insidecentre, v_u_flyhalf),
    (v_u_insidecentre, v_u_outsidecentre), (v_u_outsidecentre, v_u_insidecentre),
    (v_u_outsidecentre, v_u_rightwing), (v_u_rightwing, v_u_outsidecentre),
    (v_u_outsidecentre, v_u_leftwing), (v_u_leftwing, v_u_outsidecentre),
    (v_u_leftwing, v_u_fullback), (v_u_fullback, v_u_leftwing),
    (v_u_rightwing, v_u_fullback), (v_u_fullback, v_u_rightwing),

    (v_l_prop1, v_l_prop2), (v_l_prop2, v_l_prop1),
    (v_l_prop1, v_l_hooker), (v_l_hooker, v_l_prop1),
    (v_l_prop2, v_l_hooker), (v_l_hooker, v_l_prop2),
    (v_l_secondrow1, v_l_secondrow2), (v_l_secondrow2, v_l_secondrow1),
    (v_l_secondrow1, v_l_looseforward), (v_l_looseforward, v_l_secondrow1),
    (v_l_secondrow2, v_l_looseforward), (v_l_looseforward, v_l_secondrow2),
    (v_l_halfback, v_l_standoff), (v_l_standoff, v_l_halfback),
    (v_l_standoff, v_l_leftcentre), (v_l_leftcentre, v_l_standoff),
    (v_l_standoff, v_l_rightcentre), (v_l_rightcentre, v_l_standoff),
    (v_l_leftcentre, v_l_leftwing), (v_l_leftwing, v_l_leftcentre),
    (v_l_rightcentre, v_l_rightwing), (v_l_rightwing, v_l_rightcentre),
    (v_l_leftwing, v_l_fullback), (v_l_fullback, v_l_leftwing),
    (v_l_rightwing, v_l_fullback), (v_l_fullback, v_l_rightwing)
  on conflict do nothing;

  -- =====================================================================
  -- AGE-STAGE -- NOT_APPLICABLE for mini/primary rugby, EMERGING for the
  -- transitional band, uniformly across all positions of that code (see
  -- header for the research basis). Everything else deliberately left
  -- unassessed.
  -- =====================================================================

  insert into public.hub_position_age_stage (position_id, regulatory_identity_id, stage, stage_note)
  select p.id, ri.id, 'NOT_APPLICABLE',
    'At this stage, players rotate through every role on the pitch rather than fixing into one position — that''s deliberate, so everyone builds a full picture of the game before specialising.'
  from public.hub_positions p
  cross join public.regulatory_identities ri
  where (p.position_key like 'union-%' and ri.identity_key in ('RFU-U6','RFU-U7','RFU-U8'))
     or (p.position_key like 'league-%' and ri.identity_key = 'RFL-PRIMARY')
  on conflict (position_id, regulatory_identity_id) do nothing;

  insert into public.hub_position_age_stage (position_id, regulatory_identity_id, stage, stage_note)
  select p.id, ri.id, 'EMERGING',
    'Positional roles are starting to form at this stage, but they''re not fixed yet — players are still encouraged to try more than one role across a season.'
  from public.hub_positions p
  cross join public.regulatory_identities ri
  where (p.position_key like 'union-%' and ri.identity_key in ('RFU-U9','RFU-U10'))
     or (p.position_key like 'league-%' and ri.identity_key = 'RFL-U12')
  on conflict (position_id, regulatory_identity_id) do nothing;

end $$;
