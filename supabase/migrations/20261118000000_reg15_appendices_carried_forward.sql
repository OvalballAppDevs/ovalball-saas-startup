-- The nine Regulation 15 appendices, banked and asserted as carried forward.
--
-- THE FINDING
--
-- The RFU has NOT reissued the Regulation 15 Rules of Play for 2026/27. All
-- nine appendix pages were captured live from englandrugby.com on 2026-09-07
-- at 20:55-20:56 -- five weeks into the 2026/27 season -- and every one of
-- them still reads:
--
--   Last Updated: 31 Jul 2025
--   Effective from Friday 1st August 2025.
--
-- This is not a stale capture. Three independent lines of evidence agree:
--
--  1. Today's nine print-to-PDF captures, each carrying its own correct
--     englandrugby.com appendix URL in the page footer.
--  2. The developer's separate paste of the same nine pages earlier the same
--     day: 178 of 180 sampled body sentences match the captures verbatim.
--  3. That same paste contains RFU Regulations 3, 5, 6, 7 and 8 all reading
--     "Effective from Saturday 1st August 2026". The RFU moved the general
--     regulations to 2026/27 and left the Rules of Play untouched.
--
-- THE DETERMINATION, AND WHOSE IT IS
--
-- The 2026/27 master Regulation 15 states at 15.2(2)(a) that play must be "in
-- accordance with the Rules of Play set out Appendix 1 to 9 of this
-- Regulation" -- it points at the appendices without dating them, and these
-- nine pages are what the RFU publishes under that master today. A club
-- following the RFU's own website is following exactly these documents.
--
-- The developer reviewed that evidence and explicitly authorised their use:
-- "use them even though they 25/26 that's absolutely fine."
--
-- That authorisation is what `carries_forward` exists to record. The flag was
-- built in 20261116000000 precisely so that "this document is still in force"
-- is an assertion a person makes with a written reason, never something
-- inferred from a missing effective_to -- which is exactly the inference that
-- made the 2025/26 appendix look current in the first place.
--
-- WHAT THIS DOES NOT DO
--
-- It populates no regulatory fact. It records provenance and an authorisation.
-- Extraction and population are a separate, reviewed step.

do $$
declare
  v_auth uuid;
  v_prev uuid;
  r record;
begin
  select id into v_auth from public.regulatory_authorities where code = 'RFU';
  if v_auth is null then raise exception 'RFU authority row missing.'; end if;

  for r in
    select * from (values
      (1, 'RFU Regulation 15 - Appendix 1 - U7s Rules of Play (Tag Rugby)', 'U7',
       'regulation-15-appendix-1-u7-rules-of-play',
       'd5381291e786d86e34db3d00e43718146753fe9dcac7190b0aec4ab7699c4ef5', 6, 294222),
      (2, 'RFU Regulation 15 - Appendix 2 - U8s Rules of Play (Tag Rugby)', 'U8',
       'regulation-15-appendix-2-u8-rules-of-play',
       '7d7e8587b8c4b6598f5ec5a71213302fad9416d4ce7f306aace1e0af6c25f7af', 7, 304531),
      (3, 'RFU Regulation 15 - Appendix 3 - U9s Rules of Play (Transitional Contact)', 'U9',
       'regulation-15-appendix-3-u9-rules-of-play',
       'a58a2ae2e691dbc1b6009228944575e46f976bb35cc087c8031ece0a00128644', 6, 293375),
      (4, 'RFU Regulation 15 - Appendix 4 - U10s Rules of Play', 'U10',
       'regulation-15-appendix-4-u10-rules-of-play',
       'fe93537d33431dd4609bb8c843aa82b9e32d61abcc70bd79a22b9521decba0a9', 8, 360174),
      (5, 'RFU Regulation 15 - Appendix 5 - U11s Rules of Play', 'U11',
       'regulation-15-appendix-5-u11-rules-of-play',
       '6fef64d8552cb04e1cc84a8554cf6dbde6122270681c68013f85bbf93e972457', 8, 333737),
      (6, 'RFU Regulation 15 - Appendix 6 - U12s Rules of Play', 'U12',
       'regulation-15-appendix-6-u12-rules-of-play',
       'ecdb04d5ab56cd6352461c67d3dbb4d9a16323f11673139223a41ed6746fe0e7', 8, 365054),
      (7, 'RFU Regulation 15 - Appendix 7 - U13s Rules of Play', 'U13',
       'regulation-15-appendix-7-u13-rules-of-play',
       '85c5610c300f72f51566c0ca1b2d0ef08abb17af6138faa79a133298ea0715c7', 8, 326753),
      (8, 'RFU Regulation 15 - Appendix 8 - U14s Rules of Play', 'U14',
       'regulation-15-appendix-8-u14-rules-of-play',
       'd1303494d62a79226be4ae4e22f4c1698fb7d0c94e9c6d619623fd891ee91264', 8, 334689),
      (9, 'RFU Regulation 15 - Appendix 9 - U15-U18 Variations to Laws of the Game', 'U15-U18',
       'regulation-15-appendix-9-u15-u18-variations-to-the-laws-of-the-game',
       'da0e10e4eaaa8ce0d40206c93010e8b8122abe80a2a59b125e6f57bb1e8ae657', 3, 234536)
    ) as t(n, title, scope, slug, sha, pages, bytes)
  loop
    insert into public.regulatory_sources (
      source_key, authority_id, rugby_code, title, source_type, authority_classification,
      canonical_url, landing_page_url, document_version, retrieved_on, effective_from,
      review_state, carries_forward, carries_forward_note, notes, provenance_notes
    ) values (
      'RFU-REG15-APP' || r.n || '-2025-001',
      v_auth, 'union', r.title, 'REGULATION', 'PRIMARY_REGULATION',
      'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby/' || r.slug,
      'https://www.englandrugby.com/run/rules-governance/rfu-rules-and-regulations/regulation-15-age-grade-rugby',
      '2025/26 edition, carried forward into 2026/27',
      date '2026-09-07',
      date '2025-08-01',
      'VERIFIED_CURRENT',
      true,
      'CARRIED FORWARD INTO 2026/27 ON THE DEVELOPER''S EXPLICIT AUTHORISATION (2026-09-07). The RFU has not reissued the Regulation 15 Rules of Play: this page was captured live from englandrugby.com on 2026-09-07, five weeks into the 2026/27 season, and still reads "Last Updated: 31 Jul 2025 / Effective from Friday 1st August 2025". The 2026/27 master Regulation 15 (RFU-REG15-MASTER-2026-27, Effective 1 August 2026) states at 15.2(2)(a) that play must accord with "the Rules of Play set out Appendix 1 to 9 of this Regulation", pointing at the appendices without dating them -- so these documents are what the RFU currently presents as the Rules of Play in force. Corroborated by a separate developer paste of the same nine pages earlier the same day (178/180 sampled body sentences identical), and by the fact that Regulations 3/5/6/7/8 in that same paste had already moved to "Effective from Saturday 1st August 2026" while the appendices had not. IF THE RFU LATER REISSUES THESE, this flag is what makes the change detectable rather than silent: the season guard will flag the mismatch as soon as a newer source appears.',
      'Scope: ' || r.scope || '. Page count ' || r.pages || ', ' || r.bytes || ' bytes.',
      'DEVELOPER-SUPPLIED BROWSER PRINT CAPTURE. englandrugby.com returns HTTP 403 to automated requests (retested 2026-09-07 on all nine appendix URLs plus the master page: all 403, not circumvented). The developer opened each page and printed it to PDF; files are in research-ingestion/rfu/ (gitignored). Chrome/Skia print engine, captured 2026-09-07 20:55-20:56, each PDF footer carrying its own correct appendix URL and capture timestamp. SHA-256 ' || r.sha || '. Unlike the master capture, these carry a full TEXT LAYER, so extraction is machine-readable rather than read from page images.'
    )
    on conflict (source_key) do update set
      title = excluded.title,
      canonical_url = excluded.canonical_url,
      landing_page_url = excluded.landing_page_url,
      document_version = excluded.document_version,
      retrieved_on = excluded.retrieved_on,
      effective_from = excluded.effective_from,
      review_state = excluded.review_state,
      carries_forward = excluded.carries_forward,
      carries_forward_note = excluded.carries_forward_note,
      notes = excluded.notes,
      provenance_notes = excluded.provenance_notes,
      updated_at = now();
  end loop;
