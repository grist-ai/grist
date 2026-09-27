import { useCommand, type CommandOption } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { useDialog } from "@opencode/ui/context/dialog"
import { useWorkspaceLocation } from "@/workspaces/location"

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useComposerCommands = () => {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const workspace = useWorkspaceLocation()
  const agentCommand = withCategory(language.t("command.category.agent"))
  const providerCommand = withCategory(language.t("command.category.provider"))

  // Mirrors the TUI's `/connect`, which the Console's setup steps tell people to run.
  const connectProvider = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    void dialog.show(() => <DialogConnectProvider directory={workspace().directory} />)
  }

  command.register("composer", () => [
    providerCommand({
      id: "provider.connect",
      title: language.t("command.provider.connect"),
      description: language.t("command.provider.connect.description"),
      slash: "connect",
      onSelect: connectProvider,
    }),
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(1),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(-1),
    }),
  ])
}
