---
name: deploy-update
description: >
  Ship a full Grist release in one go: commit, merge to main, signed Mac
  desktop auto-update, and npm TUI/CLI (grist-ai plus platform binaries).
  Use when the user asks to deploy update, deploy, ship an update, publish
  the Mac app, publish the TUI, publish npm, or send a new Grist update to
  testers.
---

# Deploy update

Do Mac desktop and npm TUI together. Do not stop after git merge. Do not
publish only one surface unless the user says so.

Mac version (`PRODUCT_VERSION`) and npm version (`grist-ai`) are independent.
Bump each to the next patch of whatever is already live.

## Versions

```bash
# live Mac tag
gh release list --repo pranav6226/grist-downloads --limit 3
# live npm
npm view grist-ai version
```

1. Mac: set `PRODUCT_VERSION` in `packages/desktop/brand.ts` **and** `version`
   in `packages/desktop/package.json` to live-tag + patch (example `0.1.4` →
   `0.1.5`). Installed apps only see an update if this number increases.
2. npm: next patch of `npm view grist-ai version` (example `0.1.1` → `0.1.2`).
   Pass it explicitly to the workflow. Do not leave version empty unless you
   intend auto-bump.

## Git

1. Commit intended source. Conventional commit. Branch name ≤3 hyphenated words.
2. Never add `brag-output-*`, `packages/opencode/dist`, `packages/desktop/dist`,
   `.p8` keys, or secrets.
3. If `packages/opencode/dist` exists, move it out of the tree before `git push`
   (pre-push typecheck hangs or explodes on those binaries).
4. If pre-push typecheck fails under bun 1.4.x, retry the push with bun 1.3.14
   on `PATH` (repo `packageManager` is 1.3.14).
5. PR → merge to `main`. User asking to deploy update includes merge.
6. npm publish **must** run on `main` after the merge, so testers get the same
   commit that was merged.

## Mac app

Package **outside iCloud Desktop**. Finder xattrs on `~/Desktop/grist` break
`codesign`. Always output to `/tmp`.

Signing identity: `security find-identity -v -p codesigning` — use
**Developer ID Application**, never Apple Development.

Notarization: `APPLE_API_KEY` (the `.p8` already on this Mac, usually
`~/Downloads/AuthKey_*.p8`), plus `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
Never commit the `.p8`. Never echo it. If those env vars are missing, stop.

```bash
export OPENCODE_CHANNEL=prod
export CSC_NAME="Developer ID Application: …"   # from find-identity
export APPLE_API_KEY="$HOME/Downloads/AuthKey_<ID>.p8"
export APPLE_API_KEY_ID="<ID>"
export APPLE_API_ISSUER="<issuer uuid>"
export COPYFILE_DISABLE=1
rm -rf /tmp/grist-desktop-dist
cd packages/desktop
bun run build
bun run package:mac -- -c.directories.output=/tmp/grist-desktop-dist
```

After `notarization successful` and zip+dmg exist:

```bash
xcrun stapler staple /tmp/grist-desktop-dist/mac-arm64/Grist.app
# DMG may need its own submit if stapler says Record not found:
# xcrun notarytool submit /tmp/grist-desktop-dist/grist-desktop-mac-arm64.dmg \
#   --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple /tmp/grist-desktop-dist/grist-desktop-mac-arm64.dmg
```

Confirm `latest-mac.yml` `version:` matches `PRODUCT_VERSION`, then:

```bash
GRIST_DESKTOP_DIST=/tmp/grist-desktop-dist bun run publish:mac
```

That uploads zip, dmg, blockmaps, and `latest-mac.yml` to
`pranav6226/grist-downloads` at tag `PRODUCT_VERSION`. Zip + yml are required
for auto-update. Copy the DMG to `~/Downloads/Grist.dmg` after staple.

Do not `npm publish` desktop. Desktop is GitHub Releases only.

## TUI / npm (`grist-ai`)

Never publish the 50MB+ platform tarballs from this laptop (`SSL` / `EPIPE`).
Always GitHub Actions:

```bash
gh workflow run publish-grist.yml -R pranav6226/grist --ref main \
  -f version=<npm-version> -f channel=latest -f single=false
```

`single=false` builds darwin/linux/windows. Watch the run. Confirm:

```bash
npm view grist-ai version
npm view grist-darwin-arm64@<npm-version> version
```

Windows (`grist-windows-*`) may fail if the npm names do not exist yet. That
must not block darwin/linux/`grist-ai`. Success is `grist-ai@<version>` plus
`grist-darwin-arm64@<version>`.

### npm auth (do not regress)

- OIDC trusted publisher on each package. Workflow file **must** be exactly
  `publish-grist.yml`, repo `pranav6226/grist`.
- Do **not** set `NODE_AUTH_TOKEN` or setup-node `registry-url` (empty
  `_authToken` skips OIDC → `ENEEDAUTH` / fake 404).
- Do **not** set `OPENCODE_RELEASE` (calls `gh release upload` with no token).
- Publish from the workflow bash step, not `bun $ npm publish`.
- If CI fails `ENEEDAUTH` again: trusted publisher missing on that package.
  Add it on npmjs.com, then re-dispatch. Do not grind local `npm publish`.

## Done when

Report:

- PR URL merged to main
- Mac: `https://github.com/pranav6226/grist-downloads/releases/tag/<mac-version>`
- npm: testers run `npm install -g grist-ai@<npm-version>` then `grist --version`

Old failed `publish-grist` dispatches can stay red on the same SHA. The
**latest** `publish-grist` run is what matters.
