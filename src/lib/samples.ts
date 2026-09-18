export const SAMPLE_PROMPTS = [
  {
    label: "Local",
    prompt:
      "Rename the unused `fetchLegacyMap` helper in src/graph/map.ts and update call sites.",
  },
  {
    label: "Frontier",
    prompt:
      "We're seeing duplicate charges in payouts — redesign the ledger to be idempotent and migrate production.",
  },
  {
    label: "Ask human",
    prompt: "Fix it.",
  },
  {
    label: "Test",
    prompt:
      "Add a regression test for the ownership miner skipping bot commits and merges.",
  },
] as const;
