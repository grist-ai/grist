#!/usr/bin/env python3
"""Compute per-session cost from `grist session export` tokens x gateway prices.
Usage: cost-for-session.py <session_id>
Outputs: cost_usd,tokens_in,tokens_out,tokens_reasoning,tokens_cached,model
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

GRIST = os.environ.get("GRIST_BIN") or shutil.which("grist") or "grist"

# Gateway prices (USD per 1M tokens), from packages/grist-gateway/src/prices.ts
# cheapest (Flash): off-peak $0.15/$0.60, peak 2x. frontier (Sol): $2/$10.
PRICES = {
    "cheapest": {"input": 0.15, "output": 0.60, "cachedInput": 0.15},
    "frontier": {"input": 2.0, "output": 10.0, "cachedInput": 2.0},
}
PEAK_WINDOWS_UTC = [(1, 4), (6, 10)]  # weekday peak hours, 2x multiplier


def is_peak(at_ms: int) -> bool:
    dt = datetime.fromtimestamp(at_ms / 1000, tz=timezone.utc)
    if dt.weekday() >= 5:
        return False
    h = dt.hour + dt.minute / 60
    return any(s <= h < e for s, e in PEAK_WINDOWS_UTC)


def main():
    ses_id = sys.argv[1]
    out = subprocess.run(
        [GRIST, "session", "export", ses_id],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if out.returncode != 0:
        print("0,0,0,0,0,unknown", flush=True)
        return
    d = json.loads(out.stdout)
    info = d["info"]
    toks = info.get("tokens", {})
    tin = toks.get("input", 0)
    tout = toks.get("output", 0)
    tre = toks.get("reasoning", 0)
    tcached = toks.get("cache", {}).get("read", 0)
    rung = info.get("model", {}).get("id", "cheapest")
    created = info.get("time", {}).get("created", 0)

    p = PRICES.get(rung, PRICES["cheapest"])
    mult = 2.0 if (rung == "cheapest" and is_peak(created)) else 1.0
    fresh = max(0, tin - tcached)
    cost = (fresh * p["input"] * mult + tcached * p["cachedInput"] * mult + tout * p["output"] * mult) / 1_000_000
    print(f"{cost:.6f},{tin},{tout},{tre},{tcached},{rung}", flush=True)


if __name__ == "__main__":
    main()
