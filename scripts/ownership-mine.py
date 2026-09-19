#!/usr/bin/env python3
"""Ownership mining stub (pre-POC §6).

Walk git history with pydriller and emit candidate ownership / convention
facts for Grist's verified-outcome memory store.

This script does NOT write to memory automatically — print JSON lines for
review, then remember with outcome=user_approved (or after tests_passed).

Usage:
  pip install pydriller
  python scripts/ownership-mine.py /path/to/prosh --since 2024-01-01

License: verify pydriller license before shipping in a commercial path.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict


def main() -> int:
    parser = argparse.ArgumentParser(description="Mine ownership candidates via pydriller")
    parser.add_argument("repo", help="Path to git repository (e.g. Prosh)")
    parser.add_argument("--since", default=None, help="Only commits after YYYY-MM-DD")
    parser.add_argument("--top", type=int, default=5, help="Top authors per path prefix")
    args = parser.parse_args()

    try:
        from pydriller import Repository  # type: ignore
    except ImportError:
        print("Install pydriller: pip install pydriller", file=sys.stderr)
        return 1

    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    kwargs = {"path_to_repo": args.repo}
    if args.since:
        kwargs["since"] = args.since

    for commit in Repository(**kwargs).traverse_commits():
        author = commit.author.name or commit.author.email or "unknown"
        for mod in commit.modified_files:
            path = mod.new_path or mod.old_path
            if not path:
                continue
            # directory-level ownership signal
            parts = path.split("/")
            prefix = "/".join(parts[:2]) if len(parts) > 1 else parts[0]
            counts[prefix][author] += 1

    for prefix, authors in sorted(counts.items()):
        ranked = sorted(authors.items(), key=lambda kv: -kv[1])[: args.top]
        fact = {
            "type": "ownership_candidate",
            "path_prefix": prefix,
            "authors": [{"name": name, "commits": n} for name, n in ranked],
            "suggested_memory": (
                f"Path prefix `{prefix}` is most often touched by "
                + ", ".join(f"{n} ({c})" for n, c in ranked)
                + ". Verify before remembering."
            ),
        }
        print(json.dumps(fact))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
