#!/usr/bin/env python3
"""Verify one encrypted Ovalball backup archive (database backup or Storage export) against its ESCROWED digest.

    scripts/ops/backup/verify-backup-archive.py --archive FILE.tar.cms --verify-key KEY.pem
    (the SHA-256 recorded in escrow is then typed in; it is not taken from anything stored beside the archive)

WHY. `openssl cms -aes256` (LibreSSL) is NOT authenticated encryption: a modified ciphertext can decrypt without an
error. Integrity therefore rests on the archive's SHA-256 recorded at creation time somewhere the archive's storage
cannot change -- the operator's escrow (password manager / sealed record), not the custody.json next to the file.

WHAT IT DOES, stopping at the first failure:
 1. The archive's SHA-256 must equal the escrowed digest. Mismatch -> stop before decrypting anything.
 2. The archive is first COPIED into a new mode-700 scratch folder beside it (never the repository, never a synced
    folder, never $TMPDIR), and that copy is the one hashed AND decrypted -- so a file swapped after the check is
    never the one decrypted. The key's passphrase is asked for by openssl itself, never an argument.
 3. A database backup: every file must match SHA256SUMS. A Storage export: every object must match the manifest's
    SHA-256 and size, and every manifest object must be present.
 4. Plaintext deleted, success or failure. Prints counts and digests only.
It reads no database and no network.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


class _Fail(Exception):
    pass


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", required=True, type=Path)
    ap.add_argument("--verify-key", required=True, type=Path)
    ap.add_argument("--expected-sha256-from-stdin", action="store_true",
                    help="read the escrowed digest from standard input instead of prompting (rehearsal/automation)")
    ap.add_argument("--rehearsal-passphrase-env", action="store_true",
                    help="rehearsal only: read the key passphrase from OVB_BACKUP_KEY_PASSPHRASE (default: openssl prompts)")
    ap.add_argument("--scratch-dir", type=Path, help="where plaintext is unpacked (default: the archive's folder)")
    a = ap.parse_args()
    if not a.archive.is_file() or not a.verify_key.is_file():
        print("REFUSED: archive or key not found", file=sys.stderr)
        return 2
    base = (a.scratch_dir or a.archive.parent).resolve()
    home = Path.home().resolve()
    synced = [home / "Library/Mobile Documents", home / "Library/CloudStorage", home / "Dropbox", home / "Google Drive",
              home / "OneDrive", home / "iCloud Drive"]
    if str(base) == str(REPO) or str(base).startswith(str(REPO) + "/") or any(str(base).startswith(str(p)) for p in synced):
        print("REFUSED: the scratch folder would be inside the repository or a synced folder (use --scratch-dir)", file=sys.stderr)
        return 2
    if a.expected_sha256_from_stdin:
        expected = sys.stdin.readline().strip().lower()
    else:
        expected = input("SHA-256 of this archive as recorded in escrow: ").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        print("REFUSED: the escrowed digest must be 64 hexadecimal characters", file=sys.stderr)
        return 2

    os.umask(0o077)
    pp = os.environ.pop("OVB_BACKUP_KEY_PASSPHRASE", "")   # never inherited by anything else
    passin = ["-passin", "env:OVB_BACKUP_KEY_PASSPHRASE"] if (pp and a.rehearsal_passphrase_env) else []
    ossl_env = {**os.environ, "OVB_BACKUP_KEY_PASSPHRASE": pp} if passin else dict(os.environ)

    def on_signal(signum, _frame):
        raise KeyboardInterrupt(f"signal {signum}")
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, on_signal)
    scratch = Path(tempfile.mkdtemp(prefix=".ovb-verify-", dir=str(base)))
    rc = 1
    try:
        copy = scratch / "archive.cms"
        shutil.copyfile(a.archive, copy)          # hash and decrypt the SAME bytes
        actual = sha256(copy)
        if actual != expected:
            print(f"FAILED: the archive's SHA-256 is {actual}, escrow says {expected}. Not decrypted: treat it as untrusted.")
            raise _Fail(4)
        print(f"archive SHA-256 matches escrow: {actual}")
        tar_path = scratch / "a.tar"
        with tar_path.open("wb") as out:
            r = subprocess.run(["openssl", "cms", "-decrypt", "-binary", "-inform", "DER", "-in", str(copy),
                                "-inkey", str(a.verify_key), *passin], stdout=out, stderr=subprocess.DEVNULL, env=ossl_env)
        if r.returncode != 0:
            print("FAILED: the archive does not decrypt with this key")
            raise _Fail(5)
        x = scratch / "x"
        try:
            with tarfile.open(tar_path) as t:
                for m in t.getmembers():
                    if m.name.startswith("/") or ".." in Path(m.name).parts or not (m.isfile() or m.isdir()):
                        raise ValueError("unsafe member")
                t.extractall(x)
        except Exception:
            print("FAILED: the decrypted archive does not unpack safely")
            raise _Fail(5)
        tar_path.unlink()

        if (x / "SHA256SUMS").is_file():
            lines = [l.split() for l in (x / "SHA256SUMS").read_text().splitlines() if l.strip()]
            bad = [n for d, n in lines if not (x / n).is_file() or sha256(x / n) != d]
            if bad or not lines:
                print(f"FAILED: database backup -- {len(bad)} of {len(lines)} files do not match SHA256SUMS")
                raise _Fail(6)
            print(f"database backup: {len(lines)} files match SHA256SUMS")
            rc = 0
        elif (x / "manifest.json").is_file() and (x / "objects").is_dir():
            m = json.loads((x / "manifest.json").read_text())
            objs = m.get("objects") or []
            bad = 0
            for o in objs:
                p = x / "objects" / o["bucket"] / o["name"]
                if not p.is_file() or p.stat().st_size != o["size"] or sha256(p) != o["sha256"]:
                    bad += 1
            files = sum(1 for p in (x / "objects").rglob("*") if p.is_file())
            if bad or files != len(objs):
                print(f"FAILED: Storage export -- {bad} of {len(objs)} objects differ from the manifest; {files} files present")
                raise _Fail(6)
            print(f"Storage export: {len(objs)} objects in {len(m.get('buckets') or [])} buckets match the manifest "
                  f"({sum(o['size'] for o in objs)} bytes)")
            rc = 0
        else:
            print("FAILED: not a recognised Ovalball backup archive")
            raise _Fail(6)
    except _Fail as f:
        rc = f.args[0]
    except KeyboardInterrupt:
        print("FAILED: interrupted")
        rc = 130
    finally:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        shutil.rmtree(scratch, ignore_errors=True)
        if scratch.exists():
            print(f"PLAINTEXT NOT DELETED: {scratch} -- delete it by hand NOW; the verification has failed")
            rc = 8
    if rc == 0:
        print("ARCHIVE VERIFIED against the escrowed digest. Plaintext deleted.")
    return rc


if __name__ == "__main__":
    sys.exit(main())
