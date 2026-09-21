import { InstallationLocal } from "@opencode-ai/core/installation/version"

/**
 * Published npm version of `@opencode-ai/plugin`.
 * Grist CLI versions (grist-ai 0.1.x) are not plugin versions — installing
 * that package at the CLI version 404s on every `grist run`.
 */
export const PLUGIN_NPM_VERSION = "1.18.31"

export const pluginInstallAdd = {
  name: "@opencode-ai/plugin",
  version: InstallationLocal ? undefined : PLUGIN_NPM_VERSION,
}
