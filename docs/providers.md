# Providers (BYOK)

Grist is **bring-your-own-key**: each user holds their own provider key and
inference bills to *their* provider account. The gateway never holds a user's
inference budget — it holds the ladder config, the Jev gate, and per-user
provider keys encrypted at rest.

## Operator setup

```bash
export GRIST_MASTER_KEY=$(openssl rand -hex 32)  # 32 bytes, hex or base64
export OPENROUTER_API_KEY=<redacted>      # house fallback only
export GRIST_ADMIN_TOKEN=<redacted>
```

- `GRIST_MASTER_KEY` encrypts provider keys at rest (AES-256-GCM). Without
  it, `POST /v1/provider` returns 503 and every request rides the house key —
  the gateway still works, just not BYOK.
- `OPENROUTER_API_KEY` (the founder's) is the **house fallback**: accounts
  with no stored credential keep working exactly as before.
- Rotate `GRIST_MASTER_KEY` only with a re-encryption migration; old blobs
  become unreadable otherwise.

## Supported providers

| Provider | Value | Endpoint |
| --- | --- | --- |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1/chat/completions` |
| Vercel AI Gateway | `vercel` | `https://ai-gateway.vercel.sh/v1/chat/completions` |
| Any OpenAI-compatible endpoint | `custom` | user-supplied base URL |

Users set their key at `grist auth login` (prompted) or directly:

```bash
curl -X POST https://grist.lol/v1/provider \
  -H "X-Grist-Api-Key: grist_sk_..." \
  -d '{"provider":"vercel","api_key":"vck_..."}'
# custom: {"provider":"custom","api_key":"...","base_url":"https://llm.example.com/v1",
#          "models":{"cheapest":"my-flash","medium":"my-pro",...}}
```

`GET /v1/provider` shows the configured provider and key fingerprint (never
the key). `DELETE /v1/provider` removes it. Keys are rate-limited, never
logged, and never leave the gateway except to the provider itself.

## Ladders

Each provider has its own rung→model table (`GRIST_<PROVIDER>_<RUNG>_MODEL`
overrides, e.g. `GRIST_VERCEL_MEDIUM_MODEL`). The OpenRouter table defaults
to the founder's `GRIST_<RUNG>_MODEL` overrides, so Railway config keeps
working unchanged.

Vercel ladder model ids are provisional — verify against
[vercel.com/ai-gateway/models](https://vercel.com/ai-gateway/models) before
sending live traffic, since vendor prefixes may not match OpenRouter's.

## Jev gate

The gate rides the **user's** provider key: OpenRouter users score at
OpenRouter's Jev endpoint, Vercel users at Vercel's. No separate gate key.
Custom providers have no Jev endpoint, so they fall back to the house Jev
route (founder's key); accounts with no credential do the same.

## Metering

- Priced at provider rates: OpenRouter list, Vercel at 0% markup (~5.2%
  below OpenRouter list), custom endpoints meter at $0 — the gateway cannot
  see their rates, so `/v1/usage` shows tokens only via the provider's own
  bill.
- Spend caps are **hard on the house key** (402 when hit — it's the
  founder's money) and **soft on a caller's own key** (the request still
  serves; one alert per cap level — it's their money, their bill).
- `/v1/usage` reports `provider` alongside spend by rung.

## Migration from the founder-key era

1. Set `GRIST_MASTER_KEY` on the gateway and redeploy.
2. Users run `grist auth login` again and add their provider key when
   prompted. Until they do, their requests ride the house fallback —
   nothing breaks.
