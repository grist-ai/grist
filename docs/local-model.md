# Local model (llama.cpp → Grist)

Phase 2 runs Ternary Bonsai 2 27B behind llama.cpp. Phase 3 points this OpenCode fork at that server.

llama.cpp’s `llama-server` exposes an OpenAI-compatible API. Example project config (`opencode.json` / `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "llama.cpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1"
      },
      "models": {
        "bonsai-2-27b": {
          "name": "Ternary Bonsai 2 27B (local)"
        }
      }
    }
  }
}
```

Adjust `baseURL`, provider ID, and model IDs to match your `llama-server` bind address and loaded GGUF. On 16GB machines cap context per slot (~16K); 24GB+ can use ~32K — see [`grist-build-spec.md`](grist-build-spec.md) §6–7.

This reset does **not** require the model to be installed; config is documentation only until Phase 2 is live.
