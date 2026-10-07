-- =====================================================================================================
-- A KNOCKOUT IS A DRAW, NOT A SET OF FAKE TEAMS.
--
-- The obvious way to build a bracket is to create every game up front and fill the unknown sides with
-- placeholders -- a participant called "Winner QF1". Ovalball must not: `tournament_participants` is
-- the register of CLUBS AND SIDES THAT ARE COMING, and a row in it means a real side with an age group,
-- an attendance answer and a place in the Club Directory. A placeholder there would be a club that
-- does not exist, in a competition, with a crest nobody can draw.
--
-- `tournament_games.side_a_id` and `side_b_id` are NOT NULL, and that constraint is right. So:
--
--   A KNOCKOUT GAME IS CREATED ONLY WHEN BOTH ITS SIDES ARE KNOWN.
--
-- What exists before then is the DRAW -- a structure of empty places. That is this file.
--
-- ---- THE SHAPE -----------------------------------------------------------------------------------
--
-- A bracket is rounds of SLOTS. Round 1 holds the drawn sides. Each later round has half as many slots,
-- and slot `p` of round `r+1` is filled by the winner of game `p` of round `r`. Nothing about that
-- needs storing as a link: it is arithmetic, and arithmetic cannot drift out of step with itself.
--
--   round 1   slots 1..8     the draw
--   round 2   slots 1..4     winners of round 1's four games
--   round 3   slots 1..2     winners of round 2's two games
--   round 4   slot  1        the winner
--
-- A GAME PAIRS TWO ADJACENT SLOTS. Game `k` of round `r` is slots `2k-1` and `2k`.
--
-- ---- A BYE IS AN EMPTY PLACE, NOT A GAME ---------------------------------------------------------
--
-- Where the field is not a power of two, some opening slots are empty. The side opposite an empty slot
-- plays nobody and advances. That is not a 0-0 win, not a game against a club called "Bye", and not a
-- result: there is simply no game, and the side's name appears in the next round. The draw knows the
-- slot is deliberately empty (`is_bye`) so the bracket can print the word BYE without anybody having
-- invented an opponent to print it against.
--
-- ---- AND IT IS THE SAME TOURNAMENT -----------------------------------------------------------------
--
-- No new tournament, competition, participant, attendance, calendar or result model. A knockout
-- competition is a `tournament_plans` row like any other, its games are `tournament_games`, and their
-- results follow the one canonical lifecycle. The only new idea in this file is the draw.
-- =====================================================================================================

create table if not exists public.tournament_bracket_slots (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.tournament_plans(id) on delete cascade,
  round_number integer not null,
  position integer not null,
  /**
   * WHO IS IN THIS PLACE, where it is known. Null in round 1 means a BYE; null in a later round means
   * the game that feeds it has not produced a winner yet. The two are told apart by `is_bye`, because
   * "nobody is coming" and "nobody has won yet" are different facts and a bracket says different
   * things about them.
   */
  participant_id uuid references public.tournament_participants(id) on delete cascade,
  is_bye boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_bracket_slots_round_positive check (round_number >= 1),
  constraint tournament_bracket_slots_position_positive check (position >= 1),
  -- A BYE IS AN EMPTY PLACE. It cannot also hold a side.
  constraint tournament_bracket_slots_bye_is_empty check (not is_bye or participant_id is null),
  constraint tournament_bracket_slots_one_per_place unique (plan_id, round_number, position)
);

comment on table public.tournament_bracket_slots is
  'The knockout DRAW: rounds of places, which sides may or may not yet occupy. Slot p of round r+1 is '
  'filled by the winner of game p of round r, so progression is arithmetic rather than a stored link. '
  'An empty round-1 slot is a BYE -- never a participant, never a game, never a 0-0 result.';

create index if not exists tournament_bracket_slots_plan_idx
  on public.tournament_bracket_slots (plan_id, round_number, position);
create index if not exists tournament_bracket_slots_participant_idx
  on public.tournament_bracket_slots (participant_id) where participant_id is not null;

-- A SIDE OCCUPIES ONE PLACE PER ROUND. Two slots in one round holding the same club is a draw that
-- cannot be played, and it is the exact corruption a careless re-draw produces.
create unique index if not exists tournament_bracket_slots_side_once_per_round
  on public.tournament_bracket_slots (plan_id, round_number, participant_id)
  where participant_id is not null;

-- ---- where a game sits in the bracket ----------------------------------------------------------------

alter table public.tournament_games
  add column if not exists bracket_position integer,
  /**
   * THE THIRD-PLACE PLAY-OFF is the one game whose sides are the LOSERS of the round above, so it
   * cannot be derived from the slot arithmetic and is named instead.
   */
  add column if not exists is_third_place boolean not null default false,
  /**
   * WHO WON, AS A FACT RATHER THAN AN INFERENCE.
   *
   * A bracket must never decide a winner by comparing row order, participant ids or which side happens
   * to be `side_a`. Where the settled score is decisive this is derived from it; where the score is
   * level it stays NULL until somebody with the authority says otherwise -- and a null winner is what
   * stops the bracket advancing.
   */
  add column if not exists winner_participant_id uuid references public.tournament_participants(id),
  add column if not exists winner_decided_by uuid references auth.users(id),
  add column if not exists winner_decided_at timestamptz,
  add column if not exists winner_decision_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_games_bracket_position_positive') then
    alter table public.tournament_games add constraint tournament_games_bracket_position_positive
      check (bracket_position is null or bracket_position >= 1);
  end if;
  -- THE WINNER IS ONE OF THE TWO SIDES. Nothing else is sayable.
  if not exists (select 1 from pg_constraint where conname = 'tournament_games_winner_is_a_side') then
    alter table public.tournament_games add constraint tournament_games_winner_is_a_side
      check (winner_participant_id is null
             or winner_participant_id = side_a_id
             or winner_participant_id = side_b_id);
  end if;
