# Grist release notes

What changed in Grist, in plain language. Items are marked **shipped** (on `main`)
or **in progress** (on a branch, not yet released).

## Unreleased

### Specialist subagents — shipped

Grist now has four named specialists the agent can delegate to, each with a
narrowly scoped job and permissions:

- **grist-explore** — read-only codebase exploration; reports back a digest.
- **grist-review** — read-only code review; never writes.
- **grist-verify** — runs builds, tests, and checks; its shell access is limited
  to build/test commands.
- **grist-plan** — read-only planning before doing.

You don't invoke them directly — the agent dispatches one when the task fits,
instead of doing everything inline. This is the main way Grist keeps cheap-rung
runs capable: a small model plus the right specialist beats a bigger model alone.

### Effort dial — in progress

Each task now gets an effort level — `low`, `standard`, or `high` — *inside* its
cost rung. High effort means a larger exploration budget and more specialist use;
low effort means quick, inline answers. The level is picked per task (your
`GRIST_EFFORT` setting wins if you set one):

```sh
GRIST_EFFORT=high grist run "migrate the auth module"
```

### Warm subagent resume — in progress

When the agent uses the same specialist twice in one session, the second call now
resumes the first one's session instead of starting over — no re-briefing, faster
and cheaper follow-ups. On by default; `GRIST_WARM_SUBAGENTS=0` turns it off.

### `grist doctor` actually checks your key — in progress

`grist doctor` used to report "signed in" whenever a credential was *stored* —
even a revoked one. It now validates the key against the gateway with one cheap
call: a good key reports "key verified", a rejected one tells you to sign in
again. If `grist run` ever fails with an auth error after `doctor` said you were
fine, that mismatch is now gone.

### Long sessions survive the gateway size limit — in progress

Long runs used to die with an HTTP 413 once their history passed the gateway's
request-size limit — and the session was unrecoverable. The CLI now trims old
tool output (leaving a marker where it cut) before requests approach the limit,
keeping the recent conversation intact. Long tasks finish instead of failing
partway.
