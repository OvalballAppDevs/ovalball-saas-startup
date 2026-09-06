-- Bug fix, caught live via smoke test: editing a Training Plan's schedule
-- (save_training_plan) cancels future non-overridden sessions, then
-- deletes the plan's old training_plan_schedule_rules rows before
-- inserting the new ones. Sessions (past, cancelled, or overridden) still
-- reference the old rule via schedule_rule_id, which had the default
-- ON DELETE NO ACTION -- blocking the delete with a foreign-key violation
-- the very first time a plan was ever edited. A training_session's own
-- columns (occurrence_date, start_time, duration_minutes, venue_id,
-- pitch_id) are already a complete, self-contained historical record
-- copied at generation time (Section 4) -- it never needs to keep
-- resolving through schedule_rule_id after the fact, only the still-live
-- unique-occurrence-key index does. ON DELETE SET NULL lets a superseded
-- rule be deleted freely while every session it ever produced keeps its
-- own historical data intact.
alter table public.training_sessions
  drop constraint training_sessions_schedule_rule_id_fkey,
  add constraint training_sessions_schedule_rule_id_fkey
    foreign key (schedule_rule_id) references public.training_plan_schedule_rules(id) on delete set null;
