import { resolveChannel } from "./utils"
import { APP_IDS, APP_NAMES, PRODUCT_NAME } from "../brand"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = APP_IDS[channel]
const productName = APP_NAMES[channel]
const summary = `Confidence-gated coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ai.grist">
    <name>Grist</name>
  </developer>

  <description>
    <p>
      ${PRODUCT_NAME} is a coding agent that learns your repo, gates hard work, and stays local.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="homepage">https://github.com/pranav6226/grist</url>
  <url type="vcs-browser">https://github.com/pranav6226/grist</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
