-- Real bug, caught live by re-running the FIRST pass's own regression
-- suite after this pass's changes: "CREATE OR REPLACE FUNCTION" does NOT
-- replace an existing function when new trailing parameters change the
-- total argument COUNT -- Postgres identifies a function by name + full
-- argument-type list, so adding new defaulted trailing parameters
-- silently creates a SECOND overload rather than replacing the first.
-- This had already happened once, unnoticed, when create_training_session
-- gained p_venue_id in the foundation pass; it happened again just now
-- when override_training_session gained p_agenda/p_further_notes. Neither
-- was harmful on its own (each specific call site always supplied enough
-- arguments to resolve unambiguously) until a call supplying only the
-- OLD, shorter argument list (this project's own pre-existing regression
-- suite) became genuinely ambiguous between the stale short overload and
-- the new long one with matching defaults -- "function ... is not unique".
--
-- Fix: drop the two now-stale, shorter overloads explicitly by their
-- exact original signatures, leaving only the current, complete one each
-- name should ever have had.
drop function if exists public.create_training_session(uuid, uuid, uuid, date, time, time, uuid, text);
drop function if exists public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text);
