#!/usr/bin/env python3
"""
Extracts the "Club Directory" sheet from data/clubdata/clubdatalist.xlsx and
produces a clean staging CSV plus an unresolved/exclusion report.

Deliberately conservative, per the approved club_directory ingestion rules:
- name/source/source_url/etc. are preserved verbatim (no aggressive
  normalization of governing-body names).
- normalized_key is a LIGHT-touch lookup key only (lowercase, whitespace
  collapsed, punctuation stripped) -- no suffix stripping ("RFC" etc.),
  since that fuzzy-matching decision is explicitly deferred to a later
  Alias/lookup architecture stage.
- external_id is preserved only when present; never invented.
- Rows missing a required Data Dictionary field are excluded from the
  staging CSV and reported as unresolved, not imported with guessed data.
- Within-file duplicate detection uses (source, normalized_key, postcode)
  as a conservative same-source match key.

Output: scripts/ingestion/out/club_directory_staging.csv
        scripts/ingestion/out/club_directory_unresolved.json
"""
import csv
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

XLSX_PATH = Path(__file__).resolve().parents[2] / "data" / "clubdata" / "clubdatalist.xlsx"
OUT_DIR = Path(__file__).resolve().parent / "out"

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

REQUIRED_FIELDS = [
    "name", "rugby_code", "country", "nation",
    "source", "source_url", "verification_status",
]

# Full club_directory column order, matching the Data Dictionary exactly.
COLUMNS = [
    "name", "rugby_code", "country", "nation", "region", "county", "town",
    "home_ground", "address", "postcode", "website", "official_email",
    "source", "external_id", "source_url", "source_updated_at", "active",
    "verification_status", "notes", "constituent_body",
]


def col_to_num(col):
    n = 0
    for c in col:
        n = n * 26 + (ord(c) - ord("A") + 1)
    return n


def cellref_col(ref):
    m = re.match(r"([A-Z]+)(\d+)", ref)
    return m.group(1)


def load_shared_strings(z):
    try:
        data = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(data)
    out = []
    for si in root.findall("a:si", NS):
        out.append("".join(t.text or "" for t in si.findall(".//a:t", NS)))
    return out


def dump_sheet(z, sheet_path, shared):
    data = z.read(sheet_path)
    root = ET.fromstring(data)
    sheetdata = root.find("a:sheetData", NS)
    rows = []
    for row in sheetdata.findall("a:row", NS):
        cells = {}
        for c in row.findall("a:c", NS):
            ref = c.attrib.get("r")
            if not ref:
                continue
            col = cellref_col(ref)
            t = c.attrib.get("t")
            v = c.find("a:v", NS)
            val = v.text if v is not None else ""
            if t == "s" and val != "":
                try:
                    val = shared[int(val)]
                except Exception:
                    pass
            elif t == "inlineStr":
                isnode = c.find("a:is", NS)
                if isnode is not None:
                    val = "".join((t2.text or "") for t2 in isnode.findall(".//a:t", NS))
            cells[col_to_num(col)] = val
        if cells:
            maxc = max(cells.keys())
            rows.append([cells.get(i, "") for i in range(1, maxc + 1)])
        else:
            rows.append([])
    return rows


def find_sheet_path(z, sheet_name):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels_root = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
    rid_to_target = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root.findall("r:Relationship", rns)}
    for sheet in wb.find("a:sheets", NS):
        if sheet.attrib["name"] == sheet_name:
            rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = rid_to_target[rid].lstrip("/")
            return target if target.startswith("xl/") else "xl/" + target
    raise KeyError(sheet_name)