end $$;

comment on column public.tournament_games.winner_participant_id is
  'Who won, as a recorded fact. Derived from a settled decisive score, or declared by the organiser '
  'where the competition allows a level game to be decided. NEVER inferred from row order, participant '
  'id or which side is side_a -- a null winner is what correctly stops a bracket advancing.';

-- ---- the competition's own knockout settings ---------------------------------------------------------

alter table public.tournament_plans
  add column if not exists draw_method text not null default 'random',
  add column if not exists extra_time_minutes integer,
  add column if not exists tie_resolution text not null default 'organiser_decision',
  add column if not exists third_place_playoff boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_plans_draw_method_check') then
    alter table public.tournament_plans add constraint tournament_plans_draw_method_check
      check (draw_method in ('random', 'manual', 'seeded'));
  end if;
  /**
   * WHAT OVALBALL CAN ACTUALLY REPRESENT, and nothing else.
   *
   *   none                 a level game has no winner. The bracket stops and says so.
   *   extra_time           a further period is played and the recorded score is the score AFTER it.
   *                        Still level afterwards and there is still no winner.
   *   organiser_decision   the organiser records who went through, with a reason.
   *
   * A KICKING COMPETITION IS DELIBERATELY NOT AN OPTION. Ovalball records no kicks, so offering it
   * would be claiming the app can decide something it cannot see. An organiser who runs one records
   * its outcome through `organiser_decision`, which is honest about who decided.
   */
  if not exists (select 1 from pg_constraint where conname = 'tournament_plans_tie_resolution_check') then
    alter table public.tournament_plans add constraint tournament_plans_tie_resolution_check
      check (tie_resolution in ('none', 'extra_time', 'organiser_decision'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tournament_plans_extra_time_shape') then
    alter table public.tournament_plans add constraint tournament_plans_extra_time_shape
      check (extra_time_minutes is null or (extra_time_minutes >= 1 and extra_time_minutes <= 40));
  end if;
end $$;

comment on column public.tournament_plans.tie_resolution is
  'How a level knockout game produces a winner, constrained to what Ovalball can represent: not at all, '
  'after extra time whose score is the recorded one, or by the organiser recording the decision. A '
  'kicking competition is deliberately absent -- the app records no kicks and must not pretend to.';

-- ---- reading the draw --------------------------------------------------------------------------------

/** How many rounds a bracket of this many places has. 8 places -> 3 rounds. */
create or replace function internal.bracket_rounds(p_slots integer)
returns integer
language sql
immutable
as $function$
  select case when coalesce(p_slots, 0) < 2 then 0 else ceil(log(2, p_slots))::int end;
$function$;

/** The smallest power of two that seats this many sides. 6 sides -> 8 places, so two of them are byes. */
create or replace function internal.bracket_size(p_sides integer)
returns integer
language sql
immutable
as $function$
  select case when coalesce(p_sides, 0) < 2 then 0 else power(2, ceil(log(2, p_sides)))::int end;
$function$;

do $$
begin
  if internal.bracket_size(6) <> 8 then raise exception 'six sides need an eight-place bracket.'; end if;
  if internal.bracket_size(8) <> 8 then raise exception 'eight sides need an eight-place bracket.'; end if;
  if internal.bracket_size(3) <> 4 then raise exception 'three sides need a four-place bracket.'; end if;
  if internal.bracket_size(9) <> 16 then raise exception 'nine sides need a sixteen-place bracket.'; end if;
  if internal.bracket_rounds(8) <> 3 then raise exception 'an eight-place bracket has three rounds.'; end if;
  if internal.bracket_rounds(16) <> 4 then raise exception 'a sixteen-place bracket has four rounds.'; end if;
end $$;

-- ---- nobody writes the draw from a browser -----------------------------------------------------------

alter table public.tournament_bracket_slots enable row level security;

create policy tournament_bracket_slots_select on public.tournament_bracket_slots
  for select to authenticated
  using (exists (
    select 1 from public.tournament_plans p
    where p.id = plan_id and internal.tournament_visible_row(p.tournament_id)
  ));

-- A RESTRICTIVE SESSION GATE, the same one every other tournament table carries.
create policy tournament_bracket_slots_session_ok_required on public.tournament_bracket_slots
  as restrictive for all to authenticated
  using (internal.session_ok()) with check (internal.session_ok());

grant select on public.tournament_bracket_slots to authenticated;

do $$
begin
  -- THE DRAW IS WRITTEN BY GOVERNED FUNCTIONS ONLY. No insert, update or delete policy exists, so a
  -- club cannot place itself in a final by writing a row.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tournament_bracket_slots' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'the bracket carries a client write policy; the draw is the organiser''s, through RPCs only.';
  end if;
end $$;
