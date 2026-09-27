export type Policy = "disable" | "notify" | "auto"
export type Action = "none" | "notify" | "auto"

const maximumComponent = "9007199254740991"
const versionPattern =
  /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function action(current: string, latest: string, policy: Policy): Action {
  if (policy === "disable") return "none"
  const comparison = compareRelease(current, latest)
  // Only a strictly newer release is an update. The version source (npm
  // registry /latest) has no notion of intentional rollbacks, so suggesting
  // an older version would downgrade the install.
  if (comparison === undefined || comparison <= 0) return "none"
  return policy
}

// Compares two release versions: positive when latest is newer than current,
// negative when older, 0 when equal, undefined when either is invalid.
export function compareRelease(current: string, latest: string): number | undefined {
  const currentVersion = parseReleaseVersion(current)
  const latestVersion = parseReleaseVersion(latest)
  if (!currentVersion || !latestVersion) return undefined
  const currentParts = currentVersion.core.split(".")
  const latestParts = latestVersion.core.split(".")
  for (let index = 0; index < 3; index++) {
    const a = currentParts[index]
    const b = latestParts[index]
    if (a === b) continue
    // Components are validated numeric strings without leading zeros; compare
    // by length then lexicographically to avoid precision loss on oversized
    // components.
    if (a.length !== b.length) return a.length < b.length ? 1 : -1
    return a < b ? 1 : -1
  }
  const currentPre = currentVersion.prerelease
  const latestPre = latestVersion.prerelease
  if (currentPre.length === 0 && latestPre.length === 0) return 0
  // A release outranks any prerelease of the same core.
  if (currentPre.length === 0) return -1
  if (latestPre.length === 0) return 1
  return comparePrerelease(currentPre, latestPre)
}

function comparePrerelease(current: string[], latest: string[]): number {
  const length = Math.max(current.length, latest.length)
  for (let index = 0; index < length; index++) {
    const a = current[index]
    const b = latest[index]
    if (a === b) continue
    // Fewer identifiers means lower precedence.
    if (a === undefined) return 1
    if (b === undefined) return -1
    const aNumeric = /^[0-9]+$/.test(a)
    const bNumeric = /^[0-9]+$/.test(b)
    // Numeric identifiers sort below alphanumeric ones.
    if (aNumeric && !bNumeric) return -1
    if (!aNumeric && bNumeric) return 1
    if (a.length !== b.length) return a.length < b.length ? 1 : -1
    return a < b ? 1 : -1
  }
  return 0
}

export function parseReleaseVersion(input: string) {
  if (input.length > 256) return
  const match = input.trim().match(versionPattern)
  if (!match) return
  if ([match[1], match[2], match[3]].some(invalidComponent)) return
  if (
    match[4]
      ?.split(".")
      .some((identifier) => identifier.length > 1 && identifier.startsWith("0") && /^[0-9]+$/.test(identifier))
  )
    return
  return {
    major: match[1],
    core: `${match[1]}.${match[2]}.${match[3]}`,
    prerelease: match[4]?.split(".") ?? [],
  }
}

function invalidComponent(value: string) {
  if (value.length > 1 && value.startsWith("0")) return true
  if (value.length !== maximumComponent.length) return value.length > maximumComponent.length
  return value > maximumComponent
}