def normalize_key(name: str) -> str:
    """Light-touch only: lowercase, collapse whitespace, strip punctuation.
    Deliberately does NOT strip suffixes like 'RFC'/'Rugby Football Club' --
    that fuzzy-normalization decision belongs to a later stage."""
    s = name.lower()
    s = re.sub(r"[^\w\s]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def to_bool(v: str):
    if v is None or v == "":
        return True  # Data Dictionary: "TRUE by default for currently listed clubs"
    v = str(v).strip().lower()
    return v in ("1", "true", "yes", "y")


def main():
    OUT_DIR.mkdir(exist_ok=True)
    z = zipfile.ZipFile(XLSX_PATH)
    shared = load_shared_strings(z)
    sheet_path = find_sheet_path(z, "Club Directory")
    rows = dump_sheet(z, sheet_path, shared)

    header = [h.strip() for h in rows[0]]
    data_rows = rows[1:]
    # Trailing wholly-empty rows (trailing blank XML rows) don't count as data.
    data_rows = [r for r in data_rows if any((c or "").strip() for c in r)]

    print(f"Source sheet: 'Club Directory'")
    print(f"Header columns ({len(header)}): {header}")
    print(f"Total data rows found: {len(data_rows)}")

    if header != COLUMNS:
        missing = [c for c in COLUMNS if c not in header]
        extra = [c for c in header if c not in COLUMNS]
        print(f"WARNING: header mismatch vs expected club_directory columns.")
        print(f"  Missing from source: {missing}")
        print(f"  Extra in source: {extra}")

    col_index = {name: i for i, name in enumerate(header)}

    clean_rows = []
    excluded = []
    seen_within_file = defaultdict(list)

    for i, raw in enumerate(data_rows, start=2):  # +1 header, +1 to be 1-indexed to sheet row
        def get(col):
            idx = col_index.get(col)
            if idx is None or idx >= len(raw):
                return ""
            return (raw[idx] or "").strip()

        row = {c: get(c) for c in COLUMNS}

        missing_required = [f for f in REQUIRED_FIELDS if not row[f]]
        if missing_required:
            excluded.append({
                "sheet_row": i,
                "name": row.get("name") or "(no name)",
                "reason": f"missing required field(s): {', '.join(missing_required)}",
            })
            continue

        row["normalized_key"] = normalize_key(row["name"])
        row["active"] = to_bool(row["active"])
        # Blank optional strings -> None so we never write '' into the DB.
        for c in COLUMNS:
            if c not in REQUIRED_FIELDS and c != "active" and row[c] == "":
                row[c] = None

        dedup_key = (row["source"], row["normalized_key"], row["postcode"] or "")
        seen_within_file[dedup_key].append((i, row))
        clean_rows.append((i, row))

    # Within-file duplicate detection: same (source, normalized_key, postcode)
    # appearing more than once in the source sheet itself.
    within_file_dupes = {k: v for k, v in seen_within_file.items() if len(v) > 1}
    dupe_sheet_rows = set()
    for key, occurrences in within_file_dupes.items():
        rows_desc = [{"sheet_row": r, "name": row["name"], "external_id": row["external_id"]} for r, row in occurrences]
        excluded.append({
            "sheet_row": [r for r, _ in occurrences],
            "name": occurrences[0][1]["name"],
            "reason": "within-file duplicate (same source + normalized name + postcode appears more than once)",
            "occurrences": rows_desc,
        })
        for r, _ in occurrences:
            dupe_sheet_rows.add(r)

    final_rows = [row for (i, row) in clean_rows if i not in dupe_sheet_rows]

    # Write staging CSV
    staging_path = OUT_DIR / "club_directory_staging.csv"
    with open(staging_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = COLUMNS + ["normalized_key"]
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in final_rows:
            w.writerow({k: row.get(k) for k in fieldnames})

    unresolved_path = OUT_DIR / "club_directory_unresolved.json"
    with open(unresolved_path, "w", encoding="utf-8") as f:
        json.dump(excluded, f, indent=2)

    print(f"\nClean staging rows: {len(final_rows)}")
    print(f"Excluded/unresolved rows: {len(excluded)}")
    print(f"  - missing required field: {sum(1 for e in excluded if 'missing required' in e['reason'])}")
    print(f"  - within-file duplicates: {len(within_file_dupes)} groups, {len(dupe_sheet_rows)} rows")
    print(f"\nWrote: {staging_path}")
    print(f"Wrote: {unresolved_path}")


if __name__ == "__main__":
    main()
