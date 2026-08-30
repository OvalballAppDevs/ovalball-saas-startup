#!/usr/bin/env python3
"""
Runs import_club_directory.sql directly against the remote database via the
local Docker container's psql binary (as a pure network client).

The connection string is supplied at runtime via the OVALBALL_REMOTE_DB_URL
environment variable -- never a file in the project directory, and never
printed anywhere. Set it in your own shell before running this script, e.g.:

    export OVALBALL_REMOTE_DB_URL='postgresql://user:password@host:port/dbname'
    python3 scripts/ingestion/run_remote_import.py

Only sanitized psql stdout/stderr (query results, row counts, notices) is
ever surfaced.
"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = "supabase_db_ovalball-saas-startup"
ENV_VAR = "OVALBALL_REMOTE_DB_URL"


def get_connection_string() -> str:
    conn = os.environ.get(ENV_VAR)
    if not conn:
        print(
            f"ERROR: {ENV_VAR} is not set.\n"
            f"Set it in your own shell first, e.g.:\n"
            f"  export {ENV_VAR}='postgresql://user:password@host:port/dbname'\n"
            f"then re-run this script. The connection string is never read from\n"
            f"a file in the project directory.",
            file=sys.stderr,
        )
        sys.exit(1)
    return conn.strip()


SMART_CHARS = {
    "‘": "left single smart quote (’ instead of ')",
    "’": "right single smart quote (' instead of ')",
    "“": "left double smart quote",
    "”": "right double smart quote",
    "–": "en-dash (– instead of -)",
    "—": "em-dash (— instead of -)",
    " ": "non-breaking space",
}


def print_masked_shape(conn: str, raw_password: str):
    p = urlsplit(conn)
    password_note = "SET (non-empty)" if p.password else "EMPTY/MISSING"
    literal_placeholder = "[YOUR-PASSWORD]" in conn or "[password]" in conn.lower() or "your-password" in conn.lower()
    found_smart_chars = sorted({SMART_CHARS[c] for c in raw_password if c in SMART_CHARS})
    non_ascii = [f"U+{ord(c):04X}" for c in raw_password if ord(c) > 127]
    print("=== connection string shape (password value never shown) ===")
    print(f"scheme:   {p.scheme}")
    print(f"username: {p.username}")
    print(f"password: {password_note}, length={len(raw_password)}{'  <-- looks like an unfilled placeholder!' if literal_placeholder else ''}")
    if found_smart_chars:
        print(f"password contains Word autocorrect artifacts: {found_smart_chars}")
    if non_ascii:
        print(f"password contains non-ASCII codepoints: {non_ascii}")
    print(f"host:     {p.hostname}")
    print(f"port:     {p.port}")
    print(f"dbname:   {p.path.lstrip('/')}")
    print()


def main():
    conn = get_connection_string()
    raw_password = urlsplit(conn).password or ""
    print_masked_shape(conn, raw_password)

    subprocess.run(
        ["docker", "cp", str(ROOT / "scripts/ingestion/out/club_directory_staging.csv"),
         f"{CONTAINER}:/tmp/club_directory_staging.csv"],
        check=True,
    )
    subprocess.run(
        ["docker", "cp", str(ROOT / "scripts/ingestion/import_club_directory.sql"),
         f"{CONTAINER}:/tmp/import_club_directory.sql"],
        check=True,
    )

    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", conn, "-f", "/tmp/import_club_directory.sql"],
        capture_output=True, text=True,
    )

    # Defense in depth: scrub the connection string from any output before printing,
    # in case an error message ever echoed it back.
    safe_out = result.stdout.replace(conn, "[REDACTED CONNECTION STRING]")
    safe_err = result.stderr.replace(conn, "[REDACTED CONNECTION STRING]")

    print("=== stdout ===")
    print(safe_out)
    print("=== stderr ===")
    print(safe_err)
    print(f"=== exit code: {result.returncode} ===")


if __name__ == "__main__":
    main()
