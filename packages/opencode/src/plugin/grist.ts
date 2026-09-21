import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function GristAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "grist",
      methods: [
        {
          type: "api",
          label: "API key",
        },
      ],
    },
  }
}
