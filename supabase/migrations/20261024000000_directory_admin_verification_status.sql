-- Site Admin Club Directory Verification Status.
--
-- WHAT THIS IS NOT
--
-- club_directory.verification_status already exists, but it is not a Site
-- Admin trust attestation -- it is a free-text provenance/method tag the
-- directory-research and data-quality pipeline writes to record HOW a row
-- was populated ('wru_current_league_verified', 'source_verified_address',
-- 'wikipedia_current_league_discovery', 21 distinct values in production).
-- The Data Quality dashboard's "Needs Review" bucket is a live query
-- pattern-matching on it (`verification_status NOT ILIKE '%verified%'`,
-- see 20260831200000_admin_club_overview.sql and
-- app/(app)/admin/clubs/data-quality/query.ts's own doc comment). Collapsing
-- that field into a three-value enum would destroy real provenance detail
-- across ~1,400 clubs and break a working dashboard, for a question
-- ("was this club's DATA populated/verified by some process") that isn't
-- the question this feature actually asks ("has a Site Admin confirmed this
-- Club record according to Ovalball's Club Directory policy").
--
-- Those are two genuinely different concepts, and the existing field is
-- exactly one of the things this feature's own definition of VERIFIED must
-- stay separate from ("not merely import completed"). So this migration
-- adds a new, narrowly-scoped column rather than touching the old one --
-- confirmed with the project owner before implementing, given the spec's
-- own default instruction was "reuse the existing field, do not create a
-- second one" and the actual data on this table contradicts the assumption
-- that instruction was written under.
--
-- DEFAULT / NULL SEMANTICS
--
-- Every existing row (all ~1,400+ of them) gets TBD, never VERIFIED --
-- nothing here has been confirmed by a Site Admin, regardless of how
-- confident the import pipeline's own separate provenance tag sounds.
--
-- AUTHORIZATION / AUDIT
--
-- No new RPC, no new audit table. club_directory_update_admin (RLS,
-- is_site_admin()) already gates every write to this table, and the
-- audit_row_change trigger already fires on every update, capturing this
-- column in its automatic before/after row snapshot -- exactly the
-- "existing canonical audit machinery" the spec asks for, with zero new
-- code.

alter table public.club_directory
  add column admin_verification_status text not null default 'TBD'
    check (admin_verification_status in ('VERIFIED', 'FAILED', 'TBD'));

comment on column public.club_directory.admin_verification_status is
  'Site Admin attestation that this Club Directory record has been confirmed per Ovalball''s Club Directory policy. VERIFIED/FAILED/TBD only. Distinct from verification_status, which is the import/data-quality pipeline''s own provenance tag -- never conflate the two.';

do $$
declare
  v_tbd_count int;
begin
  select count(*) into v_tbd_count from public.club_directory where admin_verification_status = 'TBD';
  if v_tbd_count <> (select count(*) from public.club_directory) then
    raise exception 'admin_verification_status backfill invariant violated -- every existing row must start TBD, found a row that did not.';
  end if;
end $$;
