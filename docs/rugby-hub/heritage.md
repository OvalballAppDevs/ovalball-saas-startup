# Rugby Hub — heritage layer

History, timelines, stories and people, for both codes.

**Status:** researched and banked. 8 eras, 40 entries, 64 sources. The data is
in the database and query-ready; **no UI has been built for it yet.**

## Why this is not the regulatory layer

The regulatory model assumes there is a governing body, it published a
document, and that document is the answer. Provenance is a URL, disagreement
is a defect, and a fact is either current or superseded.

History does not behave that way, and forcing it into that shape produces
confident falsehoods. Three differences drove a separate schema.

**The founding story is a myth.** "William Webb Ellis picked up the ball and
ran in 1823" is carved on the World Cup trophy and is not history. It rests on
a second-hand account written more than fifty years later; the 1845 laws
written at Rugby School itself do not mention him. A model with no way to say
*this is believed, celebrated, and false* would have to either publish it as
fact or delete it. Both are wrong. A child asking "who invented rugby?"
deserves the whole answer: nobody did, and here is the story people tell.

**Disagreement is often the subject.** The 1895 split is described as a
dispute about broken-time payments, as a class conflict, and as a north/south
conflict. Historians differ in emphasis. The regulatory model would flag that
as a conflict to close; here it is the thing worth teaching.

**Nothing supersedes.** A 2026/27 regulation replaces its 2025/26 version.
1895 does not replace 1871. Heritage accumulates.

## Tables

| Table | Purpose |
|---|---|
| `heritage_eras` | Narrative periods the timeline groups by |
| `heritage_entries` | Events, people, milestones, stories |
| `heritage_entry_sources` | Citations, one entry to many |
| `heritage_timeline` (view) | Entries + era + computed `requires_caveat` |

All three tables are public-read and have **no write policy at all**. Content
arrives by migration or Site Admin tooling running as the service role. A club
admin cannot edit the sport's history from inside their own club.

## The certainty vocabulary

This is the heart of the design.

| Value | Meaning |
|---|---|
| `ESTABLISHED` | Documented, uncontested, safe to state plainly |
| `WELL_DOCUMENTED` | Solid, but detail varies between accounts |
| `CONTESTED` | Historians genuinely disagree on cause or meaning |
| `LEGEND` | Widely told, plausible, unverifiable |
| `MYTH` | Widely believed and **not** supported by evidence |

Anything below `WELL_DOCUMENTED` **must** carry a `certainty_note`, enforced by
the `heritage_entries_uncertainty_explained` constraint. That is the structural
guarantee: a myth can never be rendered as a bare fact, because the caveat
always exists to be shown beside it.

`heritage_timeline.requires_caveat` computes this once so no consumer
re-derives it. **Any surface rendering an entry where `requires_caveat` is true
must show `certainty_note` with it.**

Currently 2 of 40 entries require a caveat: the Webb Ellis story (`MYTH`) and
the causes of the 1895 split (`CONTESTED`).

## The source-tier boundary

`heritage_entry_sources.source_tier` is what keeps the regulatory boundary
intact:

`GOVERNING_BODY` · `MUSEUM_OR_ARCHIVE` · `ACADEMIC` · `ENCYCLOPEDIA` ·
`POPULAR_HISTORY` · `CONTEMPORARY_REPORT`

`ENCYCLOPEDIA` and `POPULAR_HISTORY` are acceptable **for history and nowhere
else in the product.** `regulatory_sources` has its own, much narrower
vocabulary with no overlap. The distinction is deliberate: the claim being made
here is "this is what is recorded, and how confidently", not "this is the rule
your child must play by".

## Editorial rules applied

**Everything before 1895 is `pre_schism`, not `union`.** The shared history
belongs to both codes equally. Writing rugby league's story as though it begins
in 1895 is the commonest error in rugby history, and it quietly frames league
as a departure from a norm rather than one of two inheritors of the same game.
13 of 40 entries are `pre_schism`.

**League gets equal weight.** 11 league entries against 10 union. A heritage
section that treats league as a footnote reproduces the hierarchy the split
created.

**The unflattering parts are included.** The RFU's century-long ban on anyone
who had played league — amateurs included — is in there, as is the exclusion
that sent Black Welsh players like Billy Boston north to Wigan. A heritage
section that records the Challenge Cup but not those is marketing, not history.

**Nothing is stated more confidently than the evidence allows,** and no source
text is reproduced — the summaries are written from the research.

## Integrity

`select * from public.heritage_content_integrity();`

Four set-level checks, all of which must return zero: entries without sources,
uncertain entries without a note, entries without an era, sources without a
URL. Row constraints catch a bad *row*; this catches a bad *set*.

Run it after any heritage content change. The first content batch shipped three
unsourced entries because the rule lived only in a comment — the function
exists so that cannot happen silently again, and both content migrations end by
calling it and raising if it fails.

## What is not done

- **No UI.** The data is banked and query-ready; nothing renders it yet.
- **Coverage is a foundation, not complete.** Obvious gaps: club-level and
  community heritage, the amateur/professional split in Wales specifically,
  more individual players in both codes, the growth of the game outside
  Britain and Australasia, disability rugby, and the post-2000 women's game
  between 1991 and 2014.
- **No club-specific heritage.** Deliberately: `people` and `places` are free
  text, not foreign keys, because heritage refers to institutions that predate,
  outlive and sit outside Ovalball's club directory.
