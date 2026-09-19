#!/usr/bin/env python3
"""Mine file ownership from git history into Grist verified memory (pre-POC §6).

Stub until pydriller license is confirmed. When ready:

  pip install pydriller
  python scripts/ownership-mine.py --repo /path/to/Prosh --since 18months

Writes JSON lines suitable for `memory remember` (outcome=tests_passed once a
human reviews the mined facts — never auto-persist unreviewed ownership).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def parse_since(raw: str) -> datetime:
    raw = raw.strip().lower()
    now = datetime.now(timezone.utc)
    if raw.endswith("months") or raw.endswith("month"):
        months = int("".join(c for c in raw if c.isdigit()) or "18")
        return now - timedelta(days=30 * months)
    if raw.endswith("d") or raw.endswith("days"):
        days = int("".join(c for c in raw if c.isdigit()) or "365")
        return now - timedelta(days=days)
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def mine_with_git(repo: Path, since: datetime) -> list[dict]:
    """Fallback miner using `git log` (no pydriller). Top author per path."""
    import subprocess

    since_arg = since.strftime("%Y-%m-%d")
    # Prefix author lines so paths never collide with names.
    # Bound history so cold-start stays resumable on large repos.
    max_count = os.environ.get("GRIST_OWNERSHIP_MAX_COMMITS", "5000")
    cmd = [
        "git",
        "-C",
        str(repo),
        "log",
        f"--since={since_arg}",
        f"--max-count={max_count}",
        "--format=AUTHOR:%aN",
        "--name-only",
        "--no-merges",
    ]
    result = subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        text=True,
    )
    counts: dict[str, dict[str, int]] = {}
    author: str | None = None
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        if line.startswith("AUTHOR:"):
            author = line.removeprefix("AUTHOR:").strip() or None
            continue
        if author is None:
            continue
        file_path = line.strip()
        bucket = counts.setdefault(file_path, {})
        bucket[author] = bucket.get(author, 0) + 1

    rows: list[dict] = []
    for file_path, authors in sorted(counts.items()):
        top = max(authors.items(), key=lambda item: item[1])
        rows.append(
            {
                "container": "ownership",
                "outcome": "user_approved",
                "text": f"{file_path} owned primarily by {top[0]} ({top[1]} commits since {since_arg})",
                "meta": {"path": file_path, "author": top[0], "commits": top[1]},
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--since", default="18months")
    parser.add_argument("--out", type=Path, default=None, help="JSONL path (default stdout)")
    parser.add_argument("--limit", type=int, default=0, help="Max rows (0 = all)")
    args = parser.parse_args()

    if not (args.repo / ".git").exists():
        print(f"error: {args.repo} is not a git repo", file=sys.stderr)
        return 1

    since = parse_since(args.since)
    try:
        import pydriller  # noqa: F401

        print(
            "note: pydriller is installed but this stub still uses git log until license is confirmed",
            file=sys.stderr,
        )
    except ImportError:
        pass

    rows = mine_with_git(args.repo, since)
    if args.limit > 0:
        rows = rows[: args.limit]

    sink = args.out.open("w") if args.out else sys.stdout
    try:
        for row in rows:
            sink.write(json.dumps(row) + "\n")
    finally:
        if args.out:
            sink.close()

    print(f"[grist:ownership] mined={len(rows)} since={since.date()} repo={args.repo}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
