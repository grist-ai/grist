/** @jsxImportSource @opentui/solid */
import open from "open"
import { createSignal } from "solid-js"
import type { BuiltinTuiPlugin } from "@opencode-ai/tui/builtins"
import { resolveGateway } from "@/cli/cmd/auth"
import { bootstrapCodebase } from "@/grist/init/bootstrap"
import { scaffoldGrist } from "@/grist/init/scaffold"
import { pollCliLogin, startCliLogin } from "@/grist/invite/client"
import { saveInviteConfig } from "@/grist/invite/config"

export const GristOnboarding: BuiltinTuiPlugin = {
  id: "grist-onboarding",
  tui: async (api) => {
    const alert = (title: string, message: string) => {
      api.ui.dialog.replace(() => <api.ui.DialogAlert title={title} message={message} />)
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "grist.init",
          title: "Initialize Grist workspace",
          slashName: "init",
          category: "Grist",
          namespace: "palette",
          run() {
            const result = scaffoldGrist({ cwd: process.cwd() })
            const lines = [
              ...result.created.map((item) => `created ${item}`),
              ...result.skipped.map((item) => `kept ${item}`),
              ...result.warnings,
            ]
            alert("Grist workspace", lines.join("\n") || "Nothing to do")
          },
        },
        {
          name: "grist.bootstrap",
          title: "Bootstrap codebase",
          slashName: "bootstrap",
          category: "Grist",
          namespace: "palette",
          async run() {
            api.ui.toast({ variant: "info", message: "Mining ownership history…" })
            try {
              const result = await bootstrapCodebase({ cwd: process.cwd() })
              const lines = [
                `Pinned SHA ${result.sha}`,
                `${result.ownershipRows} ownership rows → ${result.ownershipPath}`,
                ...(result.graphPath ? [`code map → ${result.graphPath}`] : []),
                ...result.notes,
                `next steps → ${result.nextPath}`,
              ]
              alert("Bootstrap complete", lines.join("\n"))
            } catch (error) {
              alert("Bootstrap failed", error instanceof Error ? error.message : String(error))
            }
          },
        },
        {
          name: "grist.login",
          title: "Log in to Grist",
          slashName: "login",
          category: "Grist",
          namespace: "palette",
          async run() {
            const gatewayUrl = resolveGateway()
            const login = await startCliLogin(gatewayUrl).catch(() => undefined)
            if (!login) {
              alert("Log in to Grist", "Could not reach the Grist site.")
              return
            }
            const url = `${gatewayUrl}${login.verification_uri}`
            void open(url).catch(() => undefined)
            let closed = false
            const [status, setStatus] = createSignal(
              `Opened ${url}\nCode: ${login.user_code}\n\nWaiting for you to log in on the site…`,
            )
            api.ui.dialog.replace(
              () => <api.ui.DialogAlert title="Log in to Grist" message={status()} />,
              () => {
                closed = true
              },
            )
            const deadline = Date.now() + login.expires_in * 1000
            const interval = Math.max(1, login.interval || 1) * 1000
            while (Date.now() < deadline) {
              if (closed) return
              await Bun.sleep(interval)
              if (closed) return
              const next = await pollCliLogin(gatewayUrl, login.device_code).catch(() => undefined)
              if (!next) {
                setStatus("Could not reach the Grist site.")
                return
              }
              if (next.status === "pending") continue
              if (next.status !== "approved") break
              saveInviteConfig({ code: next.code, gatewayUrl })
              setStatus("Logged in — Grist is ready.")
              api.ui.toast({ variant: "success", message: "Logged in to Grist" })
              return
            }
            setStatus("Login expired. Run /login again.")
          },
        },
      ],
    })
  },
}
