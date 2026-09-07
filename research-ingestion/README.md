# Research ingestion

Where official governing-body documents are placed for local extraction.

## Why this directory exists

`englandrugby.com` returns HTTP 403 to every automated request, at the
CloudFront layer — `robots.txt` included. That control is **not** to be
circumvented: no proxy rotation, no client spoofing, no challenge bypass, no
session reuse. The RFU's documents are the foundation of Rugby Hub's
provenance, and obtaining them by defeating the RFU's own access controls
would undermine the relationship that provenance depends on.

Three publicly-mirrored candidates were retrieved and verified instead
(`docs/rugby-hub/acquisition-log.json`). None established equivalence with the
current season:

- one was a **Microsoft Word document authored by a named individual** — the
  RFU's text, but not the RFU's file, and with no season stated;
- one had **no version or publication metadata at all**;
- one was a genuine RFU-produced artefact, but the **2017/18 edition**.

So the documents are requested manually, once.

## What to put here

Official PDFs, downloaded through a normal browser from englandrugby.com,
into `rfu/` — create the directory if it isn't there; only this README is
tracked. Keep the RFU's own filenames where possible.

## What happens next

Extraction runs locally against these files and automates normally from that
point on. Two rules survive ingestion:

1. **The canonical provenance recorded against every extracted fact remains
   the `englandrugby.com` URL**, never a path in this directory. The file is
   how we obtained the bytes; the RFU remains the authority.
2. **Nothing in here is committed.** The directory is gitignored. Ovalball
   stores structured facts and its own explanations with citations — never
   copies of governing-body documents.
