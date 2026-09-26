import { define } from "@opencode/plugin/effect/plugin"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Effect } from "effect"
import { gatewayAuthHeaders, loadInviteConfig } from "./invite-config.js"
import { registerGristHooks } from "./hooks.js"
import { GRIST_PROVIDER_ID, PUBLIC_RUNGS, PUBLIC_RUNG_NAME, RUNG_CONTEXT_FLOOR, type Rung } from "./rung.js"

function rungModel(rung: Rung): Model.Info {
  const floor = RUNG_CONTEXT_FLOOR[rung]
  return {
    ...Model.Info.default(Provider.ID.make(GRIST_PROVIDER_ID), Model.ID.make(rung)),
    name: PUBLIC_RUNG_NAME[rung],
    limit: { context: floor, input: floor, output: 32000 },
  }
}

/**
 * The Grist control plane as an opencode v2 plugin.
 *
 * - Adds the `grist` provider (OpenAI-compatible transport pointed at the
 *   Grist gateway) with the four ladder rungs as its models. The gateway
 *   resolves each rung to its upstream model server-side; vendor ids never
 *   ship in the client. Provider registration is invite-gated.
 * - Registers the control-plane hooks: `session.prompt` (Jev gate),
 *   `session.context` (doctrine), `session."model.request"` (between-turn
 *   judgment), `session.compaction` (compaction guard), `tool.execute.before`
 *   (tool budget), `tool.execute.after` (tool stats + verify nudge), and
 *   `permission.evaluate` (auto-allow). The hooks run with shadow fallbacks
 *   when no Jev route resolves; `GRIST_CTRL=off` disables them.
 *
 * Without an invite config the provider is not registered, but the hooks stay
 * active: opencode behaves vanilla only when `GRIST_CTRL=off`.
 */
export const Plugin = define({
  id: "grist-ai.plugin",
  effect: Effect.fn(function* (ctx) {
    yield* registerGristHooks(ctx)
    const invite = loadInviteConfig()
    if (!invite) return
    yield* ctx.provider.transform((editor) => {
      if (editor.get(GRIST_PROVIDER_ID)) return
      editor.add({
        info: {
          id: Provider.ID.make(GRIST_PROVIDER_ID),
          name: "Grist",
          activation: "auto",
          package: "@opencode/ai/providers/openai-compatible",
          settings: {
            baseURL: `${invite.gatewayUrl}/v1`,
            apiKey: invite.code,
          },
          headers: {
            "HTTP-Referer": "https://github.com/grist-ai/grist",
            "X-Title": "Grist",
            ...gatewayAuthHeaders(invite),
          },
        },
        models: PUBLIC_RUNGS.map(rungModel),
      })
    })
  }),
})
