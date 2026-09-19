# Grist — Pre-POC Spec Sheet

> Consolidated build/test/evaluate reference. Status: pre-POC.
> Every commercial number is a hypothesis until the POC measures it.
> Personal project — never Necora code, repos, or infrastructure. Pilot repo: Prosh.

## 1. What we're building

Grist is a confidence-gated coding agent shipped as a rebranded fork of the
MIT-licensed opencode agent (anomalyco/opencode — live fork, verified).
A confidence gate routes every task to the **cheapest model tier that can handle
it** — cheap, medium, or frontier. Routine work costs fractions of a cent; hard
tasks still get frontier quality. Institutional knowledge (code map, conventions,
ownership, decisions) is mined from the user's own history and fed to agents as
retrieval, never re-explained.

**Value prop:** frontier-tier output at a flat price, with institutional memory
that survives turnover.

**Principles:**
- **Cheapest-capable routing.** Default = cheapest tier; escalation decided
  per-task by calibrated confidence, never vibes.
- **Cost-first, minimal exposure.** The thesis is cost (the router makes
  flat-rate pricing survivable). Privacy is relative and honest: code leaves
  only when necessary, only what's necessary.
- **Self-adapting = retrieval + feedback loops,** never weight updates.
- **Instrument first.** Token spend and gate precision measured from day one;
  every claim reproducible from logs.

## 2. Architecture

```
ENGINEER (chat / IDE / CLI)
   │ task
   ▼
CONFIDENCE GATE — Jev (TypeSafe System One)
  Score(difficulty) → picks cheapest capable rung
  Score(sensitivity) → caps max rung
  route ∈ { cheapest, medium, frontier }
  Context minimized on escalation (subgraph, not repo)
   ├──► CHEAPEST: DeepSeek V4 Flash        (default)
   ├──► MEDIUM:   DeepSeek V4 Pro          (pre-frontier step)
   └──► FRONTIER: Claude Opus 5            (exception only; GPT-5.6 Sol backup)
   │ tools + retrieval (all tiers)
   ▼
KNOWLEDGE LAYER — code map (bake-off open) · Supermemory (self-hosted)
                   ownership mining (pydriller → Supermemory)
   ▼
SANDBOX — Docker (v1)
   ▼
OBSERVABILITY — Langfuse (traces, $/task) · inspect_ai (gate precision, evals)
```

## 3. Model ladder (locked Sept 2026, benchmark-backed)

| Tier | Model | Coding evidence | Price/1M tok (in/out) | Role |
|------|-------|-----------------|----------------------|------|
| Cheapest | **DeepSeek V4 Flash** (`deepseek-flash`, 1M ctx) | 88.8% SWE-bench Verified (independent, vals.ai) | ~$0.15 / $0.60 off-peak | Default for everything |
| Medium | **DeepSeek V4 Pro** (0813) | 96.4% SWE-bench Verified (independent) — frontier-class | promo ~$0.44 / $0.87 | Pre-frontier step: beats cheap, doesn't need frontier |
| Frontier | **Claude Opus 5** (1M ctx; backup: GPT-5.6 Sol) | 97.0% / 96.2% SWE-bench Verified (independent) | $5 / $25 flat (Sol: $4/$20 promo) | Exception only |

- Router seam stays **provider-agnostic**. DeepSeek carries two tiers =
  concentration risk: a backup cheap tier (Kimi K2.6-class / GPT mini-class)
  must be one config change away. Recheck DeepSeek pricing at build time
  (api-docs.deepseek.com) — it moves.
- Benchmark caveat: SWE-bench Verified is saturated at the top; treat sub-2pt
  gaps as noise. SWE-bench Pro discriminates better.
- Explicitly rejected: Meta Muse Spark (proprietary, beta; contributor tier
  feeds code into training — incompatible with opt-out stance).

## 4. Confidence gate (Jev)

- **What:** TypeSafe System One (`jev-latest`), `https://api.typesafe.ai/v1/systemone`
  via `typesafe-sdk`. Not a text generator — evaluates a state, returns typed
  answers + calibrated probabilities. $0.042/MTok in, output free; 70–500 ms.
- **Primitives:** `Score` (0–1), `Choice` (route/mechanism decision), `Noul`
  (underspecification signal — forces cheapest rung; no ask-human path).
