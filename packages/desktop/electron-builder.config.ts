import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

import { APP_IDS, APP_NAMES, PRODUCT_NAME, PRODUCT_VERSION, PROTOCOL_SCHEME, UPDATES } from "./brand"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

async function stripMacDetritus(appOutDir: string) {
  if (process.platform !== "darwin") return
  await execFileAsync("xattr", ["-cr", appOutDir])
  await execFileAsync("find", [appOutDir, "-name", "._*", "-delete"])
}

const UNUSED_MAC_PRIVACY_KEYS = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
  "NSAppleMusicUsageDescription",
  "NSContactsUsageDescription",
  "NSCalendarsUsageDescription",
  "NSRemindersUsageDescription",
]

async function stripUnusedMacPrivacyKeys(appOutDir: string) {
  if (process.platform !== "darwin") return
  const found = await execFileAsync("find", [appOutDir, "-name", "Info.plist"])
  const plists = found.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  await Promise.all(plists.flatMap((plist) => UNUSED_MAC_PRIVACY_KEYS.map((key) => deletePlistKey(plist, key))))
}

function deletePlistKey(plist: string, key: string) {
  return execFileAsync("plutil", ["-remove", key, plist]).then(
    () => undefined,
    () => undefined,
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "prod"
})()

const getBase = (appId: string): Configuration => ({
  artifactName: "grist-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  publish: {
    provider: "github",
    owner: UPDATES.owner,
    repo: UPDATES.repo,
    releaseType: "release",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id.
  extraMetadata: {
    desktopName: `${appId}.desktop`,
    version: PRODUCT_VERSION,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  afterPack: async (context) => {
    await stripMacDetritus(context.appOutDir)
    await stripUnusedMacPrivacyKeys(context.appOutDir)
  },
  extraResources: [
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: Boolean(process.env.APPLE_ID || process.env.APPLE_API_KEY),
    target: ["dmg", "zip"],
    extendInfo: {
      NSMicrophoneUsageDescription: "Grist uses the microphone so you can dictate prompts.",
    },
  },
  dmg: {
    sign: Boolean(process.env.APPLE_ID || process.env.CSC_LINK || process.env.APPLE_API_KEY),
  },
  protocols: {
    name: PRODUCT_NAME,
    schemes: [PROTOCOL_SCHEME],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: APP_NAMES.dev,
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "grist-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: APP_NAMES.beta,
        protocols: { name: APP_NAMES.beta, schemes: [PROTOCOL_SCHEME] },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "grist-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: APP_NAMES.prod,
        protocols: { name: PRODUCT_NAME, schemes: [PROTOCOL_SCHEME] },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "grist", fpm: [metainfoFpm(appId)] },
      }
    }
  }
}

export default getConfig()
