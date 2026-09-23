-- ===========================================================================
-- EVERY REVIEW PERSONA HAS A NAME
-- ===========================================================================
--
-- The New Message picker showed four rows reading "Ovalball user". That is not a
-- defect in the picker: `my_direct_message_candidates` resolves a name from
-- `profiles.first_name || ' ' || surname` and returns null when both are blank,
-- and the client is right to say "Ovalball user" rather than print an email
-- address into a list. A picker is not a directory.
--
-- The blank names are a SEED gap. Several personas were created by one seed
-- (which gives them a login and a membership) and named by another, and the
-- naming insert is guarded `where not exists (select 1 from profiles ...)` -- so
-- once the row existed without a name, the name never landed. Correct for
-- creation, useless for repair.
--
-- WHY THIS MATTERS BEYOND TIDINESS. The review world is what the product owner
-- reviews the product against. A screen full of "Ovalball user" is a screen
-- nobody can judge: you cannot tell whether the grouping is right, whether the
-- ordering is sensible, or whether a row belongs to the person you meant.
--
-- IDEMPOTENT AND NARROW. It only ever fills a name that is BLANK, and only for
-- the `@ovalball.test` review identities. A persona somebody has renamed by hand
-- keeps their name -- exactly as the canonical person-name rule requires, since a
-- deliberately corrected name is never re-spelled.
-- ===========================================================================

update public.profiles p
   set first_name = v.first_name,
       surname    = v.surname
  from (values
    -- The two extra guardians of the Rao family. Named in
    -- local_uat_parent_player.sql, which could not reach them once their profile
    -- rows already existed.
    ('uat.guardian.three@ovalball.test', 'Nadia',  'Rao'),
    ('uat.guardian.four@ovalball.test',  'Sanjay', 'Rao'),
    -- The platform identities. Named as people rather than as roles: "Site
    -- Admin" in a person column would be a label pretending to be a name, and it
    -- would read as one in every message thread, export and email.
    ('uat.siteadmin@ovalball.test',      'Imogen', 'Clarke'),
    ('uat.fullsiteadmin@ovalball.test',  'Rhys',   'Talbot'),
    -- Deliberately not "Callum": the product owner's own first name in a review
    -- persona is a name somebody will misread as their account in a screenshot.
    ('uat.adult.player@ovalball.test',   'Owen',   'Doyle'),
    ('uat.team.admin@ovalball.test',     'Bethan', 'Price')
  ) as v(email, first_name, surname)
 where p.email = v.email
   and coalesce(btrim(coalesce(p.first_name, '') || coalesce(p.surname, '')), '') = '';

-- The content-import identity is a SYSTEM account, not a person, and is
-- deliberately left nameless: giving it a human name would put a person who does
-- not exist into an audit trail.

do $$
declare
  v_unnamed int;
begin
  select count(*) into v_unnamed
  from public.profiles
  where email like '%@ovalball.test'
    and coalesce(btrim(coalesce(first_name, '') || coalesce(surname, '')), '') = '';
  raise notice 'UAT personas still without a name: %', v_unnamed;
end $$;
