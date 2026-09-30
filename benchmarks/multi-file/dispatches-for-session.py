#!/usr/bin/env python3
"""Count specialist subagent dispatches in a grist session export.
Usage: dispatches-for-session.py <session_id>
Outputs: dispatch_count,comma,separated,agent,ids
Detects tool calls that spawn subagents (opencode `task` tool or grist roster agents).
"""
import json
import os
import shutil
import subprocess
import sys

GRIST = os.environ.get("GRIST_BIN") or shutil.which("grist") or "grist"

SUBAGENT_TOOL_NAMES = {"task", "subagent", "dispatch"}
ROSTER_IDS = {"grist-explore", "grist-review", "grist-verify", "grist-plan", "explore"}


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
        print("0,")
        return
    d = json.loads(out.stdout)
    dispatches = []
    for m in d.get("messages", []):
        for c in (m.get("content") or []):
            if not isinstance(c, dict) or c.get("type") != "tool":
                continue
            name = (c.get("name") or "").lower()
            inp = c.get("state", {}).get("input", {}) or {}
            agent_id = ""
            if isinstance(inp, dict):
                agent_id = str(inp.get("agent", "") or inp.get("subagent", "") or "")
            blob = (name + " " + agent_id + " " + json.dumps(inp)).lower()
            is_dispatch = (
                name in SUBAGENT_TOOL_NAMES
                or any(r in blob for r in ROSTER_IDS)
                or ("agent" in inp and isinstance(inp.get("agent"), str))
            )
            if is_dispatch:
                dispatches.append(agent_id or name)
    print(f"{len(dispatches)},{'|'.join(dispatches)}", flush=True)


if __name__ == "__main__":
    main()