end $$;

-- Record the outcome on the conflict this settles. It stays OPEN: resolving a
-- regulatory conflict stamps resolved_by, and that is an accountable human act
-- performed through resolve_regulatory_conflict(), not by a migration.
update public.regulatory_conflicts
set description = description || E'\n\n--- ANSWERED (2026-09-07), READY FOR SIGN-OFF ---\n'
  || 'THE RFU DID NOT REISSUE THE APPENDICES. All nine were captured live from englandrugby.com on 2026-09-07, five weeks into the 2026/27 season, and every one still reads "Last Updated: 31 Jul 2025 / Effective from Friday 1st August 2025". There is no 2026/27 appendix set to obtain. '
  || 'The asymmetry noted when this conflict was opened is now explained rather than merely observed: the RFU updated Regulations 3/5/6/7/8 to "Effective from Saturday 1st August 2026" and left the Regulation 15 Rules of Play untouched. '
  || 'RESOLUTION: the developer reviewed the evidence and authorised carrying the 2025/26 appendices forward into 2026/27 ("use them even though they 25/26 that''s absolutely fine"). All nine sources now carry carries_forward = true with that authorisation and its evidence recorded in carries_forward_note, which exempts them from the season-compatibility guard. The guard itself is unchanged and still blocks every other season mix. '
  || 'RESIDUAL RISK, STATED: if the RFU reissues the appendices mid-season, the carried-forward flag is what makes that detectable -- a newer source with a 2026/27 effective date will trip the season guard rather than silently coexist.'
where conflict_key = 'RFU-REG15-APPENDIX-SEASON-SPLIT'
  and review_state = 'OPEN'
  and description not like '%THE RFU DID NOT REISSUE%';

-- The guard must still be clean, and the carried-forward exemption must be the
-- only reason any appendix passes it.
do $$
declare v_bad record;
begin
  for v_bad in select * from public.regulatory_season_compatibility_report() loop
    raise exception 'Season incompatibility after banking the appendices: % (%) -- %',
      v_bad.content_set_key, v_bad.violation, v_bad.offending_sources;
  end loop;

  if (select count(*) from public.regulatory_sources
      where source_key like 'RFU-REG15-APP%' and source_key not like '%2017%'
        and carries_forward and carries_forward_note is not null) <> 9 then
    raise exception 'Expected exactly 9 carried-forward Regulation 15 appendix sources, each with a written reason.';
  end if;
end $$;