- **Two scores per task:**
  - `Score(difficulty)` → cheapest rung that can handle it.
  - `Score(sensitivity)` → caps how high it may escalate. Auth/secrets/
    proprietary logic stay on cheaper tiers even at quality cost; per-project
    policy can forbid escalation past a chosen rung.
  - `Noul(underspecified)` → stay on cheapest rather than inventing scope.
- **Context minimization on escalation:** send the relevant code-map subgraph,
  never the repo.
- **Targets:** ≥80% cheapest-tier, ≤5% frontier. (One point of frontier ≈ 30×
  one point of cheapest in cost — frontier share is the binding constraint.)
- **Thresholds are calibrated, not guessed** — set during shadow burn-in (§8.6),
  never hardcoded into pricing or docs.
- Prototype: `~/workspace/jev-confidence-gate/` (`jev_gate.py`, `demo.py`) —
  reads `TYPESAFE_API_KEY` from the environment. Key obtained 2026-09-18;
  stored in his local `.env` at build time (no vault needed — he's building
  locally).

## 5. Harness efficiency — SoL-Pi mechanisms (added pre-POC)

Source: *SoL-Pi* (arXiv:2609.20519, Sept 2026) — four harness-layer mechanisms
discovered by auto-research loops; ~33–49% fewer tokens at comparable quality.
They cut tokens *within* every tier, multiplying the router's savings.

| Mechanism | What it does | Port plan |
|-----------|--------------|-----------|
| **Action Fusion** | Bundle file edit + follow-up test/build into one tool call | Phase 2 (cheap port) |
| **ObservationPack** | Tool outputs >10KB: full twice, then handle + 1KB excerpt, retrievable on demand | Phase 2 (cheap port) |
| **Evidence-Preserving Reducer** | Cheap-tier model distills build/test logs into a *verified* evidence receipt; falls back to original on failure | Post-POC |
| **Online Context Compact** | Compact at plan-step boundaries only when projected savings beat cache-rewrite cost (cost gate) | Post-POC |

Two integrations:
1. **Routable via the gate.** Jev `Choice` picks model rung *and* mechanism set
   per task (build/test → Fusion+Reducer; exploration → ObservationPack).
   SoL-Pi's own [Performance] vs [Efficiency] modes. Every mechanism sits behind
   a cost gate: projected savings must beat its cost, or it stays off.
2. **Discovery loop (post-POC).** Shadow burn-in doesn't just calibrate
   thresholds — under the verified-outcomes-only rule it can discover
   per-codebase efficiency mechanisms. The flywheel leveled up: from tuning the
   router to evolving the harness.

## 6. Knowledge & memory

- **Code map — bake-off OPEN:** Graphify (deterministic AST-only, zero API cost)
  vs code-review-graph/CRG (MCP-native, blast-radius analysis, semantic search).
  Method: head-to-head on Prosh; lock on measured token spend + retrieval quality.
- **Agent memory:** Supermemory (MIT, self-hosted). **Verified outcomes only** —
  persist from sessions where tests passed, the user approved, or explicitly
  corrected. Never persist unreviewed generations. Stale memories decay by
  recency × outcome weight; store needs compaction.
- **Ownership mining:** pydriller → Supermemory (license: verify).
- **Cold-start bootstrap** (one overnight job, resumable): pin SHA → code-map
  build → bounded git history (12–18 mo, sharded) → ranked PR/review ingestion →
  map-reduce distillation (the one step worth frontier tokens, ~$50–200 one-time)
  → seed team profile → 1–2 week shadow burn-in → 12-question tech-lead
  questionnaire for the unresolvable remainder.
- **Router calibration** is per-user/per-codebase: which task types succeeded on
  cheaper tiers vs needed escalation. Deliberate boundary probes included
  (exploration vs exploitation).

## 7. Behavioral guardrail — the Karpathy doctrine (core, not a skill)

Baked into the fork's system prompt as identity ("surgical engineer"). Source:
community `andrej-karpathy` SKILL.md (MIT), from Karpathy's LLM-coding-pitfalls
observations.

1. **Think before coding** — state assumptions, surface tradeoffs, ask when unclear.
2. **Simplicity first** — minimum code, nothing speculative. "Would a senior
   engineer call this overcomplicated?"
3. **Surgical changes** — touch only what you must; clean up only your own mess.
   Every changed line traces to the request.
