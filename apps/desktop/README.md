# Design Clone desktop

The desktop app (Electron). Two kinds of window:

- **Offline windows** show the web app bundled with the desktop app, served
  from `app://bundle/`. They open with a start screen: recent `.design` files,
  drafts kept in the app, and a field to connect to your server.
- **Cloud windows** show your server's own pages, at the address saved on the
  start screen. Sign-in, live editing, comments and history work exactly as in
  a browser, and every web deploy updates them.

Every window runs with context isolation and a sandbox, and pages have no
Node.js access. A window can only navigate within its own origin; a cloud
window may also visit Google's sign-in page. Links anywhere else open in the
default browser. The preload script exposes only the small `window.desktop`
bridge (`apps/web/src/desktop/api.ts`), and the main process accepts calls
only from the top frame of its own windows.

## Commands

From the repository root:

```powershell
pnpm --filter @figma/web build
```

```powershell
pnpm --filter @figma/desktop start
```

The first command builds the web app the desktop app bundles; the second runs
the desktop app with it.

```powershell
pnpm dev:desktop
```

This runs against the web dev server (`pnpm dev`) instead, for live reloading.

```powershell
pnpm --filter @figma/desktop smoke
```

This drives the app through the start screen, the editor, the security rules
and a plugin, and saves screenshots and a `results.json` (to `SMOKE_OUT`, or a
temporary folder). It exits with 1 if a check fails.

## Installers

From the repository root, run:

```powershell
pnpm dist:desktop
```

This builds the web app and packages the desktop app for the system you run
it on, into `apps/desktop/release/`. On Windows that's:

- `Design-Clone-Setup-<version>.exe`: the installer. It installs per user and
  lets you choose the folder. It adds Start menu and desktop shortcuts and
  registers `.design` files and `design-clone://` links.
- `Design-Clone-<version>-portable.exe`: runs without installing.
- `win-unpacked/`: the app folder the installer contains. Run
  `"release/win-unpacked/Design Clone.exe" --smoke` to smoke-test the packaged
  build.

The packaged app has these Electron fuses set:

- It can't be run as a plain Node.js interpreter.
- No Node options or inspector flags.
- The app archive is integrity-checked, and the app loads only from it.
- Cookies are encrypted.

On macOS it makes a `.dmg` and a `.zip` (the zip is what installed apps update
from). On Linux it makes an `.AppImage` and a `.deb`.

**Signing.** Unsigned builds warn on first run. On Windows, SmartScreen asks
you to click More info > Run anyway. On macOS, right-click the app > Open.
macOS apps also need signing to update themselves. To sign in the release
workflow, add these repository secrets:

- **Windows:** `WINDOWS_CERTIFICATE` (a .pfx, base64) and
  `WINDOWS_CERTIFICATE_PASSWORD`.
- **macOS:** `MAC_CERTIFICATE` (a Developer ID Application .p12, base64) and
  `MAC_CERTIFICATE_PASSWORD`. For notarization, add `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

## Releases

Bump `version` in `apps/desktop/package.json`, merge, then push a matching tag:

```powershell
git tag desktop-v0.1.0
```

```powershell
git push origin desktop-v0.1.0
```

The **Desktop release** workflow builds on Windows, macOS (Apple silicon and
Intel) and Linux, smoke-tests each packaged app, and publishes one GitHub
Release with every file. That includes `latest.yml`, `latest-mac.yml` and
`latest-linux.yml`, which installed apps update from. Run it by hand from the
Actions tab to only build them and download the result.

## Updates

Installed apps check the latest GitHub release at startup and every 6 hours.
They download a newer version in the background, then ask to restart; if you
choose later, it installs when you quit. Help > Check for Updates checks right
away.

These builds don't update themselves:

- the Windows portable build
- a Linux `.deb` (it updates through the package manager)
- unsigned macOS builds

Version 0.1.0 has no updater; updates work from 0.2.0 on. To test against
another feed, set `DESKTOP_UPDATE_URL` to a folder URL holding a `latest.yml`
and the installer it names.

## Logs and crash reports

The main process logs to `logs/main.log` in the app's data folder
(`%APPDATA%\Design Clone` on Windows). Help > Open Logs Folder opens it.

Native crashes are saved as minidumps by Electron. They're uploaded only when
the build has a Sentry DSN (`DESKTOP_SENTRY_DSN` when building, or the
repository secret). If a window's page crashes, the app offers to reload it.

## Plan

1. **App shell** (done): windows, the `app://` protocol, security rules,
   settings, the start screen, cloud windows.
2. **Files on disk** (done): `.design` files with New, Open, recent files,
   autosave (about a second after edits pause, written atomically), Ctrl+S,
   saving on close, Save as, rename, Show in folder, Upload to cloud, Save a
   copy to disk (from cloud files and drafts), and present mode.
3. **Native menus and links** (done): the menu bar is built from the editor's
   commands (File, Edit, View, Object, Arrange, Plugins, Help), with items
   enabled as the selection allows and Open Recent. Shortcuts are shown in the
   menus but still handled by the editor, so text fields keep their own keys.
   `design-clone://file/<id>?server=…` links open cloud files (a link to a
   different server asks first), "Open in the desktop app" in the browser's
   file menu creates one, and comment mentions show native notifications.
   File associations and the link registration come with the installers.
4. **Windows installers** (done): NSIS installer and portable build, file
   associations and link registration, Electron fuses, logs and crash
   reports, and a release workflow for `desktop-v*` tags.
5. **Auto-update, macOS and Linux** (done): updates from GitHub Releases,
   macOS (signing and notarization switch on with secrets) and Linux builds,
   all smoke-tested in the release workflow, and Edit commands that act on
   the focused text field (which is what macOS's menu shortcuts need).
