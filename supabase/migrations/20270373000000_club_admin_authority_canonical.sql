-- =====================================================================================================
-- SLICE 4H (1/3) — CLUB ADMINISTRATION AUTHORITY, AND THE S BOUNDARY'S EXPORT
--
-- Phase 2 AA.3 row 4h, section S "Club Admin boundary", design J.3, J.4, J.5 and J.13.
--
-- AA.3 row 4h names one legacy item -- internal.is_club_admin, 23 policies and 20 function bodies at
-- this ledger -- and the ledger assigns ten tables to this slice: clubs, teams, club_memberships,
-- role_assignments, club_join_requests, invitations, invitation_teams, club_contacts, team_contacts
-- and club_opponent_notes. Every capability those policies need is already ACTIVE in the catalogue
-- with exactly the bundles J.3/J.4/J.5 specify, so 4H adds no capability and changes no bundle. What
-- changes is which code asks which question.
--
-- This file installs the two things the rest of the slice rests on: a way to ask a club-scoped
-- capability ONCE per query rather than once per row, and the export contract section S names.
-- =====================================================================================================

-- 1. Asking a club question without asking it per row ------------------------------------------------
-- internal.is_club_admin(club_id) is correlated: in a policy it runs once per row. Replacing it with a
-- correlated internal.can(...) would keep the shape and make each call heavier, which the programme
-- has now paid for three times (4E training plans, 4F team conversations, 4G dispensations). So the
-- club-scoped policies ask a set instead.
--
-- THE CANDIDATE SET MIRRORS internal.bundle_source, and that is the whole correctness argument. A
-- club-scoped key can reach a person by three routes and only three: an ACTIVE membership carrying a
-- role whose bundle holds the key; being a player with an ACTIVE place in one of the club's teams; or
-- being the ACTIVE guardian of such a player. Enumerating memberships alone would have been the
-- convenient answer and would have quietly dropped parents and players from every policy that uses
-- this -- club_admin_authority_matrix CH-P asserts the set and the per-row question agree, persona by
-- persona, rather than leaving that to the comment.
create or replace function internal.club_ids_with(p_key text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select cm.club_id
    from public.club_memberships cm
    where cm.user_id = (select auth.uid()) and cm.state = 'ACTIVE'
    union
    select t.club_id
    from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state = 'ACTIVE'
    join public.teams t on t.id = ptm.team_id
    where p.user_id = (select auth.uid())
    union
    select t.club_id
    from public.guardians g
    join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.state = 'ACTIVE'
    join public.teams t on t.id = ptm.team_id
    where g.guardian_user_id = (select auth.uid()) and g.state = 'ACTIVE'
  )
  select coalesce(array_agg(distinct c.club_id), '{}')
  from candidates c
  where internal.can(p_key, 'club', c.club_id, null, null);
$$;

comment on function internal.club_ids_with(text) is
  'Slice 4H: the clubs where the caller holds this club-scoped capability. Caller-dependent and '
  'row-independent, so a policy hoists it into an uncorrelated subquery and asks once per query '
  'instead of once per row. The candidate set mirrors internal.bundle_source''s three club routes -- '
  'membership, own player place, active guardian -- so it is equivalent to the per-row question (CH-P).';

-- anon IS granted this, and the reason is worth writing down because the first draft got it wrong
-- twice. Anon holds no SELECT grant on any of the ten tables, so a DIRECT anonymous read never gets
-- as far as RLS -- which made it look as though the `to public` role targeting were vestigial. It is
-- not: anon reaches clubs and teams TRANSITIVELY, through other tables' policies that join to them.
-- club_articles_public_read is the one that found it -- a signed-out visitor reading a published
-- article evaluates `exists (select 1 from clubs c where ...)`, which evaluates clubs_select, which
-- now calls this function. Without the grant that read raises "permission denied for function"
-- instead of showing the article.
--
-- Handing it to anon is safe and says nothing: it resolves through internal.can, which answers no to
-- a caller with no session, so anon's set is always empty. CH-P4 asserts that emptiness rather than
-- trusting the argument.
revoke execute on function internal.club_ids_with(text) from public;
grant execute on function internal.club_ids_with(text) to anon, authenticated, service_role;

-- internal.has_site_capability needs the same grant, for the same reason and with a wider blast
-- radius than this slice. internal.is_site_admin -- the thing every one of these policies used to ask
-- -- IS executable by anon, so the transitive path worked by accident. FORTY-FOUR policies targeted
-- `to public` already call has_site_capability, put there by Slices 4C, 4E and 4F, and every one of
-- them would raise "permission denied for function" on a transitive anonymous read rather than
-- answering. The club-article case is simply the first one a test happened to walk.
--
-- Safe for the same reason: it resolves through capability_decision for internal.effective_person(),
-- which is null without a session, so anon is told no. CH-P4 asserts that rather than assuming it.
grant execute on function internal.has_site_capability(text) to anon;

-- 2. The S boundary's export ---------------------------------------------------------------------------
-- Section S, the last row of the prohibitions table: "Export personal data without R and event |
-- club.reporting.export". The capability has been ACTIVE in the catalogue since Slice 3 with AAL R,
-- and NOTHING ASKED IT -- zero callers in the database and none in the application.
--
-- What it should have been governing: the club player-movement export, which lists named children,
-- the teams they moved between, their dispensation status and the governing-body reference the club
-- recorded. That was gated on manage_fixture_callups -- a fixtures key, AAL A2 -- and emitted no
-- event at all, so nobody could afterwards tell that a club's roll of children had been downloaded.
--
-- This is the one contract for a club-scoped personal-data export: the capability, a reason, and a
-- security event carrying the shape of what left. The caller supplies the kind and the row count; the
-- function decides whether it may happen and records that it did.
create or replace function public.record_club_export(
  p_club_id uuid,
  p_kind text,
  p_reason text,
  p_row_count integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Exporting a club''s personal data needs a reason, and it is recorded.' using errcode = '22023';
  end if;
  if coalesce(trim(p_kind), '') = '' then
    raise exception 'An export must say what it is.' using errcode = '22023';
  end if;
  -- AAL R is carried by the capability itself (J.4 line 410), so it is enforced by the canonical
  -- decision rather than restated here.
  if not internal.can('club.reporting.export', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to export this club''s data.' using errcode = '42501';
  end if;

  perform internal.emit_security_event('export.generated', auth.uid(), 'SUCCESS', trim(p_reason),
    jsonb_build_object('kind', trim(p_kind), 'row_count', p_row_count),
    p_club_id, null, null);
end;
$$;

comment on function public.record_club_export(uuid, text, text, integer) is
  'Section S (Slice 4H): the one gate for a club-scoped personal-data export. Requires '
  'club.reporting.export (AAL R), a reason, and emits export.generated naming what left and how much '
  'of it. Before this, the club player-movement export -- named children and their dispensation '
  'references -- asked a fixtures capability and left no trace.';

revoke execute on function public.record_club_export(uuid, text, text, integer) from public, anon;
grant execute on function public.record_club_export(uuid, text, text, integer) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from public.security_event_types where event_type = 'export.generated' and requires_reason) then
    raise exception 'export.generated must exist and require a reason for the S boundary to mean anything.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_club_export') !~ 'club\.reporting\.export' then
    raise exception 'the export gate does not ask club.reporting.export.';
  end if;
end $$;
