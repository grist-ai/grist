# Billing decision: gateway ledger vs Stripe credits

**Date:** 2026-09-22 (Phase B, B9)
**Status:** decided for launch; revisit triggers below.

## The question

When Grist takes real money, do we bill from our own SQLite ledger
(`usage_events`, metered per account with per-key attribution) or from
Stripe credit grants / customer balance?

## Decision

**Keep the gateway ledger as the metering and billing source of truth.
Stripe is the payment rail, not the source of truth.**

- The gateway already records every completion in `usage_events` with
  account, key attribution, model, tokens, and computed cost (see
  `packages/opencode/src/grist/gateway/metering.ts`, Phase A6/A7).
- The launch spec is explicit: "Source of truth is the gateway ledger,
  not Langfuse" (`docs/grist-public-launch-spec.md:177`); payments/
  billing is a launch non-goal (`:13`).
- Spend caps, the panic button, and per-key attribution all read from the
  ledger. Billing must agree with the same numbers users see in the
  dashboard — otherwise disputes are unwinnable.

## Rejected: Stripe credits / customer-balance model

- Stripe has no notion of per-key attribution, rung-aware pricing, or the
  metered-per-completion semantics Grist needs. Mirroring every completion
  into Stripe would duplicate the ledger and drift from it.
- Prepaid-credits UX (buy $20 of credit) conflicts with the launch model:
  flat-price subscriptions ($12 solo / ~$25–30 team per the GTM doc) with
  a spend cap, metered from the ledger.

## Future shape (not built in Phase B)

1. Stripe holds the subscription + payment method (recurring price).
2. The ledger computes the invoice: metered usage × ladder prices, capped
   by the account's spend cap.
3. Nightly/weekly reconciliation job: ledger total vs Stripe invoices;
   admin alert on drift (this is the natural successor to B5's webhook).
4. Prepaid credits deferred indefinitely — subscriptions + caps cover the
   ICP's needs; credits add accounting surface with no demand signal.

## Revisit triggers

- Chargeback/fraud patterns require Stripe-level entitlements.
- Regulator/tax treatment forces credits (e.g. gift-card-style prepaid).
- Ledger write performance becomes the bottleneck (benchmarked at
  completion time, not before).

## Why not now

Payments/billing is a launch non-goal; every completion currently burns
the founder's OpenRouter credits (`grist-public-launch-spec.md:40`).
The ledger is already authoritative for metering and enforcement, so the
cheapest path to billing later is to keep it authoritative and bolt
Stripe invoicing on top.
