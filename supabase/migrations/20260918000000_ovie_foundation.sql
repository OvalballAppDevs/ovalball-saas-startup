-- Ovie Phase 1 -- minimal schema foundation. Ovie is an interface onto the
-- EXISTING fixture domain (opponent resolution, availability, the
-- fixture_request_groups/fixture_requests negotiation model) -- it needs no
-- new tables of its own for Phase 1: no availability store, no AI-specific
-- club/team records, no parallel conversation log. The only real gap is
-- provenance -- being able to tell, after the fact, that a given request
-- was drafted via Ovie (the real human actor is, and always was, correctly
-- captured by fixture_request_groups.created_by; this column answers a
-- DIFFERENT question -- "was this drafted by the assistant" -- never who
-- performed it).

alter table public.fixture_request_groups
  add column source text check (source in ('ovie_assistant'));

comment on column public.fixture_request_groups.source is
  'Provenance marker only -- null for every ordinary request (the overwhelming default), ''ovie_assistant'' when Ovie drafted this request on the real signed-in user''s behalf. created_by is, and remains, the sole record of WHO acted; Ovie is never the actor. Deliberately NOT propagated onto the resulting fixtures.source column in this phase (that column''s existing check constraint and accept_fixture_request''s write path are unchanged) -- a real, disclosed Phase 1 scope boundary, not an oversight.';
