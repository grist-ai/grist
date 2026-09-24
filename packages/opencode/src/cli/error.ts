import { NamedError } from "@opencode-ai/core/util/error"
import { loadInviteConfig } from "@/grist/invite/config"
import { errorFormat } from "@/util/error"
import { isRecord } from "@/util/record"

type ConfigIssue = { message: string; path: string[] }

function isTaggedError(error: unknown, tag: string): error is Record<string, unknown> {
  return isRecord(error) && error._tag === tag
}

function configData(input: unknown, tag: string): Record<string, unknown> | undefined {
  if (!isRecord(input)) return undefined
  if (input.name === tag && isRecord(input.data)) return input.data
  if (input._tag === tag) return input
  return undefined
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? input[key] : undefined
}

function configIssues(input: Record<string, unknown>): ConfigIssue[] {
  return Array.isArray(input.issues)
    ? input.issues.filter((issue): issue is ConfigIssue => {
        if (!isRecord(issue)) return false
        return (
          typeof issue.message === "string" &&
          Array.isArray(issue.path) &&
          issue.path.every((x) => typeof x === "string")
        )
      })
    : []
}

/**
 * The Grist gateway 402s with a machine-tagged body when the account spend
 * cap is hit. Inference errors surface through the provider SDK rather than
 * the gateway client, so detect the 402 down the cause chain and surface the
 * gateway's message cleanly instead of the generic provider-error dump.
 */
function gatewaySpendCap(input: unknown, depth = 0): string | undefined {
  if (depth > 5 || !isRecord(input)) return undefined
  const status = input["statusCode"] ?? input["status"]
  if (status === 402) {
    const texts = [input["message"], input["responseBody"], input["responseText"]]
      .filter((value): value is string => typeof value === "string")
    if (!texts.some((text) => /spend cap/i.test(text))) return undefined
    const clean =
      texts.map(gatewayErrorText).find((value) => value !== undefined) ?? "Spend cap reached."
    const invite = loadInviteConfig()
    const hint = invite
      ? ` Raise it at ${invite.gatewayUrl.replace(/\/+$/, "")}/dashboard — your provider key is untouched.`
      : ""
    return `${clean}${hint}`
  }
  return gatewaySpendCap(input["cause"], depth + 1)
}

/** Pull the gateway's `{ error }` text out of a JSON body, when that's what this is. */
function gatewayErrorText(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === "string" && /spend cap/i.test(parsed.error)) return parsed.error
  } catch {
    return undefined
  }
  return undefined
}

export function FormatError(input: unknown): string | undefined {
  if (input instanceof Error && isRecord(input.cause) && "body" in input.cause) {
    const formatted = FormatError(input.cause.body)
    if (formatted) return formatted
  }

  const spendCap = gatewaySpendCap(input)
  if (spendCap) return spendCap

  // CliError: domain failure surfaced from an effectCmd handler via fail("...")
  if (isTaggedError(input, "CliError")) {
    if (typeof input.exitCode === "number") process.exitCode = input.exitCode
    return stringField(input, "message") ?? ""
  }

  // MCPFailed: { name: string }
  if (NamedError.hasName(input, "MCPFailed")) {
    const data = isRecord(input) && isRecord(input.data) ? stringField(input.data, "name") : undefined
    return `MCP server "${data}" failed. Note, grist does not support MCP authentication yet.`
  }

  // AccountServiceError, AccountTransportError: TaggedErrorClass
  if (isTaggedError(input, "AccountServiceError") || isTaggedError(input, "AccountTransportError")) {
    return stringField(input, "message") ?? ""
  }

  // ProviderModelNotFoundError: { providerID: string, modelID: string, suggestions?: string[] }
  const providerModelNotFound = configData(input, "ProviderModelNotFoundError")
  if (providerModelNotFound) {
    const suggestions = Array.isArray(providerModelNotFound.suggestions)
      ? providerModelNotFound.suggestions.filter((x) => typeof x === "string")
      : []
    return [
      `Model not found: ${stringField(providerModelNotFound, "providerID")}/${stringField(providerModelNotFound, "modelID")}`,
      ...(suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      `Try: \`grist models\` to list available models`,
      `Or check your config (opencode.json) provider/model names`,
    ].join("\n")
  }

  // ProviderInitError: { providerID: string }
  const providerInit = configData(input, "ProviderInitError")
  if (providerInit) {
    return `Failed to initialize provider "${stringField(providerInit, "providerID")}". Check credentials and configuration.`
  }

  // ConfigJsonError: { path: string, message?: string }
  const configJson = configData(input, "ConfigJsonError")
  if (configJson) {
    const message = stringField(configJson, "message")
    return `Config file at ${stringField(configJson, "path")} is not valid JSON(C)` + (message ? `: ${message}` : "")
  }

  // ConfigDirectoryTypoError: { dir: string, path: string, suggestion: string }
  const configDirectoryTypo = configData(input, "ConfigDirectoryTypoError")
  if (configDirectoryTypo) {
    return `Directory "${stringField(configDirectoryTypo, "dir")}" in ${stringField(configDirectoryTypo, "path")} is not valid. Rename the directory to "${stringField(configDirectoryTypo, "suggestion")}" or remove it. This is a common typo.`
  }

  // ConfigFrontmatterError: { message: string }
  const configFrontmatter = configData(input, "ConfigFrontmatterError")
  if (configFrontmatter) {
    return stringField(configFrontmatter, "message") ?? ""
  }

  // ConfigRemoteAuthError: { url: string, remote: string }
  const remoteAuth = configData(input, "ConfigRemoteAuthError")
  if (remoteAuth) {
    const url = stringField(remoteAuth, "url")
    const remote = stringField(remoteAuth, "remote")
    return [
      `Failed to load remote config${remote ? ` from ${remote}` : ""}: the server returned a login page instead of JSON.`,
      `Authentication is missing or has expired (the endpoint is likely behind an SSO or identity-aware proxy).`,
      ...(url ? [`Run \`grist auth login ${url}\` to re-authenticate.`] : []),
    ].join("\n")
  }

  // ConfigInvalidError: { path?: string, message?: string, issues?: Array<{ message: string, path: string[] }> }
  const configInvalid = configData(input, "ConfigInvalidError")
  if (configInvalid) {
    const path = stringField(configInvalid, "path")
    const message = stringField(configInvalid, "message")
    const issues = configIssues(configInvalid)
    return [
      `Configuration is invalid${path && path !== "config" ? ` at ${path}` : ""}` + (message ? `: ${message}` : ""),
      ...issues.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")),
    ].join("\n")
  }

  // UICancelledError: user cancelled an interactive CLI prompt
  if (isTaggedError(input, "UICancelledError") || NamedError.hasName(input, "UICancelledError")) {
    return ""
  }
  return undefined
}

export function FormatUnknownError(input: unknown): string {
  return errorFormat(input)
}
