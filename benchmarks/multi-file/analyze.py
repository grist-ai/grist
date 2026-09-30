#!/usr/bin/env python3
"""Analyze multi-file battery results.csv -> summary stats.
Usage: analyze.py [results.csv]   (defaults to ./results.csv)
"""
import csv
import os
import sys
from collections import defaultdict

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "results.csv")

rows = list(csv.DictReader(open(path)))
rows = [r for r in rows if r.get("session_id")]  # skip incomplete

configs = ["gate-ceil-cheapest", "gate-ceil-frontier", "pinned-cheapest",
           "pinned-frontier", "gate-specialists", "gate-mech-off"]

by_cfg = defaultdict(list)
for r in rows:
    by_cfg[r["config"]].append(r)

print(f"total runs: {len(rows)}")
print(f"total cost: ${sum(float(r['cost_usd']) for r in rows):.4f}")
print()
print(f"{'config':<20} {'n':>3} {'pass':>5} {'rate':>7} {'$/task':>8} {'$/resolved':>10} {'avg_dsp':>8}")
for c in configs:
    rs = by_cfg.get(c, [])
    if not rs:
        print(f"{c:<20} {'-':>3}")
        continue
    n = len(rs)
    p = sum(1 for r in rs if r["pass"] == "PASS")
    cost = sum(float(r["cost_usd"]) for r in rs)
    rate = p / n if n else 0
    per_task = cost / n if n else 0
    per_resolved = cost / p if p else float("inf")
    dsp = [int(r.get("specialist_dispatches") or 0) for r in rs]
    avg_dsp = sum(dsp) / len(dsp) if dsp else 0
    print(f"{c:<20} {n:>3} {p:>5} {rate:>6.1%} {per_task:>8.4f} {per_resolved:>10.4f} {avg_dsp:>8.1f}")

# failures by config
print("\nfailures:")
for c in configs:
    fails = [r["task"] for r in by_cfg.get(c, []) if r["pass"] != "PASS"]
    if fails:
        print(f"  {c}: {', '.join(fails)}")

# gate-error-cost vs frontier-overhead (the key comparison)
g = by_cfg.get("gate-ceil-cheapest", [])
f = by_cfg.get("pinned-frontier", [])
if g and f:
    gp = sum(1 for r in g if r["pass"] == "PASS")
    fp = sum(1 for r in f if r["pass"] == "PASS")
    gc = sum(float(r["cost_usd"]) for r in g)
    fc = sum(float(r["cost_usd"]) for r in f)
    print(f"\ngate-ceil-cheapest $/resolved: ${gc/gp:.4f} ({gp}/{len(g)})")
    print(f"pinned-frontier   $/resolved: ${fc/fp:.4f} ({fp}/{len(f)})")
    print(f"gate wins: {(gc/gp) < (fc/fp)}")

# model actually used per config (routing check)
print("\nmodel used per config:")
for c in configs:
    models = defaultdict(int)
    for r in by_cfg.get(c, []):
        models[r["model"]] += 1
    print(f"  {c}: {dict(models)}")

# dispatch detail (task, config, count)
print("\ndispatch detail (task, config, count):")
for r in rows:
    d = int(r.get("specialist_dispatches") or 0)
    if d > 0:
        print(f"  {r['task']}/{r['config']}: {d}")