4. **Goal-driven execution** — verifiable goals; plan with per-step verification.
5. **Verification before completion** — report what was checked. "Should work"
   is not done.
6. **Respect the existing system** — conventions, ownership, dirty git state.
7. **Prefer reversible, observable steps.**

Tradeoff (from the skill): biases to caution over speed — use judgment on
trivial tasks.

**Enforcement:** mandatory plan for multi-file changes (names exact files/lines
+ verification per step); post-act diff audit logged to Langfuse, off-plan
changes flagged; Jev `Score(minimal_change)` on verified outcomes, violations
persisted to Supermemory as negative examples. Why core: fewer steps = fewer
tokens = serves the tier-mix cost target directly.

## 8. Build order (each unlocks the next)

1. **Harness.** anomalyco opencode fork on the cheap tier via Grist-held keys.
   Any machine runs it — no GPU, no downloads. *Exit: real tasks run on Prosh.*
2. **Router.** Jev wired: rung routing + sensitivity cap + context minimization;
   port Action Fusion + ObservationPack.
   *Exit: routing decisions logged per task.*
3. **Instrument.** Langfuse + token-spend logging. *Exit: $/task visible.*
4. **Map bake-off.** Graphify vs CRG on Prosh. *Exit: layer locked on data.*
5. **Memory.** Supermemory + pydriller + bootstrap over Prosh history.
   *Exit: retrieval answers ownership/convention questions.*
6. **Shadow burn-in.** 1–2 weeks real tasks in shadow mode. *Exit: calibrated
   thresholds + measured tier mix and $/user.*

Post-POC: Evidence-Preserving Reducer, Online Context Compact, discovery loop.

## 9. Evaluation plan

- **Gate quality (primary):** rung-choice precision/recall via shadow
  counterfactuals — *would a cheaper rung have succeeded?* Escalation precision
  (% of escalations that truly needed it); ask-human rate.
- **Tier mix:** ≥80% cheapest / ≤5% frontier sustained; $/task; $/user/month.
- **Task success:** per-tier success rate on a **pinned Prosh task battery**
  (real tasks, fixed). Re-run the battery on every router/gate change —
  regressions block.
- **Mechanism ablation:** each SoL-Pi mechanism on/off; tokens saved vs score
  delta. A mechanism that doesn't pay for itself stays off.
- **Public benchmarks (secondary):** SWE-bench Pro / Terminal-Bench for
  discrimination (Verified is saturated). Own battery is primary.
- **Memory:** does verified-outcome persistence improve rerun success over time?
  Does the router's per-codebase calibration beat the shipped default?
- **Economics validation:** reprice triggers — frontier share >5% sustained →
  cap tiers or usage-based frontier billing; cap-hit rate ≈ 0 → cap too generous.

## 10. Operating modes

- **Normal:** full ladder via Grist-held keys, up to plan's frontier budget.
- **Capped:** frontier rung off; medium becomes top (cheapest-only on lowest
  plan). Spend drops ~90%. Quiet notice, no hard stop — degrades, never stops.
- Mode transitions logged to Langfuse; cap-hit frequency is a pricing signal.

## 11. Economics (hypothesis — POC measures)

- Solo $12/mo: ~$10/user/mo inference budget after fixed costs (Jev, infra,
  support). Blended ladder ≈ $1/MTok at 80/15/5 → **~10M tokens/user/month
  breakeven.** Moderate-heavy user burns ~10M/mo → viability = the two tier-mix
  numbers, nothing else.
- **Adverse selection is the core risk** (heaviest users cost most under
  flat-rate). The cap bounds loss per user by construction — that's why it exists.
- Team: ~80/15/5 mix → blended ≈ $1/MTok vs ~$10 pure-frontier → roughly half
  the baseline AI-coding spend, plus minimal-exposure routing and memory.

## 12. Blockers & open items

- [ ] Jev API key capture (`custom.typesafe` link sent — pending his submission)
- [ ] Map bake-off: Graphify vs CRG — method set, not yet run
- [ ] DeepSeek pricing recheck at build time (volatile); backup cheap tier ready
- [ ] pydriller license confirmation
- [ ] Local-model watch only: Qwen3.8-27B leads the ≤32B class; Ternary Bonsai 2
  (its 2-day-old ternary quant) has no agentic numbers yet — revisit only if a
  zero-marginal-cost tier ever becomes strategically worth it
